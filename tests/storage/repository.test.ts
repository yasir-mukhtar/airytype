import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalRepository,
  type LocalRepository,
} from '../../src/storage/repository';
import type { WriterLease } from '../../src/storage/writer-lock';

const repositories: LocalRepository[] = [];
const writerLease = (): WriterLease => ({
  acquire: async () => 'writer',
  release: async () => {},
});
function repository(
  databaseName = `test-${crypto.randomUUID()}`,
  accountId = 'local-preview',
  lease = writerLease(),
) {
  const repo = createLocalRepository({
    databaseName,
    accountId,
    lease,
    journalDelayMs: 100,
  });
  repositories.push(repo);
  return repo;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const repo of repositories.splice(0)) {
    await repo.close();
    await repo.database.delete();
  }
});

describe('local repository', () => {
  it('only reports the current generation saved after a local transaction commits, and reloads exact bytes', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repo = repository(name);
    await repo.initialize();
    const note = await repo.createNote({
      title: 'Draft',
      body: 'first generation',
    });
    const body = '# Selamat pagi 👩🏽‍💻\n\n  spaces  \nCafe\u0301.\n';
    repo.updateNote(note.id, { body });
    expect(repo.getNote(note.id)?.body).toBe(body);
    expect(repo.getSnapshot().statuses[note.id]).toBe('saving');
    await repo.flush();
    expect(repo.getSnapshot().statuses[note.id]).toBe('saved-local');
    expect(
      (await repo.database.intents.get([repo.accountId, note.id]))?.generation,
    ).toBe(2);
    await repo.close();
    const resumed = repository(name);
    await resumed.initialize();
    expect(resumed.getNote(note.id)?.body).toBe(body);
    expect(resumed.getNote(note.id)?.generation).toBe(2);
    expect(resumed.getSnapshot().statuses[note.id]).toBe('saved-local');
  });

  it('a late generation commit does not acknowledge newer editor memory', async () => {
    const repo = repository();
    await repo.initialize();
    const note = await repo.createNote({ body: 'one' });
    let lateObserved = false;
    repo.subscribe(() => {
      if (
        repo.getNote(note.id)?.generation === 2 &&
        repo.getSnapshot().statuses[note.id] === 'saved-local'
      ) {
        repo.updateNote(note.id, { body: 'newer sentinel three' });
        lateObserved = repo.getSnapshot().statuses[note.id] === 'saving';
      }
    });
    repo.updateNote(note.id, { body: 'two' });
    await repo.flush();
    expect(lateObserved).toBe(true);
    expect(repo.getNote(note.id)?.body).toBe('newer sentinel three');
    expect(
      (await repo.database.drafts.get([repo.accountId, note.id]))?.body,
    ).toBe('newer sentinel three');
  });

  it('retains memory and a failed status after an aborted transaction', async () => {
    const repo = repository();
    await repo.initialize();
    const note = await repo.createNote({ body: 'durable before failure' });
    vi.spyOn(repo.database.intents, 'put').mockRejectedValueOnce(
      new Error('QuotaExceededError'),
    );
    repo.updateNote(note.id, { body: 'memory-only sentinel after failure' });
    await expect(repo.flush()).rejects.toThrow('QuotaExceededError');
    expect(repo.getNote(note.id)?.body).toBe(
      'memory-only sentinel after failure',
    );
    expect(repo.getSnapshot().statuses[note.id]).toBe('error');
    expect(
      (await repo.database.drafts.get([repo.accountId, note.id]))?.body,
    ).toBe('durable before failure');
    await repo.flush();
    expect(repo.getSnapshot().statuses[note.id]).toBe('saved-local');
  });

  it('keeps namespaces separate and blocks every mutation in a secondary tab', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const owner = repository(name, 'account-a');
    await owner.initialize();
    const note = await owner.createNote({ body: 'private account a' });
    const other = repository(name, 'account-b', {
      acquire: async () => 'readonly',
      release: async () => {},
    });
    await other.initialize();
    expect(other.listNotes()).toEqual([]);
    await expect(other.createNote({ body: 'forbidden' })).rejects.toThrow(
      'read-only',
    );
    expect(() => other.updateNote(note.id, { body: 'forbidden' })).toThrow(
      'read-only',
    );
    await expect(other.createFolder('forbidden')).rejects.toThrow('read-only');
    await expect(other.trashNote(note.id)).rejects.toThrow('read-only');
  });

  it('settles edits before trash and retains exact body for restoration', async () => {
    const repo = repository();
    await repo.initialize();
    const folder = await repo.createFolder('Writing');
    const note = await repo.createNote({
      title: 'An essay',
      body: 'old',
      folderId: folder.id,
    });
    repo.updateNote(note.id, { body: 'latest before trash' });
    await repo.trashNote(note.id);
    expect(repo.listNotes()).toHaveLength(0);
    expect(repo.listNotes({ includeTrash: true })[0].body).toBe(
      'latest before trash',
    );
    await repo.restoreNote(note.id);
    expect(repo.listNotes()[0].body).toBe('latest before trash');
    expect(repo.listNotes()[0].folderId).toBe(folder.id);
  });

  it('isolates caller objects and exposes a frozen stable snapshot', async () => {
    const repo = repository();
    await repo.initialize();
    const created = await repo.createNote({ body: 'protected text' });
    created.body = 'accidental external mutation';
    repo.getNote(created.id)!.body = 'another external mutation';
    repo.listNotes()[0].body = 'array result mutation';
    expect(repo.getNote(created.id)?.body).toBe('protected text');
    const snapshot = repo.getSnapshot();
    expect(repo.getSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.notes)).toBe(true);
    expect(Object.isFrozen(snapshot.notes[0])).toBe(true);
  });

  it('validates the whole moved subtree, rejects cycles, and serializes competing moves', async () => {
    const repo = repository();
    await repo.initialize();
    const a = await repo.createFolder('A');
    const b = await repo.createFolder('B', a.id);
    const c = await repo.createFolder('C', b.id);
    const other = await repo.createFolder('Other');
    await expect(repo.moveFolder(a.id, c.id)).rejects.toThrow('inside itself');
    await expect(repo.moveFolder(a.id, other.id)).rejects.toThrow(
      'deeper than three',
    );
    await repo.moveFolder(b.id, other.id);
    expect(
      repo.getSnapshot().folders.find((folder) => folder.id === b.id)?.parentId,
    ).toBe(other.id);
    const x = await repo.createFolder('X');
    const y = await repo.createFolder('Y');
    const results = await Promise.allSettled([
      repo.moveFolder(x.id, y.id),
      repo.moveFolder(y.id, x.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
  });

  it('removes only empty folders and restores trashed notes at root if the old folder is gone', async () => {
    const repo = repository();
    await repo.initialize();
    const folder = await repo.createFolder('Writing');
    const child = await repo.createFolder('Child', folder.id);
    await expect(repo.deleteFolder(folder.id)).rejects.toThrow('children');
    await repo.deleteFolder(child.id);
    const note = await repo.createNote({
      body: 'retained trash sentinel',
      folderId: folder.id,
    });
    await expect(repo.deleteFolder(folder.id)).rejects.toThrow('notes');
    await repo.trashNote(note.id);
    await repo.deleteFolder(folder.id);
    await repo.restoreNote(note.id);
    expect(repo.getNote(note.id)).toMatchObject({
      body: 'retained trash sentinel',
      folderId: null,
      deletedAt: null,
    });
  });

  it('keeps the writer lease until outstanding organization writes finish', async () => {
    const release = vi.fn(async () => {});
    const repo = repository(undefined, undefined, {
      acquire: async () => 'writer',
      release,
    });
    await repo.initialize();
    let finishWrite!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const originalAdd = repo.database.folders.add.bind(repo.database.folders);
    vi.spyOn(repo.database.folders, 'add').mockImplementationOnce((...args) =>
      Dexie.Promise.resolve(pending).then(() => originalAdd(...args)),
    );
    const creating = repo.createFolder('Pending folder');
    await Promise.resolve();
    const closing = repo.close();
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    finishWrite();
    await creating;
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects oversized new imports but preserves a complete oversized interactive draft', async () => {
    const repo = repository();
    await repo.initialize();
    const oversized = '🙂'.repeat(262145);
    await expect(repo.createNote({ body: oversized })).rejects.toThrow('1 MiB');
    expect(repo.listNotes()).toHaveLength(0);
    const note = await repo.createNote();
    repo.updateNote(note.id, { body: oversized });
    await repo.flush();
    expect(repo.getNote(note.id)?.body).toBe(oversized);
    expect(repo.getSnapshot().statuses[note.id]).toBe('saved-local');
  });

  it('keeps the lease and failed memory available when closing cannot commit the latest draft', async () => {
    const release = vi.fn(async () => {});
    const repo = repository(undefined, undefined, {
      acquire: async () => 'writer',
      release,
    });
    await repo.initialize();
    const note = await repo.createNote({ body: 'last durable text' });
    const failingWrite = vi
      .spyOn(repo.database.intents, 'put')
      .mockRejectedValue(new Error('storage unavailable'));
    repo.updateNote(note.id, { body: 'must stay exportable in this tab' });
    await expect(repo.close()).rejects.toThrow('storage unavailable');
    expect(release).not.toHaveBeenCalled();
    expect(repo.getNote(note.id)?.body).toBe(
      'must stay exportable in this tab',
    );
    expect(repo.getSnapshot().statuses[note.id]).toBe('error');
    failingWrite.mockRestore();
    repo.updateNote(note.id, { body: 'typing resumes after cancelled close' });
    await repo.flush();
    expect(repo.getSnapshot().statuses[note.id]).toBe('saved-local');
  });

  it('reserves creation limits without preventing existing edits, trash or export access', async () => {
    const repo = repository();
    await repo.database.open();
    const seed = Array.from({ length: 1000 }, (_, index) => ({
      accountId: repo.accountId,
      id: `note-${index}`,
      title: `Draft ${index}`,
      body: `sentinel ${index}`,
      folderId: null,
      kind: 'normal' as const,
      writerId: 'previous-writer',
      generation: 1,
      baseVersion: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    }));
    await repo.database.drafts.bulkPut(seed);
    await repo.initialize();
    await expect(repo.createNote({ body: 'new' })).rejects.toThrow(
      'note limit',
    );
    repo.updateNote('note-0', { body: 'existing writing is still protected' });
    await repo.flush();
    expect(repo.getNote('note-0')?.body).toBe(
      'existing writing is still protected',
    );
    await repo.trashNote('note-1');
    await repo.createNote({ body: 'now there is room' });
    await expect(repo.restoreNote('note-1')).rejects.toThrow(
      'active note limit',
    );
    expect(repo.getNote('note-1')?.body).toBe('sentinel 1');
    expect(repo.getNote('note-1')?.deletedAt).not.toBeNull();
  });
});
