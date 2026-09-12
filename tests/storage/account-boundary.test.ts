import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../../src/storage/repository';
import type { BaseRecord, CallbackFence } from '../../src/storage/types';

const repositories: LocalRepository[] = [];
afterEach(async () => {
  for (const repo of repositories.splice(0)) {
    await repo.close();
    await repo.database.delete();
  }
});
async function repository() {
  const repo = new LocalRepository({
    accountId: 'owner',
    databaseName: `account-repo-${crypto.randomUUID()}`,
    lease: { acquire: async () => 'writer', release: async () => {} },
  });
  repositories.push(repo);
  await repo.initialize();
  return repo;
}
const remote: BaseRecord = {
  accountId: 'owner',
  id: 'remote',
  title: 'Cloud title',
  body: 'Cloud body',
  folderId: null,
  deletedAt: null,
  version: '2',
  epoch: 'epoch',
};

describe('repository account transition boundaries', () => {
  it('pauses new editing while allowing committed pending work to seal for logout', async () => {
    const repo = await repository();
    const note = await repo.createNote({ body: 'pending' });
    repo.updateNote(note.id, { body: 'last keystroke' });
    repo.setEditingPaused(true);
    expect(() => repo.updateNote(note.id, { body: 'forbidden' })).toThrow(
      'paused',
    );
    await expect(repo.createNote()).rejects.toThrow('paused');
    await expect(repo.createFolder('forbidden')).rejects.toThrow('paused');
    await repo.flush();
    const fence: CallbackFence = {
      accountId: 'owner',
      writerId: repo.writerId,
      sessionId: 's',
      epoch: 'epoch',
    };
    expect(await repo.sealForSync(note.id, fence, () => fence)).toMatchObject({
      body: 'last keystroke',
    });
    expect(await repo.getPendingSyncCount()).toBe(1);
    repo.setEditingPaused(false);
    repo.updateNote(note.id, { body: 'cancelled logout' });
    expect(repo.getNote(note.id)?.body).toBe('cancelled logout');
  });

  it('loads and refreshes clean coherent reads without creating upload intents', async () => {
    const repo = await repository();
    expect(await repo.installRemoteNote(remote, () => true)).toBe(true);
    expect(repo.getNote(remote.id)).toMatchObject({
      body: remote.body,
      baseVersion: '2',
    });
    expect(await repo.getPendingSyncCount()).toBe(0);
    expect(
      await repo.installRemoteNote(
        { ...remote, body: 'New cloud body', version: '3' },
        () => true,
      ),
    ).toBe(true);
    expect(repo.getNote(remote.id)?.body).toBe('New cloud body');
    expect(await repo.getPendingSyncCount()).toBe(0);
  });

  it('preserves dirty and prior-epoch copies and fences stale or wrong-account reads', async () => {
    const repo = await repository();
    await repo.installRemoteNote(remote, () => true);
    expect(
      await repo.installRemoteNote(
        { ...remote, epoch: 'restored' },
        () => true,
      ),
    ).toBe(false);
    repo.updateNote(remote.id, { body: 'latest local text' });
    expect(
      await repo.installRemoteNote(
        { ...remote, version: '3', body: 'other device' },
        () => true,
      ),
    ).toBe(false);
    await expect(repo.installRemoteNote(remote, () => false)).rejects.toThrow(
      'no longer belongs',
    );
    await expect(
      repo.installRemoteNote({ ...remote, accountId: 'other' }, () => true),
    ).rejects.toThrow('no longer belongs');
    expect(repo.getNote(remote.id)?.body).toBe('latest local text');
    expect(await repo.getPendingSyncCount()).toBe(1);
    await repo.flush();
    expect((await repo.database.drafts.get(['owner', remote.id]))?.body).toBe(
      'latest local text',
    );
  });
});
