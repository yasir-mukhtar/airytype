import { describe, expect, it, vi } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import {
  buildPublicationLink,
  buildTokenLink,
  createShareLink,
  decodePublication,
  encodePublication,
  fetchPublication,
  MAX_PUBLICATION_URL_LENGTH,
  revokePublication,
} from '../../src/publish/link';

const snapshot = {
  title: 'A little space 🌿',
  body: '# Hello\n\nSome *formatted* words — selamat pagi. é\n\n- one\n- two\n',
  publishedAt: 1_759_000_000_000,
};
const origin = 'https://airytype.example';
const token = '0123456789abcdef0123456789abcdef';

describe('publication links', () => {
  it('round-trips a snapshot through its compressed fragment', () => {
    const link = buildPublicationLink(snapshot, origin);
    expect(link.startsWith(`${origin}/published.html#v1.`)).toBe(true);
    expect(decodePublication(new URL(link).hash)).toEqual({
      kind: 'embedded',
      snapshot,
    });
  });

  it('keeps an empty title and unicode text exact', () => {
    const sparse = { title: '', body: 'café ☕ — em—dash', publishedAt: 0 };
    expect(decodePublication(`#${encodePublication(sparse)}`)).toEqual({
      kind: 'embedded',
      snapshot: sparse,
    });
  });

  it('builds a short token link and decodes it back', () => {
    const link = buildTokenLink(token, origin);
    expect(link).toBe(`${origin}/published.html#t.${token}`);
    expect(link.length).toBeLessThan(80);
    expect(decodePublication(new URL(link).hash)).toEqual({
      kind: 'token',
      token,
    });
  });

  it('rejects missing, malformed, and truncated payloads', () => {
    expect(decodePublication('')).toBeNull();
    expect(decodePublication('#')).toBeNull();
    expect(decodePublication('#v2.abc')).toBeNull();
    expect(decodePublication('#v1.not valid!')).toBeNull();
    const valid = encodePublication(snapshot);
    expect(decodePublication(`#${valid.slice(0, -8)}`)).toBeNull();
    expect(decodePublication(`#v1.${'A'.repeat(7)}`)).toBeNull();
  });

  it('rejects malformed token fragments without treating them as tokens', () => {
    expect(decodePublication('#t.')).toBeNull();
    expect(decodePublication('#t.' + 'a'.repeat(31))).toBeNull();
    expect(decodePublication('#t.' + 'g'.repeat(32))).toBeNull();
    expect(decodePublication('#t.' + 'a'.repeat(33))).toBeNull();
    expect(decodePublication('#t.' + 'A'.repeat(32))).toBeNull();
    expect(decodePublication('#t.' + token + '?x')).toBeNull();
  });

  it('rejects payloads that decode to unexpected JSON shapes', () => {
    const toHash = (value: unknown) =>
      `#v1.${toBase64Url(deflateSync(strToU8(JSON.stringify(value))))}`;
    for (const value of [
      null,
      'text',
      { b: 42 },
      { t: 'x' },
      { t: 'x', b: 'y', u: 'soon' },
    ])
      expect(decodePublication(toHash(value))).toBeNull();
  });

  it('refuses compressed payloads that expand past the reader limit', () => {
    const huge = deflateSync(strToU8('x'.repeat(4 * 1024 * 1024)));
    expect(huge.length).toBeLessThan(512 * 1024);
    const bomb = `#v1.${toBase64Url(huge)}`;
    expect(decodePublication(bomb)).toBeNull();
  });

  it('rejects notes whose links would be too long to share', () => {
    // Genuinely incompressible content: random printable characters.
    const noise = Array.from(
      crypto.getRandomValues(new Uint8Array(40_000)),
      (byte) => String.fromCharCode(97 + (byte % 26)),
    ).join('');
    expect(() =>
      buildPublicationLink(
        { title: '', body: noise, publishedAt: 0 },
        origin,
      ),
    ).toThrow(/too long/);
    const fitting = { title: '', body: 'a short note', publishedAt: 0 };
    expect(
      buildPublicationLink(fitting, origin).length,
    ).toBeLessThanOrEqual(MAX_PUBLICATION_URL_LENGTH);
  });
});

describe('server-backed share links', () => {
  it('stores the snapshot and returns a short token link', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ token }, { status: 201 }));
    const share = await createShareLink(snapshot, origin, fetcher);
    expect(share).toEqual({
      url: `${origin}/published.html#t.${token}`,
      token,
      embedded: false,
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${origin}/api/publish`);
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual({
      t: snapshot.title,
      b: snapshot.body,
      u: snapshot.publishedAt,
    });
  });

  it.each([
    new Response('nope', { status: 503 }),
    Response.json({ token: 'not-a-token' }),
    Response.json({}),
  ])('falls back to an embedded link when the API declines', async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const share = await createShareLink(snapshot, origin, fetcher);
    expect(share.token).toBeNull();
    expect(share.embedded).toBe(true);
    expect(share.url).toContain('#v1.');
    expect(decodePublication(new URL(share.url).hash)).toEqual({
      kind: 'embedded',
      snapshot,
    });
  });

  it('falls back to an embedded link when the network is unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const share = await createShareLink(snapshot, origin, fetcher);
    expect(share.embedded).toBe(true);
    expect(share.url).toContain('#v1.');
  });

  it('fetches the snapshot behind a token', async () => {
    const body = { t: 'Note', b: '# Note\n\nBody', u: 1_759_000_000_000 };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(body));
    expect(await fetchPublication(token, fetcher)).toEqual({
      title: 'Note',
      body: body.b,
      publishedAt: body.u,
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      `/api/publication/${token}`,
    );
  });

  it.each([
    new Response('nope', { status: 404 }),
    Response.json({ t: 42, b: 'body' }),
    Response.json('not-json'),
  ])('returns null for missing or malformed token payloads', async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(await fetchPublication(token, fetcher)).toBeNull();
  });

  it('does not send a request for a malformed token', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await fetchPublication('bad-token', fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('revokes a token publication', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    expect(await revokePublication(token, origin, fetcher)).toBe(true);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      `${origin}/api/publication/${token}`,
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('reports revoke failures instead of silently succeeding', async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('down'));
    expect(await revokePublication(token, origin, down)).toBe(false);
    const err = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    expect(await revokePublication(token, origin, err)).toBe(false);
    expect(await revokePublication('bad', origin, vi.fn())).toBe(false);
  });
});

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
