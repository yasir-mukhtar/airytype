export type PauseReason =
  | 'session'
  | 'service'
  | 'epoch'
  | 'protocol'
  | 'conflict'
  | 'remedy'
  | 'local';
export class SyncPause extends Error {
  constructor(
    readonly reason: PauseReason,
    message: string,
  ) {
    super(message);
  }
}
export class SyncRetry extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

/** Map the repository's SQL contract and PostgREST failures to bounded action. */
export function syncFailure(
  error: { message: string; code?: string },
  status?: number,
): Error {
  const message = error.message;
  if (
    status === 401 ||
    error.code === 'PGRST301' ||
    /AUTH_REQUIRED|EMAIL_UNVERIFIED|ACCOUNT_UNAVAILABLE/.test(message)
  )
    return new SyncPause('session', message);
  if (status === 429 || message === 'RATE_LIMITED')
    return new SyncRetry(message, 2000);
  if (
    (status !== undefined && status >= 500) ||
    /Failed to fetch|fetch failed|NetworkError|Load failed/i.test(message)
  )
    return new SyncRetry(message);
  if (
    /VERSION_CONFLICT|NOTE_ALREADY_EXISTS|NOTE_DELETED|NOTE_NOT_FOUND/.test(
      message,
    )
  )
    return new SyncPause('conflict', message);
  if (message === 'EPOCH_MISMATCH') return new SyncPause('epoch', message);
  if (message === 'PROTOCOL_UNSUPPORTED')
    return new SyncPause('protocol', message);
  if (message === 'SERVICE_UNAVAILABLE')
    return new SyncPause('service', message);
  return new SyncPause('remedy', message);
}
