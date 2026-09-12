import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiryDatabase } from '../../src/storage/database';
import type { CallbackFence, NoteRecord } from '../../src/storage/types';
import { SyncPersistence } from '../../src/sync/persistence';
import {
  decideReconciliation,
  type MutationAcknowledgement,
} from '../../src/sync/protocol';

let db: AiryDatabase;
let fence: CallbackFence | null;
let sync: SyncPersistence;
const initialFence: CallbackFence = {
  accountId: 'owner',
  writerId: 'writer',
  sessionId: 'session',
  epoch: 'epoch',
};
function draft(patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    accountId: 'owner',
    id: 'note',
    title: 'Draft',
    body: 'sentinel generation 41',
    folderId: null,
    writerId: 'writer',
    generation: 41,
    baseVersion: null,
    kind: 'normal',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...patch,
  };
}
async function persist(note: NoteRecord) {
  await db.transaction('rw', db.drafts, db.intents, async () => {
    await db.drafts.put(note);
    await db.intents.put({
      accountId: note.accountId,
      noteId: note.id,
      generation: note.generation,
    });
  });
}
beforeEach(async () => {
  db = new AiryDatabase(`sync-test-${crypto.randomUUID()}`);
  await db.open();
  fence = { ...initialFence };
  sync = new SyncPersistence(db, () => fence);
  await persist(draft());
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

function ack(
  mutationId: string,
  patch: Partial<MutationAcknowledgement> = {},
): MutationAcknowledgement {
  return {
    epoch: 'epoch',
    note_id: 'note',
    mutation_id: mutationId,
    version: '1',
    title: 'Draft',
    folder_id: null,
    deleted_at: null,
    kind: 'normal',
    ...patch,
  };
}

describe('sealed sync persistence', () => {
  it('retries exactly the sealed body and mutation ID after newer typing and restart', async () => {
    const sealed = await sync.seal('note', initialFence);
    expect(Object.isFrozen(sealed)).toBe(true);
    await persist(draft({ body: 'sentinel generation 42', generation: 42 }));
    const name = db.name;
    db.close();
    db = new AiryDatabase(name);
    await db.open();
    fence = {
      ...initialFence,
      writerId: 'new writer',
      sessionId: 'new session',
    };
    sync = new SyncPersistence(db, () => fence);
    const retry = await sync.seal('note', fence);
    expect(retry).toEqual(sealed);
    expect(retry.body).toBe('sentinel generation 41');
  });

  it('advances the accepted base without overwriting or clearing generation 42', async () => {
    const sealed = await sync.seal('note', initialFence);
    await persist(draft({ body: 'sentinel generation 42', generation: 42 }));
    const result = await sync.acknowledge(
      sealed,
      ack(sealed.mutationId),
      initialFence,
    );
    expect(result.clean).toBe(false);
    expect((await db.bases.get(['owner', 'note']))?.body).toBe(
      'sentinel generation 41',
    );
    expect((await db.drafts.get(['owner', 'note']))?.body).toBe(
      'sentinel generation 42',
    );
    expect((await db.drafts.get(['owner', 'note']))?.baseVersion).toBe('1');
    expect((await db.intents.get(['owner', 'note']))?.generation).toBe(42);
    expect(await db.outbox.get(['owner', 'note'])).toBeUndefined();
    expect((await sync.seal('note', initialFence)).expectedVersion).toBe('1');
  });

  it('rolls back base and draft writes if deleting the replay record fails', async () => {
    const sealed = await sync.seal('note', initialFence);
    vi.spyOn(db.outbox, 'delete').mockRejectedValueOnce(
      new Error('injected transaction failure'),
    );
    await expect(
      sync.acknowledge(sealed, ack(sealed.mutationId), initialFence),
    ).rejects.toThrow('injected');
    expect(await db.bases.get(['owner', 'note'])).toBeUndefined();
    expect((await db.drafts.get(['owner', 'note']))?.baseVersion).toBeNull();
    expect(await db.outbox.get(['owner', 'note'])).toEqual(sealed);
    expect((await db.intents.get(['owner', 'note']))?.generation).toBe(41);
    expect(
      (await sync.acknowledge(sealed, ack(sealed.mutationId), initialFence))
        .clean,
    ).toBe(true);
  });

  it('rejects stale account/session/writer callbacks and mismatched acknowledgements', async () => {
    const sealed = await sync.seal('note', initialFence);
    fence = { ...initialFence, sessionId: 'different session' };
    await expect(
      sync.acknowledge(sealed, ack(sealed.mutationId), initialFence),
    ).rejects.toThrow('no longer owns');
    fence = initialFence;
    await expect(
      sync.acknowledge(sealed, ack('wrong id'), initialFence),
    ).rejects.toThrow('does not match');
    expect(await db.outbox.get(['owner', 'note'])).toEqual(sealed);
  });

  it('applies canonical folder fallback to untouched fields while retaining independently edited title and body', async () => {
    await persist(draft({ folderId: 'deleted-folder' }));
    const sealed = await sync.seal('note', initialFence);
    await persist(
      draft({
        generation: 42,
        folderId: 'deleted-folder',
        title: 'My newer title',
        body: 'My newer text',
      }),
    );
    await sync.acknowledge(
      sealed,
      ack(sealed.mutationId, { title: 'Draft (recovered)', folder_id: null }),
      initialFence,
    );
    const current = await db.drafts.get(['owner', 'note']);
    expect(current).toMatchObject({
      title: 'My newer title',
      body: 'My newer text',
      folderId: null,
      generation: 42,
    });
    expect((await db.bases.get(['owner', 'note']))?.title).toBe(
      'Draft (recovered)',
    );
  });

  it('never sends prior-epoch sealed work', async () => {
    await sync.seal('note', initialFence);
    fence = { ...initialFence, epoch: 'restored-dataset' };
    await expect(sync.seal('note', fence)).rejects.toThrow('prior-epoch');
    expect((await db.drafts.get(['owner', 'note']))?.body).toBe(
      'sentinel generation 41',
    );
  });
});

describe('reconciliation decisions', () => {
  it('preserves clean prior-epoch copies and considers title/folder conflicts even when body matches', () => {
    const base = {
      accountId: 'owner',
      id: 'note',
      title: 'Draft',
      body: 'text',
      folderId: null,
      deletedAt: null,
      version: '12',
      epoch: 'old',
    };
    expect(
      decideReconciliation({
        draft: draft({ body: 'text' }),
        base,
        remote: { ...base, version: '8', epoch: 'new' },
        hasPending: false,
        currentEpoch: 'new',
      }).type,
    ).toBe('preserve-prior-epoch');
    expect(
      decideReconciliation({
        draft: draft({ body: 'text', title: 'Local title' }),
        base,
        remote: { ...base, title: 'Remote title' },
        hasPending: true,
        currentEpoch: 'old',
      }).type,
    ).toBe('preserve-conflict');
  });
});
