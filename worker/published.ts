/**
 * Token-backed publications. The browser posts a Markdown snapshot; the Worker
 * stores it in KV under an unguessable token, and the read-only page at
 * /published fetches it back. The token carries no content, so published links
 * stay short.
 */
export interface PublishedStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PublishedConfig {
  PUBLICATIONS_ENABLED: string;
  PUBLICATIONS?: PublishedStore;
  PUBLISH_RATE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};

const TOKEN_PATH = /^\/api\/publication\/([0-9a-f]{32})$/;
const MAX_TITLE_CODEPOINTS = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 1_400_000;

function respond(request: Request, status: number, body?: unknown): Response {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Response(request.method === 'HEAD' ? null : payload, {
    status,
    headers: JSON_HEADERS,
  });
}

/** POST /api/publish — stores a {t, b, u} snapshot and returns its token. */
export async function handlePublishCreate(
  request: Request,
  config: PublishedConfig,
): Promise<Response> {
  if (config.PUBLICATIONS_ENABLED !== 'true' || !config.PUBLICATIONS)
    return respond(request, 404);
  if (request.method !== 'POST')
    return respond(request, 405, { error: 'method_not_allowed' });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_REQUEST_BYTES) return respond(request, 413);
  if (config.PUBLISH_RATE) {
    const key = request.headers.get('cf-connecting-ip') ?? 'anonymous';
    const outcome = await config.PUBLISH_RATE.limit({ key });
    if (!outcome.success) return respond(request, 429, { error: 'rate_limited' });
  }
  let parsed: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES)
      return respond(request, 413);
    parsed = JSON.parse(text);
  } catch {
    return respond(request, 400, { error: 'invalid_request' });
  }
  if (typeof parsed !== 'object' || parsed === null)
    return respond(request, 400, { error: 'invalid_request' });
  const snapshot = parsed as { t?: unknown; b?: unknown; u?: unknown };
  if (
    typeof snapshot.t !== 'string' ||
    typeof snapshot.b !== 'string' ||
    (snapshot.u !== undefined && typeof snapshot.u !== 'number')
  )
    return respond(request, 400, { error: 'invalid_request' });
  if ([...snapshot.t].length > MAX_TITLE_CODEPOINTS)
    return respond(request, 400, { error: 'title_too_long' });
  if (new TextEncoder().encode(snapshot.b).byteLength > MAX_BODY_BYTES)
    return respond(request, 413, { error: 'note_too_large' });
  const token = tokenId();
  const stored = JSON.stringify({
    t: snapshot.t,
    b: snapshot.b,
    u: typeof snapshot.u === 'number' ? snapshot.u : Date.now(),
  });
  try {
    await config.PUBLICATIONS.put(token, stored);
  } catch {
    return respond(request, 503, { error: 'temporarily_unavailable' });
  }
  return respond(request, 201, { token });
}

/** GET/HEAD /api/publication/<token> — returns the stored snapshot. */
export async function handlePublishedRead(
  request: Request,
  config: PublishedConfig,
): Promise<Response> {
  if (config.PUBLICATIONS_ENABLED !== 'true' || !config.PUBLICATIONS)
    return respond(request, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return respond(request, 405, { error: 'method_not_allowed' });
  const match = TOKEN_PATH.exec(new URL(request.url).pathname);
  if (!match) return respond(request, 404);
  let stored: string | null;
  try {
    stored = await config.PUBLICATIONS.get(match[1]);
  } catch {
    return respond(request, 503, { error: 'temporarily_unavailable' });
  }
  if (stored === null) return respond(request, 404);
  return new Response(request.method === 'HEAD' ? null : stored, {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/** DELETE /api/publication/<token> — token holders can revoke their link. */
export async function handlePublishedDelete(
  request: Request,
  config: PublishedConfig,
): Promise<Response> {
  if (config.PUBLICATIONS_ENABLED !== 'true' || !config.PUBLICATIONS)
    return respond(request, 404);
  if (request.method !== 'DELETE')
    return respond(request, 405, { error: 'method_not_allowed' });
  const match = TOKEN_PATH.exec(new URL(request.url).pathname);
  if (!match) return respond(request, 404);
  try {
    await config.PUBLICATIONS.delete(match[1]);
  } catch {
    return respond(request, 503, { error: 'temporarily_unavailable' });
  }
  return respond(request, 204);
}

/** 128-bit random token — short in the URL, unguessable in practice. */
function tokenId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
