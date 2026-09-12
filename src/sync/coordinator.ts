import type { LocalRepository } from '../storage/repository';
import { LOCAL_ACCOUNT_ID, type CallbackFence } from '../storage/types';
import { sameFence, type SyncTransport } from './protocol';

import { SyncPause, SyncRetry, type PauseReason } from './errors';
export type CloudWriteState =
  | { type: 'scheduled' | 'sending' | 'acknowledged' }
  | { type: 'retry'; retryAt: number }
  | { type: 'paused'; reason: PauseReason; message: string };

interface Pending {
  first: number;
  due: number;
  attempts: number;
}

/** Account-scoped write coordinator. Does not claim freshness or enable account UI.
 * The repository owns the origin lease; session loss must invalidate currentFence.
 * stop() fences late callbacks and retains all drafts and replay records.
 */
export class SyncCoordinator {
  private stopped = false;
  private started = false;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, Pending>();
  private active = new Map<string, Promise<void>>();
  private observed = new Map<string, number>();
  private lastSent = new Map<string, number>();
  private states = new Map<string, CloudWriteState>();
  private listeners = new Set<() => void>();
  private readonly fence: CallbackFence;

  constructor(
    private repository: LocalRepository,
    private transport: SyncTransport,
    fence: CallbackFence,
    private currentFence: () => CallbackFence | null,
  ) {
    this.fence = Object.freeze({ ...fence });
    if (
      repository.accountId === LOCAL_ACCOUNT_ID ||
      repository.accountId !== fence.accountId ||
      repository.writerId !== fence.writerId
    )
      throw new Error('Sync requires its own account notebook and writer.');
  }

  private ownedFence = (): CallbackFence | null => {
    const current = this.currentFence();
    return !this.stopped &&
      current &&
      sameFence(current, this.fence) &&
      this.repository.getSnapshot().mode === 'writer'
      ? current
      : null;
  };

  private assertCurrent(): void {
    if (!this.ownedFence())
      throw new SyncPause(
        'session',
        'Sign in to the same account to resume sync.',
      );
  }

  getState(noteId: string): CloudWriteState | undefined {
    const state = this.states.get(noteId);
    return state ? { ...state } : undefined;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private setState(id: string, state: CloudWriteState): void {
    this.states.set(id, state);
    for (const listener of this.listeners) listener();
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('This coordinator has already started.');
    this.assertCurrent();
    this.started = true;
    this.unsubscribe = this.repository.subscribe(() => this.observe());
    const intents = await this.repository.database.intents
      .where('accountId')
      .equals(this.fence.accountId)
      .toArray();
    this.assertCurrent();
    for (const note of this.repository.getSnapshot().notes) {
      if (this.repository.getSnapshot().statuses[note.id] === 'saved-local')
        this.observed.set(note.id, note.generation);
    }
    for (const intent of intents) this.schedule(intent.noteId);
    this.observe();
  }

  private observe(): void {
    if (!this.ownedFence()) return;
    const snapshot = this.repository.getSnapshot();
    for (const note of snapshot.notes) {
      if (
        snapshot.statuses[note.id] !== 'saved-local' ||
        this.observed.get(note.id) === note.generation
      )
        continue;
      this.observed.set(note.id, note.generation);
      if (this.states.get(note.id)?.type !== 'paused') this.schedule(note.id);
    }
  }

  private schedule(id: string): void {
    const now = Date.now();
    const previous = this.pending.get(id);
    const first = previous?.first ?? now;
    // Retry guidance and exponential backoff cannot be shortened by typing.
    const due =
      this.states.get(id)?.type === 'retry' && previous
        ? previous.due
        : Math.max(
            Math.min(now + 750, first + 2000),
            (this.lastSent.get(id) ?? 0) + 2000,
          );
    this.pending.set(id, { first, due, attempts: previous?.attempts ?? 0 });
    if (!this.active.has(id) && this.states.get(id)?.type !== 'retry')
      this.setState(id, { type: 'scheduled' });
    this.arm();
  }

  /** Deliberate retry after the cause of a visible pause has been resolved. */
  retry(noteId: string): void {
    this.assertCurrent();
    this.states.delete(noteId);
    this.schedule(noteId);
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped || this.active.size >= 2) return;
    const available = [...this.pending].filter(([id]) => !this.active.has(id));
    if (!available.length) return;
    const due = Math.min(...available.map(([, work]) => work.due));
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.pump();
      },
      Math.max(0, due - Date.now()),
    );
  }

  private pump(): void {
    if (!this.ownedFence()) {
      for (const id of this.pending.keys())
        this.setState(id, {
          type: 'paused',
          reason: 'session',
          message: 'Sign in to resume sync.',
        });
      this.pending.clear();
      return;
    }
    for (const [id, work] of this.pending) {
      if (this.active.size >= 2) break;
      if (this.active.has(id) || work.due > Date.now()) continue;
      this.pending.delete(id);
      const task = this.send(id, work).finally(() => {
        this.active.delete(id);
        this.arm();
      });
      this.active.set(id, task);
    }
    this.arm();
  }

  private async send(id: string, work: Pending): Promise<void> {
    try {
      this.assertCurrent();
      this.setState(id, { type: 'sending' });
      const service = await this.transport.getServiceState();
      this.assertCurrent();
      if (service.epoch !== this.fence.epoch)
        throw new SyncPause(
          'epoch',
          'Preserve this dataset before syncing into a new epoch.',
        );
      if (service.minimum_protocol > 1)
        throw new SyncPause('protocol', 'Update AiryType before syncing.');
      if (!service.reads_enabled || !service.writes_enabled)
        throw new SyncPause('service', 'Cloud writes are paused.');
      const request = await this.repository.sealForSync(
        id,
        this.fence,
        this.ownedFence,
      );
      this.assertCurrent();
      this.lastSent.set(id, Date.now());
      const ack = await this.transport.send(request);
      this.assertCurrent();
      await this.repository.acknowledgeSync(
        request,
        ack,
        this.fence,
        this.ownedFence,
      );
      this.assertCurrent();
      this.setState(id, { type: 'acknowledged' });
      // This is a write receipt, never a complete "Synced" or freshness claim.
      const intent = await this.repository.database.intents.get([
        this.fence.accountId,
        id,
      ]);
      this.assertCurrent();
      if (intent) this.schedule(id);
      else this.pending.delete(id);
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof SyncRetry && this.ownedFence()) {
        const delay = Math.max(
          error.retryAfterMs,
          Math.min(30_000, 1000 * 2 ** Math.min(work.attempts, 5)) *
            (0.5 + Math.random() * 0.5),
        );
        const retryAt = Date.now() + delay;
        this.pending.set(id, {
          first: Date.now(),
          due: retryAt,
          attempts: work.attempts + 1,
        });
        this.setState(id, { type: 'retry', retryAt });
      } else {
        this.pending.delete(id);
        this.setState(id, {
          type: 'paused',
          reason: !this.ownedFence()
            ? 'session'
            : error instanceof SyncPause
              ? error.reason
              : 'local',
          message:
            error instanceof Error
              ? error.message
              : 'Sync paused; your local writing is retained.',
        });
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.pending.clear();
  }
}
