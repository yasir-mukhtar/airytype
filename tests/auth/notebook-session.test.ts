import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotebookSession,
  type NotebookAuth,
  type NotebookAuthSession,
  type NotebookControlChannel,
  type NotebookSessionOptions,
  type NotebookSync,
} from '../../src/auth/notebook-session';
import { LocalRepository } from '../../src/storage/repository';
import type { CallbackFence, SealedMutation } from '../../src/storage/types';
import { SyncCoordinator } from '../../src/sync/coordinator';
import type { CloudWriteState } from '../../src/sync/coordinator';
import type {
  MutationAcknowledgement,
  SyncTransport,
} from '../../src/sync/protocol';

const repositories: LocalRepository[] = [];
const sessions: NotebookSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
  const open = repositories.splice(0);
  for (const repository of open) await repository.close();
  const names = new Set<string>();
  for (const repository of open) {
    if (!names.has(repository.database.name)) {
      names.add(repository.database.name);
      await repository.database.delete();
    }
  }
});

const identity = (
  accountId = 'account-a',
  sessionId = 'session-a',
): NotebookAuthSession => ({
  accountId,
  sessionId,
  email: `${accountId}@example.com`,
  verified: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeAuth implements NotebookAuth {
  configured = true;
  current: NotebookAuthSession | null = identity();
  listeners = new Set<(session: NotebookAuthSession | null) => void>();
  getSession = vi.fn(async () => this.current);
  subscribe = (listener: (session: NotebookAuthSession | null) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  emit(session: NotebookAuthSession | null) {
    this.current = session;
    for (const listener of this.listeners) listener(session);
  }
  signIn = vi.fn(async (_email: string, _password: string) => {
    const session = identity();
    this.emit(session);
    return session;
  });
  signOutLocal = vi.fn(async () => this.emit(null));
}

class ControlHub {
  channels: NotebookControlChannel[] = [];
  messages: unknown[] = [];
  connect(): NotebookControlChannel {
    const channel: NotebookControlChannel = {
      onmessage: null,
      postMessage: (message) => {
        this.messages.push(message);
        for (const other of this.channels)
          if (other !== channel)
            other.onmessage?.({ data: message } as MessageEvent<unknown>);
      },
      close: () => {
        this.channels = this.channels.filter((other) => other !== channel);
      },
    };
    this.channels.push(channel);
    return channel;
  }
}

async function setup(
  overrides: Partial<NotebookSessionOptions> = {},
  readonly = false,
) {
  const databaseName = `session-${crypto.randomUUID()}`;
  const local = new LocalRepository({
    databaseName,
    lease: {
      acquire: async () => (readonly ? 'readonly' : 'writer'),
      release: async () => {},
    },
  });
  const account = new LocalRepository({
    databaseName,
    accountId: 'account-a',
    lease: {
      acquire: async () => (readonly ? 'readonly' : 'writer'),
      release: async () => {},
    },
  });
  repositories.push(local, account);
  await local.initialize();
  await account.initialize();
  const auth = new FakeAuth();
  const syncs: NotebookSync[] = [];
  const startSync = vi.fn(
    async (
      _repo: LocalRepository,
      _fence: CallbackFence,
      _current: () => CallbackFence | null,
    ) => {
      const sync = {
        stop: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        getState: vi.fn(),
      };
      syncs.push(sync);
      return sync;
    },
  );
  const options: NotebookSessionOptions = {
    localRepository: local,
    auth,
    openAccount: vi.fn(async () => account),
    startSync,
    getEpoch: vi.fn(async () => 'epoch-a'),
    channel: null,
    ...overrides,
  };
  const session = new NotebookSession(options);
  sessions.push(session);
  return { local, account, auth, session, options, startSync, syncs };
}

const ack = (request: Readonly<SealedMutation>): MutationAcknowledgement => ({
  epoch: request.epoch,
  note_id: request.noteId,
  mutation_id: request.mutationId,
  version: '1',
  title: request.title,
  folder_id: null,
  deleted_at: null,
  kind: 'normal',
});

describe('notebook account lifecycle', () => {
  it('requires deliberate verified opening and never moves local preview drafts', async () => {
    const { session, local, account, options } = await setup();
    const preview = await local.createNote({
      body: 'local writing stays local',
    });
    const before = session.getSnapshot();
    expect(session.getSnapshot()).toBe(before);
    await session.initialize();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'local',
      email: 'account-a@example.com',
    });
    expect(session.getSnapshot().repository).toBe(local);
    expect(options.openAccount).not.toHaveBeenCalled();
    await session.openAccountNotebook();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'account',
    });
    expect(session.getSnapshot().repository).toBe(account);
    expect(account.listNotes()).toEqual([]);
    expect(local.getNote(preview.id)?.body).toBe('local writing stays local');
    expect(
      (await account.database.drafts.toArray()).map((note) => note.accountId),
    ).toEqual(['local-preview']);
    await session.useLocalNotebook();
    expect(session.getSnapshot().repository).toBe(local);
    expect(local.updateNote(preview.id, { body: 'still writable' })).toBe(2);
  });

  it('does not reopen an unverified session or a stale startup session after signout', async () => {
    const { session, auth, options } = await setup();
    const startup = deferred<NotebookAuthSession | null>();
    auth.getSession.mockReturnValue(startup.promise);
    const initialized = session.initialize();
    auth.emit(null);
    startup.resolve(identity());
    await initialized;
    expect(session.getSnapshot().accountId).toBeNull();
    await expect(session.openAccountNotebook()).rejects.toThrow('verified');
    auth.emit({ ...identity(), verified: false });
    await expect(session.openAccountNotebook()).rejects.toThrow('verified');
    expect(options.openAccount).not.toHaveBeenCalled();
  });

  it('keeps the active fence stable on an ordinary token refresh', async () => {
    const { session, auth, syncs } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    const fence = session.getCurrentFence();
    auth.emit({ ...identity(), email: 'updated@example.com' });
    expect(session.getCurrentFence()).toBe(fence);
    expect(session.getSnapshot()).toMatchObject({
      phase: 'account',
      email: 'updated@example.com',
    });
    expect(syncs[0].stop).not.toHaveBeenCalled();
  });

  it('cancels pending logout before SDK signout and resumes exact pending writing', async () => {
    const { session, auth, account } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({ body: 'first' });
    account.updateNote(note.id, { body: 'last keystroke before logout' });
    const logout = session.requestLogout();
    expect(() =>
      account.updateNote(note.id, { body: 'must be blocked' }),
    ).toThrow('paused');
    await logout;
    expect(session.getSnapshot()).toMatchObject({
      phase: 'logout-pending',
      pendingCount: 1,
    });
    await expect(session.finishLogout()).rejects.toThrow('still pending');
    session.cancelLogout();
    expect(auth.signOutLocal).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('account');
    expect(account.getNote(note.id)?.body).toBe('last keystroke before logout');
    expect(account.updateNote(note.id, { body: 'after cancel' })).toBe(3);
    expect(await account.getPendingSyncCount()).toBe(1);
  });

  it('fences a delayed acknowledgement synchronously on session loss and retains replay data', async () => {
    const reply = deferred<MutationAcknowledgement>();
    const transport: SyncTransport = {
      getServiceState: async () => ({
        epoch: 'epoch-a',
        minimum_protocol: 1,
        reads_enabled: true,
        writes_enabled: true,
      }),
      send: vi.fn(() => reply.promise),
      getNote: vi.fn(),
    };
    const { session, account, auth } = await setup({
      startSync: async (repository, fence, current) => {
        const sync = new SyncCoordinator(repository, transport, fence, current);
        await sync.start();
        return sync;
      },
    });
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({
      body: 'preserved while reply is delayed',
    });
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce(), {
      timeout: 3000,
    });
    const request = vi.mocked(transport.send).mock.calls[0][0];
    const acknowledge = vi.spyOn(account, 'acknowledgeSync');
    auth.emit(null);
    expect(session.getCurrentFence()).toBeNull();
    expect(session.getSnapshot().phase).toBe('session-lost');
    expect(() => account.updateNote(note.id, { body: 'blocked' })).toThrow(
      'paused',
    );
    reply.resolve(ack(request));
    await reply.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acknowledge).not.toHaveBeenCalled();
    expect(
      await account.database.outbox.get([account.accountId, note.id]),
    ).toEqual(request);
    expect(account.getNote(note.id)).toMatchObject({
      body: 'preserved while reply is delayed',
      baseVersion: null,
    });
  });

  it('settles and acknowledges pending requests while logout has paused editing', async () => {
    const transport: SyncTransport = {
      getServiceState: async () => ({
        epoch: 'epoch-a',
        minimum_protocol: 1,
        reads_enabled: true,
        writes_enabled: true,
      }),
      send: vi.fn(async (request) => ack(request)),
      getNote: vi.fn(),
    };
    const { session, account, auth, local } = await setup({
      startSync: async (repository, fence, current) => {
        const sync = new SyncCoordinator(repository, transport, fence, current);
        await sync.start();
        return sync;
      },
    });
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({ body: 'wait for the upload' });
    await session.requestLogout();
    await vi.waitFor(() => expect(session.getSnapshot().pendingCount).toBe(0), {
      timeout: 3000,
    });
    expect(auth.signOutLocal).not.toHaveBeenCalled();
    await session.finishLogout();
    expect(auth.signOutLocal).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'local',
      accountId: null,
    });
    expect(session.getSnapshot().repository).toBe(local);
    expect(session.getCurrentFence()).toBeNull();
    expect(account.getNote(note.id)?.body).toBe('wait for the upload');
    expect(
      await account.database.drafts.get([account.accountId, note.id]),
    ).toBeDefined();
  });

  it('retains records after failed SDK signout and can cancel without losing the session', async () => {
    const { session, account, auth, syncs } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({
      body: 'acknowledged but retained',
    });
    const fence = session.getCurrentFence()!;
    const request = await account.sealForSync(
      note.id,
      fence,
      session.getCurrentFence,
    );
    await account.acknowledgeSync(
      request,
      ack(request),
      fence,
      session.getCurrentFence,
    );
    auth.signOutLocal.mockRejectedValueOnce(
      new Error('Sign-out failed. Drafts retained.'),
    );
    await session.requestLogout();
    await expect(session.finishLogout()).rejects.toThrow('Sign-out failed');
    expect(session.getSnapshot().phase).toBe('logout-pending');
    expect(syncs[0].stop).toHaveBeenCalledOnce();
    expect(account.getNote(note.id)?.body).toBe('acknowledged but retained');
    session.cancelLogout();
    expect(session.getSnapshot().phase).toBe('account');
    expect(account.updateNote(note.id, { body: 'writing resumes' })).toBe(2);
    expect(auth.current).toEqual(identity());
  });

  it('does not complete logout when the pending queue cannot be read', async () => {
    const { session, account, auth } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    await session.requestLogout();
    vi.spyOn(account, 'getPendingSyncCount').mockRejectedValue(
      new Error('queue unavailable'),
    );
    await expect(session.finishLogout()).rejects.toThrow('still pending');
    expect(auth.signOutLocal).not.toHaveBeenCalled();
    expect(session.getSnapshot().pendingCount).toBe(-1);
    session.cancelLogout();
    expect(session.getSnapshot().phase).toBe('account');
  });

  it('keeps local memory reachable and writable if opening cannot flush the preview', async () => {
    const { session, local, options } = await setup();
    await session.initialize();
    const note = await local.createNote({ body: 'committed' });
    local.updateNote(note.id, { body: 'latest memory' });
    vi.spyOn(local, 'flush').mockRejectedValueOnce(new Error('disk full'));
    await expect(session.openAccountNotebook()).rejects.toThrow('disk full');
    expect(options.openAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'local',
      message: 'disk full',
    });
    expect(session.getSnapshot().repository).toBe(local);
    expect(local.getNote(note.id)?.body).toBe('latest memory');
    expect(local.updateNote(note.id, { body: 'exportable next edit' })).toBe(3);
  });

  it('does not attach old account records to a different authenticated identity', async () => {
    const { session, account, auth, options } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({ body: 'private account-a draft' });
    auth.emit({
      ...identity('account-b', 'session-b'),
      email: identity().email,
    });
    expect(session.getSnapshot()).toMatchObject({
      phase: 'session-lost',
      accountId: 'account-a',
    });
    expect(session.getCurrentFence()).toBeNull();
    await expect(session.openAccountNotebook()).rejects.toThrow(
      'original account',
    );
    expect(options.openAccount).toHaveBeenCalledOnce();
    expect(options.openAccount).toHaveBeenLastCalledWith('account-a');
    expect(session.getSnapshot().repository).toBe(account);
    expect(account.getNote(note.id)).toMatchObject({
      accountId: 'account-a',
      body: 'private account-a draft',
    });
    expect(session.getSnapshot().phase).toBe('session-lost');
  });

  it('rejects a late opening completion after session loss', async () => {
    const epoch = deferred<string>();
    const { session, account, auth, startSync } = await setup({
      getEpoch: () => epoch.promise,
    });
    await session.initialize();
    const opening = session.openAccountNotebook();
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('opening'));
    auth.emit(null);
    epoch.resolve('epoch-a');
    await expect(opening).rejects.toThrow('session changed');
    expect(startSync).not.toHaveBeenCalled();
    expect(session.getCurrentFence()).toBeNull();
    expect(session.getSnapshot().phase).toBe('session-lost');
    expect(() => account.updateNote('missing', { body: 'blocked' })).toThrow();
  });

  it('routes a reader logout to its matching writer using metadata only', async () => {
    const hub = new ControlHub();
    const owner = await setup({ channel: hub.connect() });
    const reader = await setup({ channel: hub.connect() }, true);
    await owner.session.initialize();
    await reader.session.initialize();
    await owner.session.openAccountNotebook();
    const note = await owner.account.createNote({
      body: 'never cross the channel',
    });
    owner.account.updateNote(note.id, { body: 'typing at the owner' });
    await reader.session.requestLogout();
    await vi.waitFor(() =>
      expect(owner.session.getSnapshot()).toMatchObject({
        phase: 'logout-pending',
        pendingCount: 1,
      }),
    );
    expect(reader.session.getSnapshot().message).toContain('writing tab');
    expect(reader.auth.signOutLocal).not.toHaveBeenCalled();
    expect(reader.startSync).not.toHaveBeenCalled();
    expect(hub.messages).toHaveLength(1);
    expect(Object.keys(hub.messages[0] as object).sort()).toEqual([
      'accountId',
      'senderId',
      'sessionId',
      'type',
    ]);
    owner.session.cancelLogout();
    expect(owner.account.updateNote(note.id, { body: 'continued' })).toBe(3);
  });

  it('ignores a mismatched reader request and hides matching readers before SDK signout', async () => {
    const hub = new ControlHub();
    const owner = await setup({ channel: hub.connect() });
    const reader = await setup({ channel: hub.connect() }, true);
    reader.auth.current = identity('account-b', 'session-b');
    await owner.session.initialize();
    await reader.session.initialize();
    await owner.session.openAccountNotebook();
    await reader.session.requestLogout();
    expect(owner.session.getSnapshot().phase).toBe('account');
    reader.auth.emit(identity());
    const signedOut = deferred<void>();
    owner.auth.signOutLocal.mockImplementationOnce(() => signedOut.promise);
    await owner.session.requestLogout();
    const finishing = owner.session.finishLogout();
    await vi.waitFor(() =>
      expect(owner.auth.signOutLocal).toHaveBeenCalledOnce(),
    );
    expect(reader.session.getSnapshot()).toMatchObject({
      phase: 'local',
      accountId: null,
      email: null,
    });
    expect(reader.session.getSnapshot().repository).toBe(reader.local);
    reader.auth.emit(null);
    expect(reader.session.getSnapshot()).toMatchObject({
      phase: 'local',
      accountId: null,
      email: null,
    });
    expect(owner.session.getCurrentFence()).toBeNull();
    signedOut.resolve();
    await finishing;
  });

  it('treats a server session rejection as immediate session loss without waiting for Auth events', async () => {
    let state: CloudWriteState | undefined = undefined;
    const listeners = new Set<() => void>();
    const sync: NotebookSync = {
      stop: vi.fn(),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getState: () => state,
    };
    const { session, account, auth } = await setup({
      startSync: async () => sync,
    });
    await session.initialize();
    await session.openAccountNotebook();
    const note = await account.createNote({
      body: 'server rejected the session',
    });
    state = { type: 'paused', reason: 'session', message: 'Sign in again.' };
    for (const listener of listeners) listener();
    expect(auth.current).toEqual(identity());
    expect(session.getCurrentFence()).toBeNull();
    expect(session.getSnapshot().phase).toBe('session-lost');
    expect(() => account.updateNote(note.id, { body: 'blocked' })).toThrow(
      'paused',
    );
    expect(sync.stop).toHaveBeenCalledOnce();
    await expect(session.openAccountNotebook()).rejects.toThrow('verified');
  });

  it('does not let a stale opening pause the same repository after a newer sign-in succeeds', async () => {
    const firstEpoch = deferred<string>();
    const getEpoch = vi.fn(async () => 'epoch-a');
    getEpoch.mockImplementationOnce(() => firstEpoch.promise);
    const { session, auth, account } = await setup({ getEpoch });
    await session.initialize();
    const firstOpen = session.openAccountNotebook();
    await vi.waitFor(() => expect(getEpoch).toHaveBeenCalledOnce());
    auth.emit(null);
    auth.emit(identity('account-a', 'new-session'));
    await session.openAccountNotebook();
    const note = await account.createNote({ body: 'new session writing' });
    firstEpoch.resolve('epoch-a');
    await expect(firstOpen).rejects.toThrow('session changed');
    expect(session.getCurrentFence()?.sessionId).toBe('new-session');
    expect(session.getSnapshot().phase).toBe('account');
    expect(account.updateNote(note.id, { body: 'still writable' })).toBe(2);
  });

  it('lets cancellation win over an in-progress final local flush before SDK signout', async () => {
    const { session, account, auth } = await setup();
    await session.initialize();
    await session.openAccountNotebook();
    await session.requestLogout();
    const flush = deferred<void>();
    vi.spyOn(account, 'flush').mockReturnValueOnce(flush.promise);
    const finishing = session.finishLogout();
    session.cancelLogout();
    const note = await account.createNote({
      body: 'cancel preserved my session',
    });
    flush.resolve();
    await expect(finishing).rejects.toThrow('session changed');
    expect(auth.signOutLocal).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('account');
    expect(account.getNote(note.id)?.body).toBe('cancel preserved my session');
  });

  it('keeps the validated account cache available for export when cloud startup fails', async () => {
    const { session, account, local } = await setup({
      startSync: async () => {
        throw new Error('network unavailable');
      },
    });
    const note = await account.createNote({ body: 'cached account writing' });
    await session.initialize();
    await expect(session.openAccountNotebook()).rejects.toThrow(
      'network unavailable',
    );
    expect(session.getSnapshot()).toMatchObject({
      phase: 'session-lost',
      accountId: account.accountId,
    });
    expect(session.getSnapshot().repository).toBe(account);
    expect(account.getNote(note.id)?.body).toBe('cached account writing');
    expect(() => account.updateNote(note.id, { body: 'blocked' })).toThrow(
      'paused',
    );
    await session.useLocalNotebook();
    expect(session.getSnapshot().repository).toBe(local);
    expect(account.getNote(note.id)?.body).toBe('cached account writing');
  });
});
