import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import {
  buildPublicationLink,
  decodePublication,
  encodePublication,
  MAX_PUBLICATION_URL_LENGTH,
} from '../../src/publish/link';

const snapshot = {
  title: 'A little space 🌿',
  body: '# Hello\n\nSome *formatted* words — selamat pagi. é\n\n- one\n- two\n',
  publishedAt: 1_759_000_000_000,
};

describe('publication links', () => {
  it('round-trips a snapshot through its compressed fragment', () => {
    const link = buildPublicationLink(snapshot, 'https://airytype.example');
    expect(link.startsWith('https://airytype.example/p.html#v1.')).toBe(true);
    expect(decodePublication(new URL(link).hash)).toEqual(snapshot);
  });

  it('keeps an empty title and unicode text exact', () => {
    const sparse = { title: '', body: 'café ☕ — em—dash', publishedAt: 0 };
    expect(decodePublication(`#${encodePublication(sparse)}`)).toEqual(sparse);
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
        'https://airytype.example',
      ),
    ).toThrow(/too long/);
    const fitting = { title: '', body: 'a short note', publishedAt: 0 };
    expect(
      buildPublicationLink(fitting, 'https://airytype.example').length,
    ).toBeLessThanOrEqual(MAX_PUBLICATION_URL_LENGTH);
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
