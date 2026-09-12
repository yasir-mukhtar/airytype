export interface PublicationConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  PUBLICATIONS_ENABLED: string;
}

const headers = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; sandbox; base-uri 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};

function respond(
  request: Request,
  status: number,
  body: string,
  extra?: Record<string, string>,
): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: { ...headers, ...extra },
  });
}

/** Read bounded JSON even when the upstream omits or lies about Content-Length. */
async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const maximum = 7 * 1024 * 1024; // A 1 MiB body can expand through JSON escaping.
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let count = 0;
  let json = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maximum) {
        await reader.cancel();
        throw new Error('PUBLICATION_RESPONSE_TOO_LARGE');
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json);
  } finally {
    reader.releaseLock();
  }
}

/** The Worker has only the public project key, never private-note privileges. */
export async function handlePublication(
  request: Request,
  config: PublicationConfig,
  fetchUpstream: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respond(request, 405, 'Method not allowed.\n', {
      Allow: 'GET, HEAD',
    });
  }
  const match = /^\/p\/([0-9a-f]{64})\.md$/.exec(new URL(request.url).pathname);
  if (!match || config.PUBLICATIONS_ENABLED !== 'true')
    return respond(request, 404, 'Not found.\n');
  if (
    !config.SUPABASE_URL ||
    !config.SUPABASE_ANON_KEY ||
    config.SUPABASE_ANON_KEY.startsWith('sb_secret_')
  ) {
    return respond(request, 503, 'Temporarily unavailable.\n', {
      'Retry-After': '60',
    });
  }
  try {
    const endpoint = new URL(
      '/rest/v1/rpc/read_publication',
      config.SUPABASE_URL,
    );
    if (
      endpoint.protocol !== 'https:' &&
      endpoint.hostname !== '127.0.0.1' &&
      endpoint.hostname !== 'localhost'
    ) {
      return respond(request, 503, 'Temporarily unavailable.\n');
    }
    const requestHeaders: Record<string, string> = {
      apikey: config.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    };
    // Legacy anon JWTs need Bearer auth; modern publishable keys are API keys only.
    if (config.SUPABASE_ANON_KEY.startsWith('eyJ'))
      requestHeaders.Authorization = `Bearer ${config.SUPABASE_ANON_KEY}`;
    const upstream = await fetchUpstream(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ p_token: match[1] }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return respond(request, 503, 'Temporarily unavailable.\n', {
        'Retry-After': '60',
      });
    }
    const publication = await readBoundedJson(upstream);
    if (publication === null) return respond(request, 404, 'Not found.\n');
    if (
      typeof publication !== 'object' ||
      !('body' in publication) ||
      typeof publication.body !== 'string' ||
      new TextEncoder().encode(publication.body).byteLength > 1024 * 1024
    ) {
      return respond(request, 503, 'Temporarily unavailable.\n');
    }
    return respond(request, 200, publication.body);
  } catch {
    // Do not emit the exception: upstream URLs/errors can contain public tokens.
    return respond(request, 503, 'Temporarily unavailable.\n', {
      'Retry-After': '60',
    });
  }
}
