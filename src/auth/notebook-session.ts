import type { LocalRepository } from '../storage/repository';
import { LOCAL_ACCOUNT_ID, type CallbackFence } from '../storage/types';
import type { CloudWriteState } from '../sync/coordinator';

export interface NotebookAuthSession {
  accountId: string;
  email: string | null;
  verified: boolean;
  /** Stable across token refresh, different after a new sign-in. */
  sessionId: string;
}

export interface NotebookAuth {
  configured: boolean;
  getSession(): Promise<NotebookAuthSession | null>;
  subscribe(
    listener: (session: NotebookAuthSession | null) => void,
  ): () => void;
  signIn(email: string, password: string): Promise<NotebookAuthSession>;
  signOutLocal(): Promise<void>;
}

export interface NotebookSync {
  stop(): void;
  subscribe(listener: () => void): () => void;
  getState(noteId: string): CloudWriteState | undefined;
}

export interface NotebookSessionSnapshot {
  phase:
    | 'local'
    | 'opening'
    | 'account'
    | 'session-lost'
    | 'logout-pending'
    | 'signing-out';
  repository: LocalRepository;
  accountId: string | null;
  email: string | null;
  message: string | null;
  pendingCount: number;
  configured: boolean;
}

export interface NotebookControlChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export interface NotebookSessionOptions {
  localRepository: LocalRepository;
  auth: NotebookAuth;
  openAccount(accountId: string): Promise<LocalRepository>;
  startSync(
    repository: LocalRepository,
    fence: CallbackFence,
    currentFence: () => CallbackFence | null,
  ): Promise<NotebookSync>;
  getEpoch(): Promise<string>;
  /** null disables coordination for an isolated test environment. */
  channel?: NotebookControlChannel | null;
}

const matches = (
  left: NotebookAuthSession | null,
  right: NotebookAuthSession | null,
) =>
  Boolean(
    left &&
    right &&
    left.verified &&
    right.verified &&
    left.accountId === right.accountId &&
    left.sessionId === right.sessionId,
  );

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'The account action could not complete.';

/** One origin writer owns namespace transitions. No transition deletes records,
 * transfers preview notes, or performs Auth operations from an Auth callback.
 */
export class NotebookSession {
  private snapshot: NotebookSessionSnapshot;
  private listeners = new Set<() => void>();
  private authSession: NotebookAuthSession | null = null;
  private openedSession: NotebookAuthSession | null = null;
  private fence: CallbackFence | null = null;
  private sync: NotebookSync | null = null;
  private unsubscribeSync?: () => void;
  private unsubscribeRepository?: () => void;
  private unsubscribeAuth?: () => void;
  private initialization?: Promise<void>;
  private operation = 0;
  private authRevision = 0;
  private pendingRevision = 0;
  private disposed = false;
  private channel: NotebookControlChannel | null;
  private senderId = crypto.randomUUID();

  constructor(private options: NotebookSessionOptions) {
    if (options.localRepository.accountId !== LOCAL_ACCOUNT_ID)
      throw new Error(
        'The local notebook must keep its local-preview namespace.',
      );
    this.snapshot = Object.freeze({
      phase: 'local',
      repository: options.localRepository,
      accountId: null,
      email: null,
      message: null,
      pendingCount: 0,
      configured: options.auth.configured,
    });
    this.channel =
      options.channel === undefined
        ? typeof BroadcastChannel === 'undefined'
          ? null
          : new BroadcastChannel('airytype:account-control')
        : options.channel;
    if (this.channel) this.channel.onmessage = this.receiveControl;
  }

  getSnapshot = (): NotebookSessionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getCurrentFence = (): CallbackFence | null => this.fence;
  getCloudState = (noteId: string): CloudWriteState | undefined =>
    this.sync?.getState(noteId);

  private update(patch: Partial<NotebookSessionSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }

  initialize(): Promise<void> {
    this.initialization ??= this.start();
    return this.initialization;
  }

  private async start(): Promise<void> {
    // Subscribe first: a late getSession result must not restore a lost session.
    this.unsubscribeAuth = this.options.auth.subscribe(this.sessionChanged);
    const revision = this.authRevision;
    try {
      const session = await this.options.auth.getSession();
      if (!this.disposed && revision === this.authRevision)
        this.sessionChanged(session);
    } catch (error) {
      if (!this.disposed && revision === this.authRevision)
        this.update({ message: messageOf(error) });
    }
  }

  private sessionChanged = (session: NotebookAuthSession | null): void => {
    if (this.disposed) return;
    this.authRevision += 1;
    this.authSession = session ? Object.freeze({ ...session }) : null;
    if (this.snapshot.phase === 'signing-out' && !session) return;
    if (this.openedSession && !matches(this.openedSession, session)) {
      // Everything through the visible state change is synchronous.
      this.loseSession(
        'Your account session ended. Sign in to the same account to recover this notebook.',
      );
    } else if (this.snapshot.phase === 'local') {
      this.update({
        accountId: session?.accountId ?? null,
        email: session?.email ?? null,
      });
    } else if (matches(this.openedSession, session)) {
      this.update({ email: session?.email ?? null });
    }
  };

  private stopSync(): void {
    this.fence = null;
    this.unsubscribeSync?.();
    this.unsubscribeSync = undefined;
    this.unsubscribeRepository?.();
    this.unsubscribeRepository = undefined;
    this.sync?.stop();
    this.sync = null;
    this.pendingRevision += 1;
  }

  private observeSync(repository: LocalRepository, sync: NotebookSync): void {
    const changed = () => {
      for (const note of repository.getSnapshot().notes) {
        const state = sync.getState(note.id);
        if (state?.type === 'paused' && state.reason === 'session') {
          this.authSession = null;
          this.loseSession(
            'Your cloud session is no longer valid. Sign in to the same account to recover this notebook.',
          );
          return;
        }
      }
      this.update({});
      void this.refreshPending();
    };
    this.unsubscribeSync = sync.subscribe(changed);
    this.unsubscribeRepository = repository.subscribe(
      () => void this.refreshPending(),
    );
    changed();
  }

  private loseSession(message: string, broadcast = true): void {
    this.operation += 1;
    this.stopSync();
    this.snapshot.repository.setEditingPaused(true);
    if (broadcast) this.broadcast('account-hidden');
    this.update({ phase: 'session-lost', message });
    const repository = this.snapshot.repository;
    // Local persistence is still allowed after user editing and cloud callbacks stop.
    void repository.flush().catch(() => {
      if (this.snapshot.repository === repository)
        this.update({
          message:
            'Couldn’t save on this device. Keep this tab open and download your writing.',
        });
    });
  }

  private assertWriter(): void {
    if (this.disposed) throw new Error('This notebook session is closed.');
    if (this.options.localRepository.getSnapshot().mode !== 'writer') {
      const message =
        'Return to the writing tab to manage this account, or close it and reload this tab.';
      this.update({ message });
      throw new Error(message);
    }
  }

  private assertCurrent(operation: number, session: NotebookAuthSession): void {
    if (
      this.disposed ||
      operation !== this.operation ||
      !matches(this.authSession, session)
    )
      throw new Error(
        'The account session changed. Your saved notebooks have been retained.',
      );
  }

  async signIn(email: string, password: string): Promise<void> {
    this.assertWriter();
    if (!['local', 'session-lost'].includes(this.snapshot.phase))
      throw new Error('Finish the current account action before signing in.');
    const revision = this.authRevision;
    const session = await this.options.auth.signIn(email, password);
    // An SDK callback may already have delivered this session. A newer logout wins.
    if (revision === this.authRevision) this.sessionChanged(session);
    if (!matches(this.authSession, session))
      throw new Error('Sign-in did not leave a verified current session.');
    await this.openAccountNotebook();
  }

  async openAccountNotebook(): Promise<void> {
    this.assertWriter();
    if (!this.options.auth.configured)
      throw new Error('Cloud accounts are not configured in this preview.');
    if (!['local', 'session-lost'].includes(this.snapshot.phase))
      throw new Error(
        'Finish the current account action before opening a notebook.',
      );
    const session = this.authSession;
    if (!session?.verified || session.accountId === LOCAL_ACCOUNT_ID)
      throw new Error(
        'Sign in with a verified email before opening an account notebook.',
      );
    const previous = this.snapshot;
    if (
      previous.phase === 'session-lost' &&
      previous.repository.accountId !== LOCAL_ACCOUNT_ID &&
      previous.repository.accountId !== session.accountId
    )
      throw new Error(
        'This saved notebook belongs to a different account. Sign in to its original account to recover it, or return to your local notebook first.',
      );
    const operation = ++this.operation;
    this.stopSync();
    previous.repository.setEditingPaused(true);
    this.openedSession = session;
    this.update({
      phase: 'opening',
      accountId: session.accountId,
      email: session.email,
      message: null,
    });
    let repository: LocalRepository | undefined;
    try {
      await previous.repository.flush();
      this.assertCurrent(operation, session);
      repository = await this.options.openAccount(session.accountId);
      this.assertCurrent(operation, session);
      repository.setEditingPaused(true);
      if (
        repository.accountId !== session.accountId ||
        repository.getSnapshot().mode !== 'writer'
      )
        throw new Error(
          'The account notebook does not belong to this writing session.',
        );
      // Once the source has settled, retain this validated cache for export even
      // when remote startup fails. It stays paused and hidden during opening.
      this.update({ repository });
      const epoch = await this.options.getEpoch();
      this.assertCurrent(operation, session);
      this.fence = Object.freeze({
        accountId: session.accountId,
        sessionId: session.sessionId,
        writerId: repository.writerId,
        epoch,
      });
      const sync = await this.options.startSync(
        repository,
        this.fence,
        this.getCurrentFence,
      );
      if (
        operation !== this.operation ||
        !matches(this.authSession, session) ||
        this.disposed
      ) {
        sync.stop();
        this.assertCurrent(operation, session);
      }
      this.sync = sync;
      repository.setEditingPaused(false);
      this.update({
        phase: 'account',
        repository,
        accountId: session.accountId,
        email: session.email,
        message: null,
        pendingCount: 0,
      });
      this.observeSync(repository, sync);
      await this.refreshPending();
    } catch (error) {
      if (operation === this.operation && !this.disposed) {
        repository?.setEditingPaused(true);
        this.stopSync();
        if (repository && this.snapshot.repository === repository) {
          this.update({ phase: 'session-lost', message: messageOf(error) });
        } else {
          this.openedSession =
            previous.phase === 'local' ? null : this.openedSession;
          if (previous.phase === 'local')
            previous.repository.setEditingPaused(false);
          this.update({
            ...previous,
            phase: previous.phase === 'local' ? 'local' : 'session-lost',
            message: messageOf(error),
          });
        }
      }
      throw error;
    }
  }

  async useLocalNotebook(): Promise<void> {
    this.assertWriter();
    if (this.snapshot.phase === 'local') return;
    if (
      ['opening', 'signing-out', 'logout-pending'].includes(this.snapshot.phase)
    )
      throw new Error('Finish or cancel the current account action first.');
    const repository = this.snapshot.repository;
    const operation = ++this.operation;
    repository.setEditingPaused(true);
    this.stopSync();
    this.update({ phase: 'opening', message: null });
    try {
      await repository.flush();
      if (operation !== this.operation || this.disposed) return;
      this.openedSession = null;
      this.options.localRepository.setEditingPaused(false);
      this.update({
        phase: 'local',
        repository: this.options.localRepository,
        accountId: this.authSession?.accountId ?? null,
        email: this.authSession?.email ?? null,
        pendingCount: 0,
        message: null,
      });
    } catch (error) {
      if (operation === this.operation)
        this.update({ phase: 'session-lost', message: messageOf(error) });
      throw error;
    }
  }

  private async refreshPending(): Promise<number> {
    const repository = this.snapshot.repository;
    if (repository.accountId === LOCAL_ACCOUNT_ID) return 0;
    const revision = ++this.pendingRevision;
    try {
      const pendingCount = await repository.getPendingSyncCount();
      if (
        revision === this.pendingRevision &&
        this.snapshot.repository === repository
      )
        this.update({ pendingCount });
      return pendingCount;
    } catch (error) {
      if (revision === this.pendingRevision)
        this.update({ pendingCount: -1, message: messageOf(error) });
      // An unavailable queue is never evidence that logout is safe.
      return -1;
    }
  }

  async requestLogout(): Promise<void> {
    if (this.options.localRepository.getSnapshot().mode !== 'writer') {
      if (this.authSession) this.broadcast('logout-request', this.authSession);
      this.update({
        message:
          'Logout was requested in the writing tab. Return there to wait for cloud saves or cancel. If that tab is unavailable, close it and reload this tab.',
      });
      return;
    }
    this.assertWriter();
    if (this.snapshot.phase === 'local') await this.openAccountNotebook();
    if (this.snapshot.phase !== 'account')
      throw new Error(
        'Recover the account session before logging out. Your drafts remain on this device.',
      );
    const repository = this.snapshot.repository;
    repository.setEditingPaused(true);
    const operation = ++this.operation;
    this.update({ phase: 'logout-pending', message: null });
    try {
      await repository.flush();
      if (operation === this.operation) await this.refreshPending();
    } catch (error) {
      if (operation === this.operation)
        this.update({ message: messageOf(error) });
      throw error;
    }
  }

  cancelLogout(): void {
    this.assertWriter();
    if (this.snapshot.phase !== 'logout-pending') return;
    if (!matches(this.openedSession, this.authSession)) {
      this.loseSession('Sign in to the same account to recover this notebook.');
      return;
    }
    this.operation += 1;
    this.snapshot.repository.setEditingPaused(false);
    this.update({ phase: 'account', message: null });
  }

  async finishLogout(): Promise<void> {
    this.assertWriter();
    if (this.snapshot.phase !== 'logout-pending' || !this.openedSession)
      throw new Error('Request logout and resolve pending cloud saves first.');
    const session = this.openedSession;
    const operation = ++this.operation;
    const repository = this.snapshot.repository;
    await repository.flush();
    this.assertCurrent(operation, session);
    const pending = await this.refreshPending();
    this.assertCurrent(operation, session);
    if (pending !== 0)
      throw new Error(
        'Cloud saves are still pending. Wait for them or cancel logout; your writing is retained.',
      );
    const previousFence = this.fence;
    this.stopSync();
    this.update({ phase: 'signing-out', message: null });
    this.broadcast('account-hidden', session);
    try {
      await this.options.auth.signOutLocal();
      if (operation !== this.operation || this.disposed) return;
      this.authSession = null;
      this.openedSession = null;
      this.options.localRepository.setEditingPaused(false);
      this.update({
        phase: 'local',
        repository: this.options.localRepository,
        accountId: null,
        email: null,
        pendingCount: 0,
        message: null,
      });
    } catch (error) {
      if (operation === this.operation && !this.disposed) {
        // No records are removed, including already acknowledged drafts.
        if (previousFence && matches(this.authSession, session)) {
          try {
            this.fence = previousFence;
            const sync = await this.options.startSync(
              repository,
              previousFence,
              this.getCurrentFence,
            );
            if (
              operation !== this.operation ||
              !matches(this.authSession, session) ||
              this.disposed
            )
              sync.stop();
            this.assertCurrent(operation, session);
            this.sync = sync;
            this.update({ phase: 'logout-pending', message: messageOf(error) });
            this.observeSync(repository, sync);
          } catch {
            if (operation === this.operation) {
              this.stopSync();
              this.update({ phase: 'session-lost', message: messageOf(error) });
            }
          }
        } else {
          this.update({ phase: 'session-lost', message: messageOf(error) });
        }
      }
      throw error;
    }
  }

  private broadcast(
    type: 'logout-request' | 'account-hidden',
    session = this.openedSession,
  ): void {
    if (!session) return;
    this.channel?.postMessage({
      type,
      accountId: session.accountId,
      sessionId: session.sessionId,
      senderId: this.senderId,
    });
  }

  private receiveControl = (event: MessageEvent<unknown>): void => {
    const message = event.data as Record<string, unknown> | null;
    if (
      !message ||
      message.senderId === this.senderId ||
      message.accountId !== this.authSession?.accountId ||
      message.sessionId !== this.authSession?.sessionId
    )
      return;
    const writer = this.options.localRepository.getSnapshot().mode === 'writer';
    if (
      message.type === 'logout-request' &&
      writer &&
      ['local', 'account'].includes(this.snapshot.phase)
    ) {
      void this.requestLogout().catch((error: unknown) =>
        this.update({ message: messageOf(error) }),
      );
    } else if (message.type === 'account-hidden' && !writer) {
      const notice =
        'The writing tab has paused this account. Return there to finish the account action, or reload after that tab closes.';
      if (this.snapshot.repository.accountId === LOCAL_ACCOUNT_ID) {
        // A reader still displaying its independent preview has no account
        // contents to hide. Keep those local drafts reachable and clear identity.
        this.authSession = null;
        this.update({
          phase: 'local',
          accountId: null,
          email: null,
          message: notice,
        });
      } else {
        this.loseSession(notice, false);
      }
    }
  };

  dispose(): void {
    this.operation += 1;
    this.disposed = true;
    this.stopSync();
    this.unsubscribeAuth?.();
    if (this.snapshot.repository.accountId !== LOCAL_ACCOUNT_ID)
      this.snapshot.repository.setEditingPaused(true);
    this.channel?.close();
    this.listeners.clear();
  }
}
