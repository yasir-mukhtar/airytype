import { strToU8, zipSync } from 'fflate';
import type { FolderRecord, NoteRecord } from '../storage/types';
import { downloadBytes, markdownBytes, safeFilenamePart } from './markdown';

export interface LibraryExportOptions {
  includeTrash?: boolean;
  capturedAt?: Date;
}

export interface LibraryManifest {
  format: 'airytype-library';
  formatVersion: 1;
  capturedAt: string;
  source: 'local-device';
  completeFor: 'captured-local-library';
  includesTrash: boolean;
  collectionNotice: string;
  folders: Array<{
    id: string;
    name: string;
    parentId: string | null;
    path: string;
  }>;
  notes: Array<{
    id: string;
    title: string;
    folderId: string | null;
    kind: string;
    generation: number;
    sourceVersion: string | null;
    includesLocalDraft: true;
    deletedAt: number | null;
    path: string;
  }>;
  failures: never[];
}

function collisionKey(path: string): string {
  return path.normalize('NFKC').toLocaleLowerCase('en-US');
}

function uniquePart(
  label: string,
  id: string,
  used: Set<string>,
  extension = '',
): string {
  const base = safeFilenamePart(label);
  let result = `${base}${extension}`;
  if (used.has(collisionKey(result))) {
    const suffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'copy';
    result = `${base} -- ${suffix}${extension}`;
    let attempt = 2;
    while (used.has(collisionKey(result)))
      result = `${base} -- ${suffix}-${attempt++}${extension}`;
  }
  used.add(collisionKey(result));
  return result;
}

/** The caller supplies a captured local snapshot; later edits cannot change ZIP membership or bytes. */
export function buildLibraryArchive(
  notesInput: readonly NoteRecord[],
  foldersInput: readonly FolderRecord[],
  options: LibraryExportOptions = {},
): { bytes: Uint8Array; manifest: LibraryManifest } {
  const notes = notesInput
    .filter((note) => options.includeTrash || !note.deletedAt)
    .map((note) => ({ ...note }));
  const folders = foldersInput.map((folder) => ({ ...folder }));
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const folderPaths = new Map<string, string>();
  const usedByParent = new Map<string, Set<string>>();
  const usedFor = (parent: string): Set<string> => {
    if (!usedByParent.has(parent)) usedByParent.set(parent, new Set());
    return usedByParent.get(parent)!;
  };
  // A ZIP must not contain both a directory and a file called manifest.json.
  usedFor('').add(collisionKey('manifest.json'));
  const pathFor = (id: string, visited = new Set<string>()): string => {
    const existing = folderPaths.get(id);
    if (existing !== undefined) return existing;
    const folder = folderById.get(id);
    if (!folder || visited.has(id)) return '';
    visited.add(id);
    const parentPath = folder.parentId ? pathFor(folder.parentId, visited) : '';
    const part = uniquePart(folder.name, id, usedFor(parentPath));
    const path = parentPath ? `${parentPath}/${part}` : part;
    folderPaths.set(id, path);
    return path;
  };
  // Deterministic IDs decide suffixes, independent of updated timestamps.
  for (const folder of [...folders].sort((a, b) => a.id.localeCompare(b.id)))
    pathFor(folder.id);

  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  const manifest: LibraryManifest = {
    format: 'airytype-library',
    formatVersion: 1,
    capturedAt: (options.capturedAt ?? new Date()).toISOString(),
    source: 'local-device',
    completeFor: 'captured-local-library',
    includesTrash: Boolean(options.includeTrash),
    collectionNotice:
      'Contains the captured notes on this device. Cloud completeness and database-wide point-in-time backup are not claimed. Importing Markdown preserves text; manifest-based library restoration is not implemented.',
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      path: folderPaths.get(folder.id) ?? '',
    })),
    notes: [],
    failures: [],
  };
  for (const note of notes.sort((a, b) => a.id.localeCompare(b.id))) {
    const parentPath = note.folderId
      ? (folderPaths.get(note.folderId) ?? '')
      : '';
    const filename = uniquePart(
      note.title,
      note.id,
      usedFor(parentPath),
      '.md',
    );
    const path = parentPath ? `${parentPath}/${filename}` : filename;
    files[path] = markdownBytes(note.body);
    manifest.notes.push({
      id: note.id,
      title: note.title,
      folderId: note.folderId,
      kind: note.kind,
      generation: note.generation,
      sourceVersion: note.baseVersion,
      includesLocalDraft: true,
      deletedAt: note.deletedAt,
      path,
    });
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return { bytes: zipSync(files, { level: 6 }), manifest };
}

export function downloadLibrary(
  notes: readonly NoteRecord[],
  folders: readonly FolderRecord[],
  options: LibraryExportOptions = {},
): void {
  const { bytes, manifest } = buildLibraryArchive(notes, folders, options);
  downloadBytes(
    bytes,
    `AiryType-library-${manifest.capturedAt.slice(0, 10)}.zip`,
    'application/zip',
  );
}
