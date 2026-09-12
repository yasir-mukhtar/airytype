import { NotebookSession } from '../auth/notebook-session';
import { notebookAuth } from '../auth/notebook-auth';
import { requireCloud } from '../auth/client';
import { SupabaseSyncTransport } from '../sync/transport';
import { SyncCoordinator } from '../sync/coordinator';
import { sameFence } from '../sync/protocol';
import { loadAccountNotebook } from '../sync/account-notebook';
import { createLocalRepository } from '../storage/repository';
import { starterNotes } from './starter';

// Keep the origin-wide writer independent of React renders and shell hot updates.
export const repository = createLocalRepository();

let initialization: Promise<void> | undefined;
export function initializeNotebook(readOnlyDevice: boolean): Promise<void> {
  initialization ??= (async () => {
    await repository.initialize();
    const current = repository.getSnapshot();
    if (
      current.mode === 'writer' &&
      current.notes.length === 0 &&
      !readOnlyDevice
    ) {
      for (const sample of [...starterNotes].reverse())
        await repository.createNote(sample);
    }
    await notebookSession.initialize();
  })();
  return initialization;
}

// One origin lease is held by the original local repository across account views.
// Account repositories borrow that ownership; closing one cannot release it.
const accountRepositories = new Map<
  string,
  ReturnType<typeof createLocalRepository>
>();

async function boundedCloudOpen<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'The cloud is taking too long to respond. Your device copies are preserved; export them or try opening again.',
              ),
            ),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const notebookSession = new NotebookSession({
  localRepository: repository,
  auth: notebookAuth,
  openAccount: async (accountId) => {
    let account = accountRepositories.get(accountId);
    if (!account) {
      account = createLocalRepository({
        accountId,
        localOrganization: false,
        lease: {
          acquire: async () => repository.getSnapshot().mode,
          release: async () => {},
        },
      });
      account.setEditingPaused(true);
      accountRepositories.set(accountId, account);
    }
    await account.initialize();
    return account;
  },
  getEpoch: async () => {
    const service = await boundedCloudOpen(
      new SupabaseSyncTransport(requireCloud(), '').getServiceState(),
    );
    if (
      !service.reads_enabled ||
      !service.writes_enabled ||
      service.minimum_protocol > 1
    )
      throw new Error(
        'The cloud service is paused or requires an updated app. Your local writing is retained.',
      );
    return service.epoch;
  },
  startSync: (account, fence, currentFence) =>
    boundedCloudOpen(
      (async () => {
        const current = () => {
          const value = currentFence();
          return Boolean(value && sameFence(value, fence));
        };
        const transport = new SupabaseSyncTransport(
          requireCloud(),
          account.accountId,
          current,
        );
        const loaded = await loadAccountNotebook(
          account,
          transport,
          fence.epoch,
          current,
        );
        const sync = new SyncCoordinator(
          account,
          transport,
          fence,
          currentFence,
        );
        for (const id of loaded.blockedNoteIds)
          sync.pauseNote(
            id,
            loaded.message ??
              'This note needs reconciliation. Your device copy is preserved.',
          );
        try {
          await sync.start();
        } catch (error) {
          sync.stop();
          throw error;
        }
        return sync;
      })(),
    ),
});
