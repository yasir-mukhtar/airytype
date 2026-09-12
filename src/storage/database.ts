import Dexie, { type Table } from 'dexie';
import type {
  BaseRecord,
  FolderRecord,
  NoteRecord,
  PendingIntent,
  RecoveryRecord,
  SealedMutation,
} from './types';

export class AiryDatabase extends Dexie {
  drafts!: Table<NoteRecord, [string, string]>;
  bases!: Table<BaseRecord, [string, string]>;
  intents!: Table<PendingIntent, [string, string]>;
  outbox!: Table<SealedMutation, [string, string]>;
  folders!: Table<FolderRecord, [string, string]>;
  recoveries!: Table<RecoveryRecord, [string, string]>;

  constructor(name = 'airytype-local-preview-v1') {
    // A durability hint, not a guarantee against eviction or hardware failure.
    super(name, { chromeTransactionDurability: 'strict', cache: 'disabled' });
    this.version(1).stores({
      drafts: '[accountId+id], accountId, [accountId+folderId]',
      bases: '[accountId+id], accountId',
      intents: '[accountId+noteId], accountId',
      outbox: '[accountId+noteId], accountId, mutationId',
      folders: '[accountId+id], accountId',
      recoveries: '[accountId+originalId], accountId, recoveryId',
    });
  }
}
