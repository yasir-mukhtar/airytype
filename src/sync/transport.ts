import { SyncPause, syncFailure } from './errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BaseRecord, SealedMutation } from '../storage/types';
import type {
  AccountManifest,
  AccountNotebookTransport,
  MutationAcknowledgement,
  ServiceState,
} from './protocol';
import {
  validateManifest,
  validateRemoteNote,
  validateServiceState,
} from './remote-validation';

export class SupabaseSyncTransport implements AccountNotebookTransport {
  constructor(
    private client: SupabaseClient,
    private accountId: string,
    private isCurrent: () => boolean = () => true,
  ) {}

  async getServiceState(): Promise<ServiceState> {
    this.assertCurrent();
    const { data, error, status } = await this.client.rpc('get_service_state');
    this.assertCurrent();
    if (error) throw syncFailure(error, status);
    return validateServiceState(data);
  }

  async getManifest(): Promise<AccountManifest> {
    const authorization = await this.accountAuthorization();
    const { data, error, status } = await this.client
      .rpc('list_manifest')
      .setHeader('Authorization', authorization);
    this.assertCurrent();
    if (error) throw syncFailure(error, status);
    return validateManifest(data);
  }

  async send(
    request: Readonly<SealedMutation>,
  ): Promise<MutationAcknowledgement> {
    if (request.accountId !== this.accountId)
      throw new Error('This request belongs to another account.');
    const authorization = await this.accountAuthorization();
    const { data, error, status } = await this.client
      .rpc(request.operation === 'create' ? 'create_note' : 'save_note', {
        p_request: {
          protocol: request.protocol,
          epoch: request.epoch,
          mutation_id: request.mutationId,
          note_id: request.noteId,
          expected_version: request.expectedVersion,
          title: request.title,
          body: request.body,
          folder_id: request.folderId,
        },
      })
      .setHeader('Authorization', authorization);
    this.assertCurrent();
    if (error) throw syncFailure(error, status);
    return data as MutationAcknowledgement;
  }

  async getNote(noteId: string): Promise<BaseRecord> {
    const authorization = await this.accountAuthorization();
    const { data, error, status } = await this.client
      .rpc('get_note', { p_note_id: noteId })
      .setHeader('Authorization', authorization);
    this.assertCurrent();
    if (error) throw syncFailure(error, status);
    const row = validateRemoteNote(data, noteId);
    return {
      accountId: this.accountId,
      id: row.id,
      title: row.title,
      body: row.body,
      folderId: row.folder_id,
      deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null,
      version: row.version,
      epoch: row.epoch,
      kind: row.kind,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    };
  }

  private async accountAuthorization(): Promise<string> {
    this.assertCurrent();
    const { data, error } = await this.client.auth.getSession();
    this.assertCurrent();
    if (error || !data.session || data.session.user.id !== this.accountId) {
      throw new SyncPause(
        'session',
        'Sign in to the same account to resume this notebook.',
      );
    }
    // Pin the token for this request. The SDK's shared session can change between
    // validation and fetch; its default dynamic token must not upload this body's
    // old account namespace into a newly signed-in account.
    return `Bearer ${data.session.access_token}`;
  }

  private assertCurrent(): void {
    if (!this.isCurrent())
      throw new SyncPause('session', 'This account session has ended.');
  }
}
