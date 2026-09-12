import { SyncPersistence } from '../sync/persistence';
import {
  applyAckToDraft,
  sameCanonicalState,
  type MutationAcknowledgement,
} from '../sync/protocol';
import type { CallbackFence, SealedMutation } from './types';
import { AiryDatabase } from './database';
import { BoundedJournal } from './journal';
import { OriginWriterLease, type WriterLease } from './writer-lock';
import {
  LOCAL_ACCOUNT_ID,
  MAX_BODY_BYTES,
  type FolderRecord,
  type NotePatch,
  type NoteRecord,
  type RepositorySnapshot,
  type SaveStatus,
} from './types';

export interface RepositoryOptions {
  databaseName?: string;
  accountId?: string;
  /** Dependency injection for storage and multi-tab failure tests. */
  lease?: WriterLease;
  journalDelayMs?: number;
}

function validateTitle(title: string): void {
  if ([...title].length > 200)
    throw new Error('Titles can contain up to 200 characters.');
  if (title.includes('\0'))
    throw new Error('Titles cannot contain NUL characters.');
}

export class LocalRepository {
  readonly accountId: string;
  readonly writerId = crypto.randomUUID();
  readonly database: AiryDatabase;
  private lease: WriterLease;
  private notes = new Map<string, NoteRecord>();
  private folders = new Map<string, FolderRecord>();
  private committed = new Map<string, number>();
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  private organizationWrites = new Set<Promise<unknown>>();
  private organizationQueue: Promise<void> = Promise.resolve();
  private deletingFolders = new Set<string>();
  private reloadGeneration = 0;
  private appliedReloadGeneration = 0;
  private channel: BroadcastChannel | undefined;
  private initialization: Promise<RepositorySnapshot> | undefined;
  private closing = false;
  private snapshot: RepositorySnapshot = {
    ready: false,
    mode: 'readonly',
    notes: [],
    folders: [],
    statuses: {},
    error: null,
  };
  private journal: BoundedJournal<NoteRecord>;
  private persistenceQueue: Promise<unknown> = Promise.resolve();

  constructor(options: RepositoryOptions = {}) {
    this.accountId = options.accountId ?? LOCAL_ACCOUNT_ID;
    this.database = new AiryDatabase(options.databaseName);
    this.lease = options.lease ?? new OriginWriterLease();
    this.journal = new BoundedJournal({
      delayMs: options.journalDelayMs,
      write: (record) =>
        this.serializePersistence(async () => {
          this.assertWriter();
          // Resolve after queued acknowledgements have corrected live metadata.
          Object.assign(record, this.notes.get(record.id) ?? record);
          await this.database.transaction(
            'rw',
            this.database.drafts,
            this.database.intents,
            this.database.bases,
            async () => {
              // A reply may advance the base while this snapshot waits to be written.
              const base = await this.database.bases.get([
                this.accountId,
                record.id,
              ]);
              const persisted = await this.database.drafts.get([
                this.accountId,
                record.id,
              ]);
              if (
                persisted &&
                persisted.generation === record.generation &&
                persisted.writerId === record.writerId &&
                persisted.baseVersion === record.baseVersion &&
                persisted.kind === record.kind &&
                sameCanonicalState(persisted, record)
              )
                return;
              await this.database.drafts.put({
                ...record,
                baseVersion: base?.version ?? record.baseVersion,
              });
              await this.database.intents.put({
                accountId: this.accountId,
                noteId: record.id,
                generation: record.generation,
              });
            },
          );
        }),
      committed: (record) => {
        this.committed.set(record.id, record.generation);
        this.failed.delete(record.id);
        this.emit();
        this.channel?.postMessage({
          type: 'refresh',
          accountId: this.accountId,
          writerId: this.writerId,
        });
      },
      failed: (record) => {
        this.failed.add(record.id);
        this.snapshot = {
          ...this.snapshot,
          error:
            'Couldn’t save on this device. Keep this tab open and download your writing.',
        };
        this.emit();
      },
    });
  }

  initialize(): Promise<RepositorySnapshot> {
    this.initialization ??= this.start();
    return this.initialization;
  }

  private async start(): Promise<RepositorySnapshot> {
    const mode = await this.lease.acquire();
    this.snapshot = { ...this.snapshot, mode };
    try {
      await this.database.open();
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('airytype:control');
        this.channel.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data as {
            type?: string;
            accountId?: string;
          } | null;
          if (
            message?.type === 'refresh' &&
            message.accountId === this.accountId &&
            this.snapshot.mode !== 'writer'
          ) {
            void this.reload().catch(() => {
              this.snapshot = {
                ...this.snapshot,
                error:
                  'Couldn’t refresh the saved copy. Your writing tab still owns changes.',
              };
              this.emit();
            });
          }
        };
      }
      // Subscribe before the initial read so a commit during startup is not missed.
      await this.reload();
      this.snapshot = { ...this.snapshot, ready: true };
      this.emit();
      return this.snapshot;
    } catch (error) {
      this.channel?.close();
      await this.lease.release();
      this.snapshot = {
        ...this.snapshot,
        ready: true,
        mode: 'unsupported',
        error:
          'Browser storage is unavailable. Writing is disabled to protect your work.',
      };
      this.emit();
      throw error;
    }
  }

  private async reload(): Promise<void> {
    // Only startup loads the writer's state. Read-only refreshes cannot touch live writing.
    if (this.snapshot.ready && this.snapshot.mode === 'writer') return;
    const reloadGeneration = ++this.reloadGeneration;
    const [notes, folders] = await this.database.transaction(
      'r',
      this.database.drafts,
      this.database.folders,
      async () =>
        Promise.all([
          this.database.drafts
            .where('accountId')
            .equals(this.accountId)
            .toArray(),
          this.database.folders
            .where('accountId')
            .equals(this.accountId)
            .toArray(),
        ]),
    );
    if (reloadGeneration < this.appliedReloadGeneration || this.closing) return;
    this.appliedReloadGeneration = reloadGeneration;
    this.notes = new Map(notes.map((note) => [note.id, note]));
    this.folders = new Map(folders.map((folder) => [folder.id, folder]));
    this.committed = new Map(notes.map((note) => [note.id, note.generation]));
    this.emit();
  }

  private assertWriter(): void {
    if (this.snapshot.mode !== 'writer')
      throw new Error(
        'This tab is read-only. Return to the writing tab, or close it and reload this tab.',
      );
  }

  private assertEditable(): void {
    this.assertWriter();
    if (this.closing) throw new Error('The writing tab is closing.');
  }

  private emit(): void {
    const statuses: Record<string, SaveStatus> = {};
    for (const note of this.notes.values()) {
      statuses[note.id] = this.failed.has(note.id)
        ? 'error'
        : this.committed.get(note.id) === note.generation
          ? 'saved-local'
          : 'saving';
    }
    this.snapshot = Object.freeze({
      ...this.snapshot,
      notes: Object.freeze(
        [...this.notes.values()]
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .map((note) => Object.freeze({ ...note })),
      ),
      folders: Object.freeze(
        [...this.folders.values()]
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          )
          .map((folder) => Object.freeze({ ...folder })),
      ),
      statuses: Object.freeze(statuses),
      error: this.failed.size
        ? this.snapshot.error
        : this.snapshot.error?.startsWith('Couldn’t save')
          ? null
          : this.snapshot.error,
    });
    for (const listener of this.listeners) listener();
  }

  getSnapshot = (): RepositorySnapshot => Object.freeze(this.snapshot);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getNote(id: string): NoteRecord | undefined {
    const note = this.notes.get(id);
    return note ? { ...note } : undefined;
  }
  listNotes(options: { includeTrash?: boolean } = {}): NoteRecord[] {
    return this.snapshot.notes
      .filter((note) => options.includeTrash || !note.deletedAt)
      .map((note) => ({ ...note }));
  }

  async createNote(
    input: { title?: string; body?: string; folderId?: string | null } = {},
  ): Promise<NoteRecord> {
    this.assertEditable();
    validateTitle(input.title ?? '');
    this.validateFolder(input.folderId ?? null);
    const body = input.body ?? '';
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > MAX_BODY_BYTES)
      throw new Error('Each new note can contain up to 1 MiB of UTF-8 text.');
    if (body.includes('\0'))
      throw new Error('New notes cannot contain NUL characters.');
    const retained = [...this.notes.values()].filter(
      (note) => note.kind === 'normal',
    );
    if (
      retained.length >= 2000 ||
      retained.filter((note) => !note.deletedAt).length >= 1000
    )
      throw new Error(
        'This preview has reached its note limit. Existing writing and export remain available.',
      );
    const retainedBytes = retained.reduce(
      (total, note) => total + new TextEncoder().encode(note.body).byteLength,
      0,
    );
    if (retainedBytes + bodyBytes > 50 * MAX_BODY_BYTES)
      throw new Error(
        'This preview has reached its 50 MiB library allowance. Existing writing and export remain available.',
      );
    const now = Date.now();
    const note: NoteRecord = {
      accountId: this.accountId,
      id: crypto.randomUUID(),
      title: input.title ?? '',
      body,
      folderId: input.folderId ?? null,
      kind: 'normal',
      writerId: this.writerId,
      generation: 1,
      baseVersion: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.notes.set(note.id, note);
    this.journal.enqueue(note);
    this.emit();
    await this.flush();
    return { ...this.notes.get(note.id)! };
  }

  updateNote(id: string, patch: NotePatch): number {
    this.assertEditable();
    const current = this.notes.get(id);
    if (!current || current.deletedAt)
      throw new Error('This note is missing or in Trash.');
    if (patch.title !== undefined) validateTitle(patch.title);
    if (patch.folderId !== undefined) this.validateFolder(patch.folderId);
    if (
      Object.entries(patch).every(
        ([key, value]) => current[key as keyof NotePatch] === value,
      )
    )
      return current.generation;
    const note = {
      ...current,
      ...patch,
      writerId: this.writerId,
      generation: current.generation + 1,
      updatedAt: Date.now(),
    };
    this.notes.set(id, note);
    this.failed.delete(id);
    this.journal.enqueue(note);
    this.emit();
    return note.generation;
  }

  async flush(_noteId?: string): Promise<void> {
    if (this.snapshot.mode === 'writer') await this.journal.flush();
  }

  private serializePersistence<T>(action: () => Promise<T>): Promise<T> {
    const result = this.persistenceQueue.then(action);
    this.persistenceQueue = result.catch(() => {});
    return result;
  }

  /** The session supplier must be invalidated synchronously on session loss. */
  private syncPersistence(
    currentFence: () => CallbackFence | null,
  ): SyncPersistence {
    return new SyncPersistence(this.database, () => {
      const fence = currentFence();
      if (
        this.closing ||
        this.snapshot.mode !== 'writer' ||
        !fence ||
        fence.accountId !== this.accountId ||
        fence.writerId !== this.writerId ||
        this.accountId === LOCAL_ACCOUNT_ID
      )
        return null;
      return fence;
    });
  }

  async sealForSync(
    noteId: string,
    fence: CallbackFence,
    currentFence: () => CallbackFence | null,
  ): Promise<Readonly<SealedMutation>> {
    this.assertEditable();
    await this.flush();
    return this.serializePersistence(() =>
      this.syncPersistence(currentFence).seal(noteId, fence),
    );
  }

  acknowledgeSync(
    request: Readonly<SealedMutation>,
    ack: MutationAcknowledgement,
    fence: CallbackFence,
    currentFence: () => CallbackFence | null,
  ): Promise<void> {
    return this.serializePersistence(async () => {
      await this.syncPersistence(currentFence).acknowledge(request, ack, fence);
      const current = this.notes.get(request.noteId);
      if (current)
        this.notes.set(current.id, applyAckToDraft(current, request, ack));
      this.organizationChanged();
    });
  }

  private validateFolder(folderId: string | null): void {
    if (folderId && !this.folders.has(folderId))
      throw new Error('That folder no longer exists.');
    if (folderId && this.deletingFolders.has(folderId))
      throw new Error('That folder is being removed. Choose another folder.');
  }

  private async setTrashed(id: string, trashed: boolean): Promise<void> {
    this.assertEditable();
    await this.flush();
    this.assertEditable();
    const current = this.notes.get(id);
    if (!current) throw new Error('This note no longer exists.');
    if (
      !trashed &&
      current.deletedAt &&
      [...this.notes.values()].filter(
        (note) => note.kind === 'normal' && !note.deletedAt,
      ).length >= 1000
    ) {
      throw new Error(
        'This preview has reached its active note limit. The note remains preserved in Trash.',
      );
    }
    const folderId =
      current.folderId &&
      (!this.folders.has(current.folderId) ||
        this.deletingFolders.has(current.folderId))
        ? null
        : current.folderId;
    const note = {
      ...current,
      folderId,
      deletedAt: trashed ? Date.now() : null,
      updatedAt: Date.now(),
      generation: current.generation + 1,
      writerId: this.writerId,
    };
    this.notes.set(id, note);
    this.journal.enqueue(note);
    this.emit();
    await this.flush();
  }
  trashNote(id: string): Promise<void> {
    return this.setTrashed(id, true);
  }
  restoreNote(id: string): Promise<void> {
    return this.setTrashed(id, false);
  }

  async createFolder(
    name: string,
    parentId: string | null = null,
  ): Promise<FolderRecord> {
    return this.runOrganization(async () => {
      this.validateFolder(parentId);
      if (!name.trim() || [...name].length > 80 || name.includes('\0'))
        throw new Error('Use a folder name between 1 and 80 characters.');
      if (this.folders.size >= 100)
        throw new Error('This preview supports up to 100 folders.');
      let depth = 1;
      let parent = parentId;
      while (parent) {
        depth += 1;
        parent = this.folders.get(parent)?.parentId ?? null;
      }
      if (depth > 3)
        throw new Error('Folders can be nested up to three levels.');
      const now = Date.now();
      const folder = {
        accountId: this.accountId,
        id: crypto.randomUUID(),
        name: name.trim(),
        parentId,
        createdAt: now,
        updatedAt: now,
      };
      await this.database.folders.add(folder);
      this.folders.set(folder.id, folder);
      this.organizationChanged();
      return { ...folder };
    });
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.runOrganization(async () => {
      const current = this.folders.get(id);
      if (!current) throw new Error('This folder no longer exists.');
      if (!name.trim() || [...name].length > 80 || name.includes('\0'))
        throw new Error('Use a folder name between 1 and 80 characters.');
      const folder = { ...current, name: name.trim(), updatedAt: Date.now() };
      await this.database.folders.put(folder);
      this.folders.set(id, folder);
      this.organizationChanged();
    });
  }

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await this.runOrganization(async () => {
      const current = this.folders.get(id);
      if (!current) throw new Error('This folder no longer exists.');
      this.validateFolder(parentId);
      let ancestor = parentId;
      let parentDepth = 0;
      const seen = new Set<string>();
      while (ancestor) {
        if (ancestor === id || seen.has(ancestor))
          throw new Error(
            'A folder cannot be moved inside itself or one of its children.',
          );
        seen.add(ancestor);
        parentDepth += 1;
        ancestor = this.folders.get(ancestor)?.parentId ?? null;
      }
      const subtreeHeight = (folderId: string): number => {
        const children = [...this.folders.values()].filter(
          (folder) => folder.parentId === folderId,
        );
        return (
          1 + Math.max(0, ...children.map((folder) => subtreeHeight(folder.id)))
        );
      };
      if (parentDepth + subtreeHeight(id) > 3)
        throw new Error(
          'This move would place a child deeper than three folder levels.',
        );
      const folder = { ...current, parentId, updatedAt: Date.now() };
      await this.database.folders.put(folder);
      this.folders.set(id, folder);
      this.organizationChanged();
    });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.runOrganization(async () => {
      if (!this.folders.has(id))
        throw new Error('This folder no longer exists.');
      if ([...this.folders.values()].some((folder) => folder.parentId === id))
        throw new Error('Move this folder’s children out before removing it.');
      if (
        [...this.notes.values()].some(
          (note) => note.folderId === id && !note.deletedAt,
        )
      )
        throw new Error('Move this folder’s notes out before removing it.');
      this.deletingFolders.add(id);
      try {
        await this.database.folders.delete([this.accountId, id]);
        this.folders.delete(id);
        this.organizationChanged();
      } finally {
        this.deletingFolders.delete(id);
      }
    });
  }

  private organizationChanged(): void {
    this.emit();
    this.channel?.postMessage({
      type: 'refresh',
      accountId: this.accountId,
      writerId: this.writerId,
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await Promise.all(this.organizationWrites);
      if (this.snapshot.mode === 'writer') await this.journal.close();
    } catch (error) {
      this.closing = false;
      throw error; // Keep ownership and the tab's memory if local persistence fails.
    }
    await this.persistenceQueue;
    this.channel?.close();
    this.database.close();
    await this.lease.release();
  }

  private async runOrganization<T>(action: () => Promise<T>): Promise<T> {
    this.assertEditable();
    const write = this.organizationQueue.then(() => {
      this.assertWriter();
      return action();
    });
    this.organizationQueue = write.then(
      () => {},
      () => {},
    );
    this.organizationWrites.add(write);
    try {
      return await write;
    } finally {
      this.organizationWrites.delete(write);
    }
  }
}

export function createLocalRepository(
  options: RepositoryOptions = {},
): LocalRepository {
  return new LocalRepository(options);
}
