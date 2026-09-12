import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSyncTransport } from '../../src/sync/transport';
import type { SealedMutation } from '../../src/storage/types';

const remoteNote = {
  id: 'note',
  note_id: 'note',
  epoch: 'epoch',
  title: 'Cloud note',
  body: 'UTF-8 café',
  folder_id: null,
  version: '9007199254740993',
  kind: 'recovery',
  body_bytes: 11,
  deleted_at: null,
  purged_at: null,
  created_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T01:00:00Z',
};

const completeManifest = {
  epoch: 'epoch',
  notes: [remoteNote],
  folders: [],
  counts: {
    normal_active: 0,
    normal_retained: 0,
    recovery_retained: 1,
    note_tombstones: 0,
    folder_active: 0,
    folder_tombstones: 0,
  },
};

function reader(data: unknown) {
  const setHeader = vi.fn(async () => ({ data, error: null }));
  const rpc = vi.fn(() => ({ setHeader }));
  const client = {
    rpc,
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: { user: { id: 'account-a' }, access_token: 'synthetic-a' },
        },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
  return {
    client,
    rpc,
    setHeader,
    transport: new SupabaseSyncTransport(client, 'account-a'),
  };
}

const request: SealedMutation = {
  accountId: 'account-a',
  sessionId: 'session-a',
  writerId: 'writer-a',
  epoch: 'epoch',
  protocol: 1,
  mutationId: 'mutation',
  noteId: 'note',
  expectedVersion: null,
  generation: 41,
  operation: 'create',
  title: 'Private draft',
  body: 'account a private sentinel',
  folderId: null,
  deletedAt: null,
  sealedAt: 1,
};

describe('account-bound transport', () => {
  it('rejects a changed account before sending a private body', async () => {
    const rpc = vi.fn();
    const client = {
      rpc,
      auth: {
        getSession: async () => ({
          data: {
            session: { user: { id: 'account-b' }, access_token: 'synthetic-b' },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    await expect(
      new SupabaseSyncTransport(client, 'account-a').send(request),
    ).rejects.toThrow('same account');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pins the validated token even when the shared SDK session changes before fetch', async () => {
    let currentAccount = 'account-a';
    const response = Promise.resolve({
      data: { mutation_id: 'mutation' },
      error: null,
    });
    const setHeader = vi.fn(() => response);
    const rpc = vi.fn(() => {
      currentAccount = 'account-b';
      return { setHeader };
    });
    const client = {
      rpc,
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: currentAccount },
              access_token: 'synthetic-a',
            },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    await new SupabaseSyncTransport(client, 'account-a').send(request);
    expect(currentAccount).toBe('account-b');
    expect(setHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer synthetic-a',
    );
    expect(rpc.mock.calls[0]).toEqual([
      'create_note',
      {
        p_request: {
          protocol: 1,
          epoch: 'epoch',
          mutation_id: 'mutation',
          note_id: 'note',
          expected_version: null,
          title: 'Private draft',
          body: 'account a private sentinel',
          folder_id: null,
        },
      },
    ]);
  });

  it('uses the real complete manifest RPC and pins its owner token', async () => {
    const { transport, rpc, setHeader } = reader(completeManifest);
    expect(await transport.getManifest()).toMatchObject(completeManifest);
    expect(rpc).toHaveBeenCalledWith('list_manifest');
    expect(setHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer synthetic-a',
    );
  });

  it('validates coherent note identity, UTF-8 size, lifecycle and string bigint version', async () => {
    const { transport, rpc } = reader(remoteNote);
    expect(await transport.getNote('note')).toMatchObject({
      accountId: 'account-a',
      id: 'note',
      body: 'UTF-8 café',
      version: '9007199254740993',
      kind: 'recovery',
      createdAt: Date.parse(remoteNote.created_at),
    });
    expect(rpc).toHaveBeenCalledWith('get_note', { p_note_id: 'note' });
    for (const patch of [
      { id: 'different' },
      { version: 9007199254740992 },
      { body_bytes: 10 },
      { deleted_at: 'invalid' },
      { purged_at: remoteNote.updated_at },
    ]) {
      await expect(
        reader({ ...remoteNote, ...patch }).transport.getNote('note'),
      ).rejects.toMatchObject({ reason: 'protocol' });
    }
    await expect(reader(null).transport.getNote('note')).rejects.toMatchObject({
      reason: 'conflict',
    });
  });

  it('rejects incomplete, duplicate and oversized manifest responses instead of treating them as complete', async () => {
    await expect(reader(null).transport.getManifest()).rejects.toMatchObject({
      reason: 'session',
    });
    await expect(
      reader({ ...completeManifest, notes: [] }).transport.getManifest(),
    ).rejects.toMatchObject({ reason: 'protocol' });
    await expect(
      reader({
        ...completeManifest,
        notes: [remoteNote, remoteNote],
      }).transport.getManifest(),
    ).rejects.toMatchObject({ reason: 'protocol' });
    await expect(
      reader({
        ...completeManifest,
        notes: Array.from({ length: 10_001 }, () => remoteNote),
      }).transport.getManifest(),
    ).rejects.toMatchObject({ reason: 'remedy' });
    await expect(
      reader({
        ...completeManifest,
        unexpected: 'x'.repeat(2_097_152),
      }).transport.getManifest(),
    ).rejects.toMatchObject({ reason: 'remedy' });
  });

  it('fences same-account session replacement while token lookup is pending', async () => {
    const { client, rpc } = reader(completeManifest);
    let current = true;
    vi.mocked(client.auth.getSession).mockImplementation(async () => {
      current = false;
      return {
        data: {
          session: { user: { id: 'account-a' }, access_token: 'new-session' },
        },
        error: null,
      } as Awaited<ReturnType<typeof client.auth.getSession>>;
    });
    await expect(
      new SupabaseSyncTransport(
        client,
        'account-a',
        () => current,
      ).getManifest(),
    ).rejects.toMatchObject({ reason: 'session' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
