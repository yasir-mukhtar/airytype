export const MAX_BODY_BYTES = 1_048_576;
export const LOCAL_ACCOUNT_ID = 'local-preview';

/** Versions travel as strings so a database bigint is never rounded. */
export type ServerVersion = string;
export type WriterMode = 'writer' | 'readonly' | 'unsupported';
export type SaveStatus = 'saving' | 'saved-local' | 'error';

export interface NoteRecord {
  accountId: string;
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  kind: 'normal' | 'recovery';
  writerId: string;
  generation: number;
  baseVersion: ServerVersion | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface FolderRecord {
  accountId: string;
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BaseRecord {
  accountId: string;
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  deletedAt: number | null;
  version: ServerVersion;
  epoch: string;
  kind?: 'normal' | 'recovery';
  createdAt?: number;
  updatedAt?: number;
}

export interface PendingIntent {
  accountId: string;
  noteId: string;
  generation: number;
}

export interface CallbackFence {
  accountId: string;
  sessionId: string;
  writerId: string;
  epoch: string;
}

export interface SealedMutation extends CallbackFence {
  protocol: 1;
  mutationId: string;
  noteId: string;
  expectedVersion: ServerVersion | null;
  generation: number;
  operation: 'create' | 'save';
  title: string;
  body: string;
  folderId: string | null;
  deletedAt: number | null;
  sealedAt: number;
}

export interface RecoveryRecord {
  accountId: string;
  originalId: string;
  recoveryId: string;
  capturedGeneration: number;
  serverAlternative: BaseRecord;
  createdAt: number;
}

export interface RepositorySnapshot {
  ready: boolean;
  mode: WriterMode;
  notes: readonly NoteRecord[];
  folders: readonly FolderRecord[];
  statuses: Readonly<Record<string, SaveStatus>>;
  error: string | null;
}

export type NotePatch = Partial<
  Pick<NoteRecord, 'title' | 'body' | 'folderId'>
>;
