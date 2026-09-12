import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSyncTransport } from '../../src/sync/transport';
import type { SealedMutation } from '../../src/storage/types';

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
});
