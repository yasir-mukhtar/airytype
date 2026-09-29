import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';

/**
 * A published note is a snapshot that travels inside its own link. Nothing is
 * uploaded: the deflate-compressed JSON lives in the fragment of /published.html, so
 * the text is never sent to the server or written to request logs.
 */
export interface PublicationSnapshot {
  title: string;
  body: string;
  publishedAt: number;
}

const FORMAT_PREFIX = 'v1.';

/** Links longer than this become impractical to share through chat and email. */
export const MAX_PUBLICATION_URL_LENGTH = 24_000;
/** Inbound compressed payload cap for the read-only page. */
const MAX_COMPRESSED_BYTES = 512 * 1024;
/** Reader-side inflation ceiling; guards every visitor against expand bombs. */
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const CHUNK = 64 * 1024;

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

/** Returns the decoded snapshot, or null for any malformed/truncated payload. */
export function decodePublication(hash: string): PublicationSnapshot | null {
  const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!encoded.startsWith(FORMAT_PREFIX)) return null;
  const compressed = fromBase64Url(encoded.slice(FORMAT_PREFIX.length));
  if (!compressed || compressed.length > MAX_COMPRESSED_BYTES) return null;
  const json = inflateBounded(compressed, MAX_DECOMPRESSED_BYTES);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).b !== 'string' ||
      ((parsed as Record<string, unknown>).t !== undefined &&
        typeof (parsed as Record<string, unknown>).t !== 'string') ||
      ((parsed as Record<string, unknown>).u !== undefined &&
        typeof (parsed as Record<string, unknown>).u !== 'number')
    )
      return null;
    const record = parsed as { t?: string; b: string; u?: number };
    return {
      title: record.t ?? '',
      body: record.b,
      publishedAt: record.u ?? 0,
    };
  } catch {
    return null;
  }
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
