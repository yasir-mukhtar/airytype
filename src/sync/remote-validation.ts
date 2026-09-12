import { MAX_BODY_BYTES } from '../storage/types';
import { SyncPause } from './errors';
import type {
  AccountManifest,
  ManifestFolder,
  ManifestNote,
  ServiceState,
} from './protocol';

const encoder = new TextEncoder();

function invalid(): never {
  throw new SyncPause(
    'protocol',
    'The cloud response could not be verified. Device copies are preserved.',
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function optionalIdentifier(value: unknown): boolean {
  return value === null || identifier(value);
}

function version(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown): boolean {
  return value === null || timestamp(value);
}

function text(value: unknown, length: number): boolean {
  return (
    typeof value === 'string' &&
    !value.includes('\0') &&
    [...value].length <= length
  );
}

function note(value: unknown): ManifestNote {
  const row = object(value);
  if (
    !identifier(row.id) ||
    !text(row.title, 200) ||
    !optionalIdentifier(row.folder_id) ||
    !version(row.version) ||
    (row.kind !== 'normal' && row.kind !== 'recovery') ||
    !Number.isInteger(row.body_bytes) ||
    (row.body_bytes as number) < 0 ||
    (row.body_bytes as number) > MAX_BODY_BYTES ||
    !optionalTimestamp(row.deleted_at) ||
    !optionalTimestamp(row.purged_at) ||
    !timestamp(row.created_at) ||
    !timestamp(row.updated_at)
  )
    invalid();
  return row as unknown as ManifestNote;
}

function folder(value: unknown): ManifestFolder {
  const row = object(value);
  if (
    !identifier(row.id) ||
    !text(row.name, 80) ||
    !optionalIdentifier(row.parent_id) ||
    !version(row.version) ||
    !optionalTimestamp(row.deleted_at) ||
    !timestamp(row.updated_at)
  )
    invalid();
  return row as unknown as ManifestFolder;
}

export function validateServiceState(value: unknown): ServiceState {
  const state = object(value);
  if (
    !identifier(state.epoch) ||
    !Number.isInteger(state.minimum_protocol) ||
    (state.minimum_protocol as number) < 1 ||
    typeof state.reads_enabled !== 'boolean' ||
    typeof state.writes_enabled !== 'boolean'
  )
    invalid();
  return state as unknown as ServiceState;
}

/** A partial, truncated or oversized library must never look like an empty one. */
export function validateManifest(value: unknown): AccountManifest {
  if (value === null)
    throw new SyncPause('session', 'This account notebook is unavailable.');
  const manifest = object(value);
  if (
    !identifier(manifest.epoch) ||
    !Array.isArray(manifest.notes) ||
    !Array.isArray(manifest.folders)
  )
    invalid();
  if (
    manifest.notes.length + manifest.folders.length > 10_000 ||
    encoder.encode(JSON.stringify(value)).byteLength > 2_097_152
  )
    throw new SyncPause(
      'remedy',
      'This cloud library exceeds the supported metadata size. Device copies are preserved.',
    );
  const notes = manifest.notes.map(note);
  const folders = manifest.folders.map(folder);
  if (
    new Set(notes.map((entry) => entry.id)).size !== notes.length ||
    new Set(folders.map((entry) => entry.id)).size !== folders.length
  )
    invalid();
  const counts = object(manifest.counts);
  const expected: AccountManifest['counts'] = {
    normal_active: notes.filter(
      (entry) =>
        entry.kind === 'normal' && !entry.deleted_at && !entry.purged_at,
    ).length,
    normal_retained: notes.filter(
      (entry) => entry.kind === 'normal' && !entry.purged_at,
    ).length,
    recovery_retained: notes.filter(
      (entry) => entry.kind === 'recovery' && !entry.purged_at,
    ).length,
    note_tombstones: notes.filter((entry) => entry.purged_at).length,
    folder_active: folders.filter((entry) => !entry.deleted_at).length,
    folder_tombstones: folders.filter((entry) => entry.deleted_at).length,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[])
    if (counts[key] !== expected[key]) invalid();
  return { epoch: manifest.epoch, notes, folders, counts: expected };
}

export function validateRemoteNote(
  value: unknown,
  noteId: string,
): ManifestNote & { body: string; epoch: string } {
  if (value === null)
    throw new SyncPause(
      'conflict',
      'This note is unavailable in the cloud. Its device copy is preserved.',
    );
  const row = object(value);
  note(row);
  if (
    row.id !== noteId ||
    row.purged_at !== null ||
    !identifier(row.epoch) ||
    typeof row.body !== 'string' ||
    row.body.includes('\0') ||
    encoder.encode(row.body).byteLength !== row.body_bytes
  )
    invalid();
  return row as unknown as ManifestNote & { body: string; epoch: string };
}
