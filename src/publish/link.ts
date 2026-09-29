import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';

/**
 * A published note is a snapshot: title, body and the publish time. The public
 * link either carries a short KV token (`#t.…`) when the Worker publication
 * API answers, or the deflate-compressed snapshot itself (`#v1.…`) as a
 * serverless fallback — fragments never reach the server or request logs.
 */
export interface PublicationSnapshot {
  title: string;
  body: string;
  publishedAt: number;
}

export type PublicationRef =
  | { kind: 'embedded'; snapshot: PublicationSnapshot }
  | { kind: 'token'; token: string };

export interface ShareLink {
  url: string;
  /** Present for token links; needed to revoke the stored snapshot. */
  token: string | null;
  /** True when the note travels inside the link instead of a server copy. */
  embedded: boolean;
}

const FORMAT_PREFIX = 'v1.';
const TOKEN_PREFIX = 't.';
const TOKEN_SHAPE = /^[0-9a-f]{32}$/;

/** Links longer than this become impractical to share through chat and email. */
export const MAX_PUBLICATION_URL_LENGTH = 24_000;
/** Inbound compressed payload cap for the read-only page. */
const MAX_COMPRESSED_BYTES = 512 * 1024;
/** Reader-side inflation ceiling; guards every visitor against expand bombs. */
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const CHUNK = 64 * 1024;
const PUBLISH_TIMEOUT_MS = 6_000;

const B64_URL = /^[A-Za-z0-9_-]+$/;

export function encodePublication(snapshot: PublicationSnapshot): string {
  const json = JSON.stringify({
    t: snapshot.title,
    b: snapshot.body,
    u: snapshot.publishedAt,
  });
  return FORMAT_PREFIX + toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

export function buildPublicationLink(
  snapshot: PublicationSnapshot,
  origin: string,
): string {
  const url = `${origin}/published.html#${encodePublication(snapshot)}`;
  if (url.length > MAX_PUBLICATION_URL_LENGTH)
    throw new Error(
      'This note is too long to carry inside a shareable link. Download it as Markdown instead.',
    );
  return url;
}

export function buildTokenLink(token: string, origin: string): string {
  return `${origin}/published.html#${TOKEN_PREFIX}${token}`;
}

/**
 * Prefers a short token link via the Worker's KV store. Falls back to an
 * embedded link when the API is unreachable (e.g. plain local dev) — the
 * embedded path may itself throw when the note is too long.
 */
export async function createShareLink(
  snapshot: PublicationSnapshot,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<ShareLink> {
  try {
    const response = await fetcher(`${origin}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: snapshot.title,
        b: snapshot.body,
        u: snapshot.publishedAt,
      }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (response.ok) {
      const data: unknown = await response.json();
      const token = (data as { token?: unknown })?.token;
      if (typeof token === 'string' && TOKEN_SHAPE.test(token))
        return {
          url: buildTokenLink(token, origin),
          token,
          embedded: false,
        };
    }
  } catch {
    // The API is optional infrastructure; embedded links keep working.
  }
  return {
    url: buildPublicationLink(snapshot, origin),
    token: null,
    embedded: true,
  };
}

/** Revokes a token publication. Best-effort; returns whether it succeeded. */
export async function revokePublication(
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!TOKEN_SHAPE.test(token)) return false;
  try {
    const response = await fetcher(`${origin}/api/publication/${token}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      redirect: 'error',
    });
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

/** The snapshot a token link points at, or null on 404/network/schema errors. */
export async function fetchPublication(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicationSnapshot | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  try {
    const response = await fetcher(`/api/publication/${token}`, {
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return parseSnapshot(data);
  } catch {
    return null;
  }
}

/** Decodes a link fragment into either an embedded snapshot or a token. */
export function decodePublication(hash: string): PublicationRef | null {
  const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
  if (encoded.startsWith(TOKEN_PREFIX)) {
    const token = encoded.slice(TOKEN_PREFIX.length);
    return TOKEN_SHAPE.test(token) ? { kind: 'token', token } : null;
  }
  if (!encoded.startsWith(FORMAT_PREFIX)) return null;
  const compressed = fromBase64Url(encoded.slice(FORMAT_PREFIX.length));
  if (!compressed || compressed.length > MAX_COMPRESSED_BYTES) return null;
  const json = inflateBounded(compressed, MAX_DECOMPRESSED_BYTES);
  if (!json) return null;
  try {
    const snapshot = parseSnapshot(JSON.parse(json));
    return snapshot ? { kind: 'embedded', snapshot } : null;
  } catch {
    return null;
  }
}

function parseSnapshot(value: unknown): PublicationSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { t?: unknown; b?: unknown; u?: unknown };
  if (
    typeof record.b !== 'string' ||
    (record.t !== undefined && typeof record.t !== 'string') ||
    (record.u !== undefined && typeof record.u !== 'number')
  )
    return null;
  return {
    title: record.t ?? '',
    body: record.b,
    publishedAt: record.u ?? 0,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const triple =
      (a << 16) |
      ((hasB ? bytes[index + 1] : 0) << 8) |
      (hasC ? bytes[index + 2] : 0);
    output += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63];
    if (hasB) output += alphabet[(triple >> 6) & 63];
    if (hasC) output += alphabet[triple & 63];
  }
  return output;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!B64_URL.test(text) || text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of text) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/** Inflate in bounded chunks; returns null on corruption or size overflow. */
function inflateBounded(
  compressed: Uint8Array,
  maximum: number,
): string | null {
  const parts: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  const inflate = new Inflate((chunk: Uint8Array) => {
    if (overflow) return;
    size += chunk.byteLength;
    if (size > maximum) {
      overflow = true;
      return;
    }
    parts.push(chunk);
  });
  try {
    for (let offset = 0; offset < compressed.length; offset += CHUNK) {
      if (overflow) return null;
      inflate.push(compressed.subarray(offset, offset + CHUNK));
    }
    inflate.push(new Uint8Array(0), true);
  } catch {
    return null;
  }
  if (overflow) return null;
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return strFromU8(result);
  } catch {
    return null;
  }
}
