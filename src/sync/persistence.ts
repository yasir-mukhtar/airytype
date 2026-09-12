import type { AiryDatabase } from '../storage/database';
import {
  MAX_BODY_BYTES,
  type BaseRecord,
  type CallbackFence,
  type SealedMutation,
} from '../storage/types';
import {
  applyAckToDraft,
  sameCanonicalState,
  sameFence,
  validateAcknowledgement,
  type MutationAcknowledgement,
} from './protocol';

/** All methods must run under the origin writer lock. Not connected to the preview UI. */
export class SyncPersistence {
  constructor(
    private database: AiryDatabase,
    private currentFence: () => CallbackFence | null,
  ) {}

  private assertFence(fence: CallbackFence): void {
    const current = this.currentFence();
    if (!current || !sameFence(fence, current))
      throw new Error('This sync callback no longer owns the writing session.');
  }

  async seal(
    noteId: string,
    fence: CallbackFence,
  ): Promise<Readonly<SealedMutation>> {
    this.assertFence(fence);
    const sealed = await this.database.transaction(
      'rw',
      this.database.drafts,
      this.database.bases,
      this.database.intents,
      this.database.outbox,
      async () => {
        this.assertFence(fence);
        const key: [string, string] = [fence.accountId, noteId];
        const existing = await this.database.outbox.get(key);
        // An exact retry is allowed after a new writer session takes ownership.
        // The sending callback is fenced separately; the original request stays intact.
        if (existing) {
          if (existing.epoch !== fence.epoch)
            throw new Error(
              'Preserve prior-epoch work before sending requests.',
            );
          return Object.freeze({ ...existing });
        }
        const draft = await this.database.drafts.get(key);
        const intent = await this.database.intents.get(key);
        const base = await this.database.bases.get(key);
        if (!draft || !intent || intent.generation !== draft.generation)
          throw new Error('Only a committed pending draft can be sealed.');
        if (draft.deletedAt)
          throw new Error('Trashed notes use a separate versioned mutation.');
        if (new TextEncoder().encode(draft.body).byteLength > MAX_BODY_BYTES)
          throw new Error(
            'Reduce this note below 1 MiB before cloud sync. Your local draft remains available.',
          );
        if (draft.body.includes('\0'))
          throw new Error('Remove NUL characters before cloud sync.');
        if (base && base.epoch !== fence.epoch)
          throw new Error('Preserve prior-epoch work before sending requests.');
        if (!base && draft.baseVersion !== null)
          throw new Error(
            'A missing accepted base requires reconciliation before sync.',
          );
        const request: SealedMutation = {
          ...fence,
          protocol: 1,
          mutationId: crypto.randomUUID(),
          noteId,
          expectedVersion: base?.version ?? null,
          generation: draft.generation,
          operation: base ? 'save' : 'create',
          title: draft.title,
          body: draft.body,
          folderId: draft.folderId,
          deletedAt: draft.deletedAt,
          sealedAt: Date.now(),
        };
        await this.database.outbox.add(request);
        return Object.freeze({ ...request });
      },
    );
    this.assertFence(fence);
    return sealed;
  }

  async acknowledge(
    request: Readonly<SealedMutation>,
    ack: MutationAcknowledgement,
    callbackFence: CallbackFence,
  ): Promise<{ clean: boolean; base: BaseRecord }> {
    this.assertFence(callbackFence);
    if (
      request.accountId !== callbackFence.accountId ||
      request.epoch !== callbackFence.epoch
    )
      throw new Error('Request belongs to a different account or dataset.');
    validateAcknowledgement(request, ack);
    const result = await this.database.transaction(
      'rw',
      this.database.bases,
      this.database.outbox,
      this.database.drafts,
      this.database.intents,
      async () => {
        this.assertFence(callbackFence);
        const key: [string, string] = [request.accountId, request.noteId];
        const persisted = await this.database.outbox.get(key);
        if (!persisted || JSON.stringify(persisted) !== JSON.stringify(request))
          throw new Error('The exact sealed replay record is unavailable.');
        const draft = await this.database.drafts.get(key);
        if (!draft)
          throw new Error(
            'The local draft disappeared before acknowledgement.',
          );
        const previousBase = await this.database.bases.get(key);
        if (
          previousBase &&
          (previousBase.epoch !== request.epoch ||
            BigInt(previousBase.version) >= BigInt(ack.version))
        ) {
          throw new Error(
            'A newer or different-epoch base needs reconciliation.',
          );
        }
        const base: BaseRecord = {
          accountId: request.accountId,
          id: request.noteId,
          title: ack.title,
          body: request.body,
          folderId: ack.folder_id,
          deletedAt:
            ack.deleted_at === null ? null : Date.parse(ack.deleted_at),
          version: ack.version,
          epoch: ack.epoch,
        };
        const nextDraft = applyAckToDraft(draft, request, ack);
        // Local cleanliness alone is not a "Synced" UI claim: callers must also
        // reconcile any newer remote version hints before presenting that status.
        const clean =
          draft.generation === request.generation &&
          sameCanonicalState(draft, request);
        await this.database.bases.put(base);
        await this.database.drafts.put(nextDraft);
        if (clean) await this.database.intents.delete(key);
        else
          await this.database.intents.put({
            accountId: request.accountId,
            noteId: request.noteId,
            generation: draft.generation,
          });
        // This delete commits atomically with the base and draft above.
        await this.database.outbox.delete(key);
        this.assertFence(callbackFence);
        return { clean, base };
      },
    );
    // The transaction has committed under its fence. Return that fact even if
    // the session changes in the completion microtask: the account-bound
    // repository must reflect the committed metadata before its next journal
    // write. The coordinator independently fences further network scheduling.
    return result;
  }
}
