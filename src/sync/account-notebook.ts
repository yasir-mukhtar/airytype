import type { LocalRepository } from '../storage/repository';
import { LOCAL_ACCOUNT_ID, type BaseRecord } from '../storage/types';
import { SyncPause } from './errors';
import {
  sameCanonicalState,
  type AccountNotebookTransport,
  type ManifestNote,
  type SyncTransport,
} from './protocol';

export interface AccountNotebookLoad {
  blockedNoteIds: string[];
  message: string | null;
}

function assertCurrent(repo: LocalRepository, isCurrent: () => boolean): void {
  if (
    repo.accountId === LOCAL_ACCOUNT_ID ||
    repo.getSnapshot().mode !== 'writer' ||
    !isCurrent()
  )
    throw new SyncPause(
      'session',
      'This account notebook is no longer active.',
    );
}

async function localState(repo: LocalRepository, noteId: string) {
  const key: [string, string] = [repo.accountId, noteId];
  const [base, intent, outbox] = await repo.database.transaction(
    'r',
    repo.database.bases,
    repo.database.intents,
    repo.database.outbox,
    async () =>
      Promise.all([
        repo.database.bases.get(key),
        repo.database.intents.get(key),
        repo.database.outbox.get(key),
      ]),
  );
  // Read memory after the asynchronous transaction: a newer generation wins.
  const draft = repo.getNote(noteId);
  const pending = Boolean(
    intent ||
    outbox ||
    (draft &&
      (repo.getSnapshot().statuses[noteId] !== 'saved-local' ||
        !base ||
        !sameCanonicalState(draft, base))),
  );
  return { base, draft, intent, outbox, pending };
}

function priorEpoch(
  state: Awaited<ReturnType<typeof localState>>,
  epoch: string,
): boolean {
  return Boolean(
    (state.base && state.base.epoch !== epoch) ||
    (state.outbox && state.outbox.epoch !== epoch),
  );
}

function report(blocked: Set<string>): AccountNotebookLoad {
  return {
    blockedNoteIds: [...blocked],
    message: blocked.size
      ? 'Some device copies need recovery before cloud editing. Their writing is preserved and can be downloaded.'
      : null,
  };
}

/** Fetch one joined body/version snapshot, retaining all newer local work. */
export async function refreshAccountNote(
  repo: LocalRepository,
  transport: Pick<SyncTransport, 'getNote'>,
  epoch: string,
  noteId: string,
  isCurrent: () => boolean,
): Promise<AccountNotebookLoad> {
  assertCurrent(repo, isCurrent);
  const before = await localState(repo, noteId);
  assertCurrent(repo, isCurrent);
  if (priorEpoch(before, epoch)) return report(new Set([noteId]));
  if (
    before.outbox ||
    (before.draft && !before.base && before.draft.baseVersion === null)
  )
    return report(new Set());
  let remote: BaseRecord;
  try {
    remote = await transport.getNote(noteId);
  } catch (error) {
    assertCurrent(repo, isCurrent);
    if (error instanceof SyncPause && error.reason === 'conflict')
      return report(new Set([noteId]));
    throw error;
  }
  assertCurrent(repo, isCurrent);
  if (remote.accountId !== repo.accountId || remote.id !== noteId)
    throw new SyncPause('protocol', 'The cloud returned a different note.');
  if (remote.epoch !== epoch)
    throw new SyncPause(
      'epoch',
      'The cloud dataset changed. Device copies are preserved.',
    );
  const state = await localState(repo, noteId);
  assertCurrent(repo, isCurrent);
  if (priorEpoch(state, epoch)) return report(new Set([noteId]));
  // A lost acknowledgement is resolved by replaying its immutable request,
  // even if that accepted write is already visible in the remote snapshot.
  if (state.outbox) return report(new Set());
  if (state.base && BigInt(remote.version) < BigInt(state.base.version))
    return report(new Set());
  if (state.pending) {
    const unchangedBase =
      state.base?.version === remote.version &&
      sameCanonicalState(state.base, remote);
    return report(new Set(unchangedBase ? [] : [noteId]));
  }
  const installed = await repo.installRemoteNote(remote, isCurrent);
  assertCurrent(repo, isCurrent);
  if (installed) return report(new Set());
  // The atomic install can lose a race to typing or acknowledgement. Classify
  // again without overwriting memory or discarding a now-pending request.
  const latest = await localState(repo, noteId);
  assertCurrent(repo, isCurrent);
  if (priorEpoch(latest, epoch)) return report(new Set([noteId]));
  if (
    latest.outbox ||
    (latest.base &&
      BigInt(latest.base.version) >= BigInt(remote.version) &&
      (latest.base.version !== remote.version ||
        sameCanonicalState(latest.base, remote)))
  )
    return report(new Set());
  return report(new Set([noteId]));
}

function sameMetadata(base: BaseRecord, remote: ManifestNote): boolean {
  return (
    base.title === remote.title &&
    base.folderId === remote.folder_id &&
    base.deletedAt ===
      (remote.deleted_at === null ? null : Date.parse(remote.deleted_at))
  );
}

/** Bounded startup slice; the caller pauses returned notes before starting sends.
 * Missing/stale bodies are read sequentially. Unchanged cached bodies are reused.
 * Full lazy metadata storage and conflict recovery remain separate work.
 */
export async function loadAccountNotebook(
  repo: LocalRepository,
  transport: AccountNotebookTransport,
  epoch: string,
  isCurrent: () => boolean,
): Promise<AccountNotebookLoad> {
  assertCurrent(repo, isCurrent);
  const manifest = await transport.getManifest();
  assertCurrent(repo, isCurrent);
  if (manifest.epoch !== epoch)
    throw new SyncPause(
      'epoch',
      'The cloud dataset changed. Device copies are preserved.',
    );
  const remoteNotes = new Map(manifest.notes.map((note) => [note.id, note]));
  const blocked = new Set<string>();
  const ids = new Set([
    ...repo.getSnapshot().notes.map((note) => note.id),
    ...remoteNotes.keys(),
  ]);
  for (const noteId of ids) {
    assertCurrent(repo, isCurrent);
    const state = await localState(repo, noteId);
    assertCurrent(repo, isCurrent);
    const remote = remoteNotes.get(noteId);
    if (priorEpoch(state, epoch)) {
      blocked.add(noteId);
      continue;
    }
    if (!remote || remote.purged_at) {
      if (
        state.draft &&
        (remote?.purged_at ||
          state.base ||
          state.draft.baseVersion !== null ||
          (state.outbox && state.outbox.operation !== 'create'))
      )
        blocked.add(noteId);
      continue;
    }
    if (state.outbox) continue;
    if (state.base && state.draft) {
      const order = BigInt(remote.version) - BigInt(state.base.version);
      if (order < 0n) continue;
      if (order === 0n) {
        if (!sameMetadata(state.base, remote)) blocked.add(noteId);
        continue;
      }
    }
    if (state.pending) {
      blocked.add(noteId);
      continue;
    }
    const result = await refreshAccountNote(
      repo,
      transport,
      epoch,
      noteId,
      isCurrent,
    );
    for (const id of result.blockedNoteIds) blocked.add(id);
  }
  assertCurrent(repo, isCurrent);
  return report(blocked);
}
