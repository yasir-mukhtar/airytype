import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository } from '../../src/storage/repository';
import type { CallbackFence, SealedMutation } from '../../src/storage/types';
import { SyncCoordinator } from '../../src/sync/coordinator';
import { SyncRetry } from '../../src/sync/errors';
import type {
  MutationAcknowledgement,
  SyncTransport,
} from '../../src/sync/protocol';

const repos: LocalRepository[] = [];
const coordinators: SyncCoordinator[] = [];
afterEach(async () => {
  for (const coordinator of coordinators.splice(0)) coordinator.stop();
  vi.restoreAllMocks();
  for (const repo of repos.splice(0)) {
    await repo.close();
    await repo.database.delete();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function acknowledgement(
  request: Readonly<SealedMutation>,
): MutationAcknowledgement {
  return {
    epoch: request.epoch,
    note_id: request.noteId,
    mutation_id: request.mutationId,
    version: String(BigInt(request.expectedVersion ?? '0') + 1n),
    title: request.title,
    folder_id: null,
    deleted_at: null,
    kind: 'normal',
  };
}
async function setup(
  accountId = 'account',
  mode: 'writer' | 'readonly' = 'writer',
) {
  const repo = new LocalRepository({
    databaseName: `coordinator-${crypto.randomUUID()}`,
    accountId,
    lease: { acquire: async () => mode, release: async () => {} },
    journalDelayMs: 100,
  });
  repos.push(repo);
  await repo.initialize();
  let current: CallbackFence | null = {
    accountId,
    writerId: repo.writerId,
    sessionId: 'session',
    epoch: 'epoch',
  };
  const fence = current;
  const transport: SyncTransport = {
    getServiceState: vi.fn(async () => ({
      epoch: 'epoch',
      minimum_protocol: 1,
      reads_enabled: true,
      writes_enabled: true,
    })),
    send: vi.fn(async (request) => acknowledgement(request)),
    getNote: vi.fn(),
  };
  const coordinator = () => {
    const result = new SyncCoordinator(repo, transport, fence, () => current);
    coordinators.push(result);
    return result;
  };
  return {
    repo,
    transport,
    fence,
    current: () => current,
    invalidate: () => {
      current = null;
    },
    coordinator,
  };
}
const wait = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 4000, interval: 10 });

describe('account write coordinator and live journal boundary', () => {
  it('preserves generation 42 while acknowledging 41, including queued metadata and subsequent saves', async () => {
    const { repo, transport, coordinator } = await setup();
    const folder = await repo.createFolder('Folder');
    const note = await repo.createNote({
      body: 'generation 1',
      folderId: folder.id,
    });
    for (let i = 2; i <= 41; i++)
      repo.updateNote(note.id, { body: `generation ${i}` });
    await repo.flush();
    const reply = deferred<MutationAcknowledgement>();
    vi.mocked(transport.send).mockImplementationOnce(() => reply.promise);
    const sync = coordinator();
    await sync.start();
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(1));
    const request = vi.mocked(transport.send).mock.calls[0][0];
    expect(request.generation).toBe(41);
    repo.updateNote(note.id, {
      body: 'generation 42',
      title: 'Independent title',
    });
    reply.resolve({ ...acknowledgement(request), title: 'Canonical title' });
    await wait(() => expect(repo.getNote(note.id)?.baseVersion).toBe('1'));
    expect(repo.getNote(note.id)).toMatchObject({
      generation: 42,
      body: 'generation 42',
      title: 'Independent title',
      folderId: null,
    });
    await repo.flush();
    expect(await repo.database.drafts.get([repo.accountId, note.id])).toEqual(
      repo.getNote(note.id),
    );
    expect(
      (await repo.database.intents.get([repo.accountId, note.id]))?.generation,
    ).toBe(42);
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(2));
    const next = vi.mocked(transport.send).mock.calls[1][0];
    expect(next).toMatchObject({
      body: 'generation 42',
      expectedVersion: '1',
      title: 'Independent title',
      folderId: null,
    });
    await wait(() => expect(sync.getState(note.id)?.type).toBe('acknowledged'));
    expect(
      await repo.database.intents.get([repo.accountId, note.id]),
    ).toBeUndefined();
  });

  it('retries a dropped acknowledgement with exactly the sealed request despite new typing', async () => {
    const { repo, transport, coordinator } = await setup();
    const note = await repo.createNote({ body: 'sealed original' });
    vi.mocked(transport.send).mockRejectedValueOnce(
      new SyncRetry('lost reply', 100),
    );
    const sync = coordinator();
    await sync.start();
    await wait(() => expect(sync.getState(note.id)?.type).toBe('retry'));
    repo.updateNote(note.id, { body: 'new typing after timeout' });
    await repo.flush();
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transport.send).mock.calls[1][0]).toEqual(
      vi.mocked(transport.send).mock.calls[0][0],
    );
    await wait(() => expect(repo.getNote(note.id)?.baseVersion).toBe('1'));
    expect(repo.getNote(note.id)?.body).toBe('new typing after timeout');
  });

  it('rejects late session callbacks and retains the exact replay record', async () => {
    const { repo, transport, coordinator, invalidate } = await setup();
    const note = await repo.createNote({ body: 'preserved' });
    const reply = deferred<MutationAcknowledgement>();
    vi.mocked(transport.send).mockImplementationOnce(() => reply.promise);
    const sync = coordinator();
    await sync.start();
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(1));
    const request = vi.mocked(transport.send).mock.calls[0][0];
    invalidate();
    reply.resolve(acknowledgement(request));
    await wait(() =>
      expect(sync.getState(note.id)).toMatchObject({
        type: 'paused',
        reason: 'session',
      }),
    );
    expect(await repo.database.outbox.get([repo.accountId, note.id])).toEqual(
      request,
    );
    expect(repo.getNote(note.id)?.baseVersion).toBeNull();
  });

  it('rolls back failed atomic acknowledgement without advancing live memory, then accepts exact replay', async () => {
    const { repo, fence, current } = await setup();
    const note = await repo.createNote({ body: 'original' });
    const request = await repo.sealForSync(note.id, fence, current);
    repo.updateNote(note.id, { body: 'newer' });
    vi.spyOn(repo.database.outbox, 'delete').mockRejectedValueOnce(
      new Error('quota failure'),
    );
    await expect(
      repo.acknowledgeSync(request, acknowledgement(request), fence, current),
    ).rejects.toThrow('quota');
    expect(repo.getNote(note.id)).toMatchObject({
      body: 'newer',
      baseVersion: null,
    });
    expect(await repo.database.outbox.get([repo.accountId, note.id])).toEqual(
      request,
    );
    await repo.acknowledgeSync(
      request,
      acknowledgement(request),
      fence,
      current,
    );
    await repo.flush();
    expect(
      await repo.database.drafts.get([repo.accountId, note.id]),
    ).toMatchObject({ body: 'newer', baseVersion: '1' });
  });

  it('never syncs the preview or writes as a secondary tab', async () => {
    const local = await setup('local-preview');
    expect(local.coordinator).toThrow('own account');
    const reader = await setup('account', 'readonly');
    await expect(reader.coordinator().start()).rejects.toThrow('same account');
    expect(reader.transport.send).not.toHaveBeenCalled();
  });

  it('pauses prior-epoch work before sealing or sending', async () => {
    const { repo, transport, coordinator } = await setup();
    const note = await repo.createNote({ body: 'old epoch copy' });
    vi.mocked(transport.getServiceState).mockResolvedValue({
      epoch: 'new',
      minimum_protocol: 1,
      reads_enabled: true,
      writes_enabled: true,
    });
    const sync = coordinator();
    await sync.start();
    await wait(() =>
      expect(sync.getState(note.id)).toMatchObject({
        type: 'paused',
        reason: 'epoch',
      }),
    );
    expect(transport.send).not.toHaveBeenCalled();
    expect(await repo.database.outbox.count()).toBe(0);
    expect(repo.getNote(note.id)?.body).toBe('old epoch copy');
  });
  it('limits global sends to two and never overlaps requests for the same note', async () => {
    const { repo, transport, coordinator } = await setup();
    const notes = await Promise.all([
      repo.createNote({ body: 'a' }),
      repo.createNote({ body: 'b' }),
      repo.createNote({ body: 'c' }),
    ]);
    const replies = new Map<
      string,
      ReturnType<typeof deferred<MutationAcknowledgement>>
    >();
    vi.mocked(transport.send).mockImplementation((request) => {
      const reply = deferred<MutationAcknowledgement>();
      replies.set(request.noteId, reply);
      return reply.promise;
    });
    const sync = coordinator();
    await sync.start();
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(2));
    repo.updateNote(notes[0].id, { body: 'new generation during request' });
    await repo.flush();
    expect(
      new Set(
        vi.mocked(transport.send).mock.calls.map(([request]) => request.noteId),
      ).size,
    ).toBe(2);
    const first = vi.mocked(transport.send).mock.calls[0][0];
    replies.get(first.noteId)!.resolve(acknowledgement(first));
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(3));
    sync.stop();
    for (const [request] of vi.mocked(transport.send).mock.calls.slice(1))
      replies.get(request.noteId)!.resolve(acknowledgement(request));
  });

  it('observes an uncommitted generation present at coordinator startup', async () => {
    const { repo, transport, coordinator, fence, current } = await setup();
    const note = await repo.createNote({ body: 'accepted' });
    const request = await repo.sealForSync(note.id, fence, current);
    await repo.acknowledgeSync(
      request,
      acknowledgement(request),
      fence,
      current,
    );
    repo.updateNote(note.id, { body: 'not yet committed at startup' });
    const sync = coordinator();
    await sync.start();
    await wait(() => expect(transport.send).toHaveBeenCalledTimes(1));
    expect(vi.mocked(transport.send).mock.calls[0][0]).toMatchObject({
      body: 'not yet committed at startup',
      expectedVersion: '1',
    });
  });
  it('reflects an already committed acknowledgement if session loss occurs in its completion callback', async () => {
    const { repo, fence, current, invalidate } = await setup();
    const note = await repo.createNote({
      body: 'before',
      title: 'uncorrected',
    });
    const request = await repo.sealForSync(note.id, fence, current);
    const originalDelete = repo.database.outbox.delete.bind(
      repo.database.outbox,
    );
    vi.spyOn(repo.database.outbox, 'delete').mockImplementation((key) =>
      originalDelete(key).then(() => {
        Dexie.currentTransaction!.on('complete', invalidate);
      }),
    );
    await repo.acknowledgeSync(
      request,
      { ...acknowledgement(request), title: 'corrected' },
      fence,
      current,
    );
    expect(current()).toBeNull();
    expect(repo.getNote(note.id)).toMatchObject({
      baseVersion: '1',
      title: 'corrected',
    });
    repo.updateNote(note.id, { body: 'preserved after session loss' });
    await repo.flush();
    expect(
      await repo.database.drafts.get([repo.accountId, note.id]),
    ).toMatchObject({
      baseVersion: '1',
      title: 'corrected',
      body: 'preserved after session loss',
    });
  });
});
