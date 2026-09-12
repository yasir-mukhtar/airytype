import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository } from '../../src/storage/repository';
import type { BaseRecord, CallbackFence } from '../../src/storage/types';
import {
  loadAccountNotebook,
  refreshAccountNote,
} from '../../src/sync/account-notebook';
import type {
  AccountManifest,
  AccountNotebookTransport,
} from '../../src/sync/protocol';

const repos: LocalRepository[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const repo of repos.splice(0)) {
    await repo.close();
    await repo.database.delete();
  }
});

function base(patch: Partial<BaseRecord> = {}): BaseRecord {
  return {
    accountId: 'account-a',
    id: 'note-a',
    title: 'Cloud note',
    body: 'accepted writing',
    folderId: null,
    deletedAt: null,
    version: '1',
    epoch: 'epoch',
    kind: 'normal',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    ...patch,
  };
}

function manifest(notes: BaseRecord[]): AccountManifest {
  return {
    epoch: 'epoch',
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      folder_id: note.folderId,
      version: note.version,
      kind: note.kind ?? 'normal',
      body_bytes: new TextEncoder().encode(note.body).byteLength,
      deleted_at:
        note.deletedAt === null ? null : new Date(note.deletedAt).toISOString(),
      purged_at: null,
      created_at: new Date(note.createdAt ?? 0).toISOString(),
      updated_at: new Date(note.updatedAt ?? 0).toISOString(),
    })),
    folders: [],
    counts: {
      normal_active: notes.filter(
        (note) => note.kind !== 'recovery' && !note.deletedAt,
      ).length,
      normal_retained: notes.filter((note) => note.kind !== 'recovery').length,
      recovery_retained: notes.filter((note) => note.kind === 'recovery')
        .length,
      note_tombstones: 0,
      folder_active: 0,
      folder_tombstones: 0,
    },
  };
}

async function setup(notes: BaseRecord[] = []) {
  const repo = new LocalRepository({
    databaseName: `account-read-${crypto.randomUUID()}`,
    accountId: 'account-a',
    lease: { acquire: async () => 'writer', release: async () => {} },
    journalDelayMs: 100,
  });
  repos.push(repo);
  await repo.initialize();
  const transport: AccountNotebookTransport = {
    getServiceState: vi.fn(),
    send: vi.fn(),
    getManifest: vi.fn(async () => manifest(notes)),
    getNote: vi.fn(async (id) => notes.find((note) => note.id === id)!),
  };
  return { repo, transport };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('account notebook startup and clean-note freshness', () => {
  it('installs coherent joined snapshots even when newer than the manifest, retaining recovery and Trash metadata', async () => {
    const initial = base();
    const recovery = base({
      id: 'recovery',
      kind: 'recovery',
      deletedAt: 1_700_000_000_005,
    });
    const { repo, transport } = await setup([initial, recovery]);
    const newer = base({
      version: '3',
      title: 'Coherent title',
      body: 'coherent newer body',
    });
    vi.mocked(transport.getNote)
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce(recovery);
    expect(
      await loadAccountNotebook(repo, transport, 'epoch', () => true),
    ).toEqual({ blockedNoteIds: [], message: null });
    expect(repo.getNote(initial.id)).toMatchObject({
      title: newer.title,
      body: newer.body,
      baseVersion: '3',
      createdAt: newer.createdAt,
    });
    expect(repo.getNote(recovery.id)).toMatchObject({
      kind: 'recovery',
      deletedAt: recovery.deletedAt,
    });
    expect(await repo.database.bases.get([repo.accountId, initial.id])).toEqual(
      newer,
    );
    expect(await repo.database.intents.count()).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('reuses a manifest-verified cached body after reopening the account database', async () => {
    const remote = base();
    const { repo, transport } = await setup([remote]);
    await loadAccountNotebook(repo, transport, 'epoch', () => true);
    await repo.close();
    repos.splice(repos.indexOf(repo), 1);
    const reopened = new LocalRepository({
      databaseName: repo.database.name,
      accountId: repo.accountId,
      lease: { acquire: async () => 'writer', release: async () => {} },
    });
    repos.push(reopened);
    await reopened.initialize();
    vi.mocked(transport.getNote).mockClear();
    await loadAccountNotebook(reopened, transport, 'epoch', () => true);
    expect(reopened.getNote(remote.id)?.body).toBe(remote.body);
    expect(transport.getNote).not.toHaveBeenCalled();
  });

  it('replaces a stale clean copy but preserves both committed and uncommitted dirty writing', async () => {
    const copies = [
      base({ id: 'clean' }),
      base({ id: 'dirty' }),
      base({ id: 'memory' }),
    ];
    const { repo, transport } = await setup(copies);
    for (const copy of copies) await repo.installRemoteNote(copy, () => true);
    repo.updateNote('dirty', { body: 'committed device changes' });
    await repo.flush();
    repo.updateNote('memory', { body: 'memory changes' });
    const advanced = copies.map((copy) => ({
      ...copy,
      version: '2',
      body: 'other device changes',
    }));
    vi.mocked(transport.getManifest).mockResolvedValue(manifest(advanced));
    vi.mocked(transport.getNote).mockImplementation(async (id) =>
      advanced.find((note) => note.id === id)!,
    );
    const result = await loadAccountNotebook(
      repo,
      transport,
      'epoch',
      () => true,
    );
    expect(result.blockedNoteIds.sort()).toEqual(['dirty', 'memory']);
    expect(repo.getNote('clean')?.body).toBe('other device changes');
    expect(repo.getNote('dirty')?.body).toBe('committed device changes');
    expect(repo.getNote('memory')?.body).toBe('memory changes');
    expect(transport.getNote).toHaveBeenCalledTimes(1);
  });

  it('protects clean and dirty previous-epoch copies even when the restored remote version is greater', async () => {
    const clean = base({ epoch: 'previous' });
    const dirty = base({ id: 'dirty', epoch: 'previous' });
    const { repo, transport } = await setup([
      base({ version: '8' }),
      base({ id: 'dirty', version: '8' }),
    ]);
    await repo.installRemoteNote(clean, () => true);
    await repo.installRemoteNote(dirty, () => true);
    repo.updateNote(dirty.id, { body: 'previous epoch pending' });
    await repo.flush();
    const result = await loadAccountNotebook(
      repo,
      transport,
      'epoch',
      () => true,
    );
    expect(result.blockedNoteIds.sort()).toEqual(['dirty', 'note-a']);
    expect(repo.getNote(clean.id)?.body).toBe(clean.body);
    expect(repo.getNote(dirty.id)?.body).toBe('previous epoch pending');
    expect(
      (await repo.database.bases.get([repo.accountId, clean.id]))?.epoch,
    ).toBe('previous');
    expect(transport.getNote).not.toHaveBeenCalled();
  });

  it('leaves an accepted but unacknowledged create available for exact replay', async () => {
    const { repo, transport } = await setup();
    const note = await repo.createNote({ body: 'sealed private writing' });
    const fence: CallbackFence = {
      accountId: repo.accountId,
      writerId: repo.writerId,
      sessionId: 'session',
      epoch: 'epoch',
    };
    const request = await repo.sealForSync(note.id, fence, () => fence);
    repo.updateNote(note.id, {
      body: 'new typing after dropped acknowledgement',
    });
    await repo.flush();
    vi.mocked(transport.getManifest).mockResolvedValue(
      manifest([base({ id: note.id, body: request.body })]),
    );
    expect(
      (await loadAccountNotebook(repo, transport, 'epoch', () => true))
        .blockedNoteIds,
    ).toEqual([]);
    expect(await repo.database.outbox.get([repo.accountId, note.id])).toEqual(
      request,
    );
    expect(repo.getNote(note.id)?.body).toBe(
      'new typing after dropped acknowledgement',
    );
    expect(transport.getNote).not.toHaveBeenCalled();
  });

  it('blocks a previous-epoch create request even when no accepted base exists', async () => {
    const { repo, transport } = await setup();
    const note = await repo.createNote({ body: 'previous dataset creation' });
    const fence: CallbackFence = {
      accountId: repo.accountId,
      writerId: repo.writerId,
      sessionId: 'session',
      epoch: 'previous',
    };
    const request = await repo.sealForSync(note.id, fence, () => fence);
    expect(
      (await loadAccountNotebook(repo, transport, 'epoch', () => true))
        .blockedNoteIds,
    ).toEqual([note.id]);
    expect(await repo.database.outbox.get([repo.accountId, note.id])).toEqual(
      request,
    );
    expect(repo.getNote(note.id)?.body).toBe('previous dataset creation');
  });

  it('opens a new unsent local note without treating its expected remote absence as a conflict', async () => {
    const { repo, transport } = await setup();
    const note = await repo.createNote({ body: 'new local writing' });
    expect(
      (await refreshAccountNote(repo, transport, 'epoch', note.id, () => true))
        .blockedNoteIds,
    ).toEqual([]);
    expect(transport.getNote).not.toHaveBeenCalled();
  });

  it('blocks missing accepted notes and tombstones while allowing local expected-absent creates', async () => {
    const { repo, transport } = await setup();
    await repo.installRemoteNote(base({ id: 'missing' }), () => true);
    await repo.installRemoteNote(base({ id: 'purged' }), () => true);
    const local = await repo.createNote({ body: 'not sent yet' });
    const tombstone = manifest([base({ id: 'purged' })]);
    tombstone.notes[0].purged_at = new Date().toISOString();
    vi.mocked(transport.getManifest).mockResolvedValue(tombstone);
    const result = await loadAccountNotebook(
      repo,
      transport,
      'epoch',
      () => true,
    );
    expect(result.blockedNoteIds.sort()).toEqual(['missing', 'purged']);
    expect(repo.getNote(local.id)?.body).toBe('not sent yet');
    expect(repo.getNote('purged')?.body).toBe('accepted writing');
    expect(transport.getNote).not.toHaveBeenCalled();
  });

  it('rechecks memory after an asynchronous clean-note fetch before applying the remote body', async () => {
    const { repo, transport } = await setup();
    await repo.installRemoteNote(base(), () => true);
    const read = deferred<BaseRecord>();
    vi.mocked(transport.getNote).mockReturnValue(read.promise);
    const refresh = refreshAccountNote(
      repo,
      transport,
      'epoch',
      'note-a',
      () => true,
    );
    await vi.waitFor(() => expect(transport.getNote).toHaveBeenCalled());
    repo.updateNote('note-a', { body: 'typing while cloud read was pending' });
    read.resolve(base({ version: '2', body: 'other device' }));
    expect((await refresh).blockedNoteIds).toEqual(['note-a']);
    expect(repo.getNote('note-a')?.body).toBe(
      'typing while cloud read was pending',
    );
    expect(
      (await repo.database.bases.get([repo.accountId, 'note-a']))?.version,
    ).toBe('1');
  });

  it('fences late reads after session loss and never writes an old response into the namespace', async () => {
    const { repo, transport } = await setup();
    let current = true;
    const read = deferred<BaseRecord>();
    vi.mocked(transport.getNote).mockReturnValue(read.promise);
    const refresh = refreshAccountNote(
      repo,
      transport,
      'epoch',
      'note-a',
      () => current,
    );
    await vi.waitFor(() => expect(transport.getNote).toHaveBeenCalled());
    current = false;
    read.resolve(base());
    await expect(refresh).rejects.toMatchObject({ reason: 'session' });
    expect(repo.getNote('note-a')).toBeUndefined();
    expect(await repo.database.bases.count()).toBe(0);
  });

  it('refuses changed dataset reads while retaining the accepted device copy', async () => {
    const { repo, transport } = await setup();
    await repo.installRemoteNote(base(), () => true);
    vi.mocked(transport.getNote).mockResolvedValue(base({ epoch: 'restored' }));
    await expect(
      refreshAccountNote(repo, transport, 'epoch', 'note-a', () => true),
    ).rejects.toMatchObject({ reason: 'epoch' });
    expect(repo.getNote('note-a')?.body).toBe('accepted writing');
    vi.mocked(transport.getManifest).mockResolvedValue({
      ...manifest([]),
      epoch: 'restored',
    });
    await expect(
      loadAccountNotebook(repo, transport, 'epoch', () => true),
    ).rejects.toMatchObject({ reason: 'epoch' });
  });
});
