import type {
  BaseRecord,
  CallbackFence,
  NoteRecord,
  SealedMutation,
} from '../storage/types';

export interface MutationAcknowledgement {
  epoch: string;
  note_id: string;
  mutation_id: string;
  version: string;
  title: string;
  folder_id: string | null;
  deleted_at: string | null;
  kind: 'normal' | 'recovery';
}

export interface ServiceState {
  epoch: string;
  minimum_protocol: number;
  reads_enabled: boolean;
  writes_enabled: boolean;
}

export interface SyncTransport {
  getServiceState(): Promise<ServiceState>;
  send(request: Readonly<SealedMutation>): Promise<MutationAcknowledgement>;
  getNote(noteId: string): Promise<BaseRecord>;
}

export type ReconciliationDecision =
  | { type: 'same' }
  | { type: 'replace-clean' }
  | { type: 'preserve-conflict' }
  | { type: 'preserve-prior-epoch' }
  | { type: 'missing-preserve-local' };

export function sameCanonicalState(
  a: Pick<NoteRecord, 'title' | 'body' | 'folderId' | 'deletedAt'>,
  b: Pick<BaseRecord, 'title' | 'body' | 'folderId' | 'deletedAt'>,
): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.folderId === b.folderId &&
    a.deletedAt === b.deletedAt
  );
}

export function decideReconciliation(input: {
  draft: NoteRecord;
  base: BaseRecord | undefined;
  remote: BaseRecord | null;
  hasPending: boolean;
  currentEpoch: string;
}): ReconciliationDecision {
  if (input.base && input.base.epoch !== input.currentEpoch)
    return { type: 'preserve-prior-epoch' };
  if (!input.remote) return { type: 'missing-preserve-local' };
  if (input.remote.epoch !== input.currentEpoch)
    return { type: 'preserve-prior-epoch' };
  if (sameCanonicalState(input.draft, input.remote)) return { type: 'same' };
  if (
    input.hasPending ||
    !input.base ||
    !sameCanonicalState(input.draft, input.base)
  )
    return { type: 'preserve-conflict' };
  return { type: 'replace-clean' };
}

export function sameFence(a: CallbackFence, b: CallbackFence): boolean {
  return (
    a.accountId === b.accountId &&
    a.sessionId === b.sessionId &&
    a.writerId === b.writerId &&
    a.epoch === b.epoch
  );
}

export function validateAcknowledgement(
  request: SealedMutation,
  ack: MutationAcknowledgement,
): void {
  if (
    ack.note_id !== request.noteId ||
    ack.mutation_id !== request.mutationId ||
    ack.epoch !== request.epoch
  ) {
    throw new Error('The acknowledgement does not match its sealed request.');
  }
  if (!/^[1-9][0-9]*$/.test(ack.version))
    throw new Error('The server returned an invalid version.');
  if (
    request.expectedVersion !== null &&
    BigInt(ack.version) <= BigInt(request.expectedVersion)
  ) {
    throw new Error('The accepted version must advance the sealed base.');
  }
  if ([...ack.title].length > 200)
    throw new Error('The server returned an invalid title.');
  if (ack.deleted_at !== null && !Number.isFinite(Date.parse(ack.deleted_at)))
    throw new Error('The server returned an invalid deletion time.');
}

/** Only acknowledged fields that have not since changed inherit canonical metadata. */
export function applyAckToDraft(
  current: NoteRecord,
  sealed: SealedMutation,
  ack: MutationAcknowledgement,
): NoteRecord {
  return {
    ...current,
    baseVersion: ack.version,
    title: current.title === sealed.title ? ack.title : current.title,
    folderId:
      current.folderId === sealed.folderId ? ack.folder_id : current.folderId,
    // A reply is never an editor-body replacement instruction.
    body: current.body,
    kind: current.generation === sealed.generation ? ack.kind : current.kind,
  };
}
