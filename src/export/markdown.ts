import { MAX_BODY_BYTES } from '../storage/types';

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function safeFilenamePart(value: string, fallback = 'Untitled'): string {
  let part = value
    // File paths must not contain operating-system control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .trim();
  // Leave room for collision suffixes below common 255-byte filename limits.
  let bounded = '';
  for (const character of part) {
    if (utf8ByteLength(bounded + character) > 180) break;
    bounded += character;
  }
  part = bounded.replace(/[. ]+$/g, '');
  if (!part) part = fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    part = `_${part}`;
  return part;
}

export function markdownFilename(title: string): string {
  return `${safeFilenamePart(title)}.md`;
}

export function markdownBytes(body: string): Uint8Array {
  // Canonical editor text is LF. Export never injects a title, frontmatter, or BOM.
  return encoder.encode(body);
}

export interface MarkdownImport {
  title: string;
  body: string;
  originalFilename: string;
  normalizedLineEndings: boolean;
}

export async function importMarkdown(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
): Promise<MarkdownImport> {
  if (!/\.(md|txt)$/i.test(file.name))
    throw new Error('Choose a .md or .txt file.');
  // Allow CRLF input to normalize below the limit without loading unbounded data.
  if (file.size > MAX_BODY_BYTES * 2 + 3)
    throw new Error('Each note can contain up to 1 MiB of UTF-8 text.');
  const bytes = await file.arrayBuffer();
  let original: string;
  try {
    // Preserve a leading U+FEFF as well, so export/import never drops source text.
    original = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      'This file is not valid UTF-8. Save it as UTF-8 and try again.',
    );
  }
  if (original.includes('\0'))
    throw new Error(
      'This file contains NUL characters and cannot be imported.',
    );
  const body = normalizeLineEndings(original);
  if (utf8ByteLength(body) > MAX_BODY_BYTES)
    throw new Error('Each note can contain up to 1 MiB of UTF-8 text.');
  const basename = file.name
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(md|txt)$/i, '');
  return {
    title: [...basename].slice(0, 200).join(''),
    body,
    originalFilename: file.name,
    normalizedLineEndings: original !== body,
  };
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): void {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes).buffer], { type: mime }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Leave time for browsers to start their download before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadMarkdown(note: { title: string; body: string }): void {
  downloadBytes(
    markdownBytes(note.body),
    markdownFilename(note.title),
    'text/markdown;charset=utf-8',
  );
}
