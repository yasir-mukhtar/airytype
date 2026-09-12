import type { SupabaseClient } from '@supabase/supabase-js';
import type { BaseRecord, SealedMutation } from '../storage/types';
import type {
  MutationAcknowledgement,
  ServiceState,
  SyncTransport,
} from './protocol';

export class SupabaseSyncTransport implements SyncTransport {
  constructor(
    private client: SupabaseClient,
    private accountId: string,
  ) {}

  async getServiceState(): Promise<ServiceState> {
    const { data, error } = await this.client.rpc('get_service_state');
    if (error) throw error;
    return data as ServiceState;
  }

  async send(
    request: Readonly<SealedMutation>,
  ): Promise<MutationAcknowledgement> {
    if (request.accountId !== this.accountId)
      throw new Error('This request belongs to another account.');
    const authorization = await this.accountAuthorization();
    const { data, error } = await this.client
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
    if (error) throw error;
    return data as MutationAcknowledgement;
  }

  async getNote(noteId: string): Promise<BaseRecord> {
    const authorization = await this.accountAuthorization();
    const { data, error } = await this.client
      .rpc('get_note', { p_note_id: noteId })
      .setHeader('Authorization', authorization);
    if (error) throw error;
    if (!data) throw new Error('The remote note is missing.');
    const row = data as {
      id: string;
      title: string;
      body: string;
      folder_id: string | null;
      deleted_at: string | null;
      version: string;
      epoch: string;
    };
    return {
      accountId: this.accountId,
      id: row.id,
      title: row.title,
      body: row.body,
      folderId: row.folder_id,
      deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null,
      version: row.version,
      epoch: row.epoch,
    };
  }

  private async accountAuthorization(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session || data.session.user.id !== this.accountId) {
      throw new Error('Sign in to the same account to resume this notebook.');
    }
    // Pin the token for this request. The SDK's shared session can change between
    // validation and fetch; its default dynamic token must not upload this body's
    // old account namespace into a newly signed-in account.
    return `Bearer ${data.session.access_token}`;
  }
}
