import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildLibraryArchive,
  importMarkdown,
  markdownBytes,
  markdownFilename,
  safeFilenamePart,
  utf8ByteLength,
} from '../../src/export';
import type { NoteRecord } from '../../src/storage/types';

function file(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}
function note(
  id: string,
  title: string,
  body: string,
  folderId: string | null = null,
): NoteRecord {
  return {
    accountId: 'local',
    id,
    title,
    body,
    folderId,
    kind: 'normal',
    writerId: 'writer',
    generation: 42,
    baseVersion: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

describe('Markdown portability', () => {
  it('exports exact draft whitespace, syntax and Unicode without a synthetic heading', () => {
    const body = '\n  # A real heading  \n\n**bold** Cafe\u0301 👩🏽‍💻\n\n';
    expect(new TextDecoder().decode(markdownBytes(body))).toBe(body);
  });

  it('validates UTF-8 and NUL before creating any note', async () => {
    await expect(
      importMarkdown(file('bad.md', new Uint8Array([0xc3, 0x28]))),
    ).rejects.toThrow('UTF-8');
    await expect(
      importMarkdown(file('bad.md', new TextEncoder().encode('hello\0world'))),
    ).rejects.toThrow('NUL');
    await expect(
      importMarkdown(file('bad.html', new TextEncoder().encode('text'))),
    ).rejects.toThrow('.md or .txt');
  });

  it('normalizes CRLF and CR to LF and preserves the rest of imported text', async () => {
    const imported = await importMarkdown(
      file(
        'Original title.md',
        new TextEncoder().encode('  prose  \r\n\r\nemoji 🙂\rnext'),
      ),
    );
    expect(imported).toMatchObject({
      title: 'Original title',
      body: '  prose  \n\nemoji 🙂\nnext',
      normalizedLineEndings: true,
    });
  });

  it('preserves leading U+FEFF and Unicode text through a plain Markdown round trip', async () => {
    const body = '\ufeff# A source heading\n\nCafe\u0301 🙂\n';
    const imported = await importMarkdown(
      file('Round trip.md', markdownBytes(body)),
    );
    expect(imported.body).toBe(body);
  });

  it('enforces bytes rather than UTF-16 length at the limit', async () => {
    await expect(
      importMarkdown(
        file('limit.md', new TextEncoder().encode('🙂'.repeat(262145))),
      ),
    ).rejects.toThrow('1 MiB');
  });

  it('sanitizes traversal, reserved names and platform-specific filename characters', () => {
    for (const title of [
      '../../secret',
      'CON',
      'nul.md',
      'a/b\\c:d*e?f"g<h>i|',
      '...',
      'name. ',
    ]) {
      const name = safeFilenamePart(title);
      expect(name).not.toMatch(/[<>:"/\\|?*]/);
      expect(name).not.toMatch(/[. ]$/);
      expect(name).not.toMatch(/^(con|nul)(\.|$)/i);
    }
    expect(markdownFilename('')).toBe('Untitled.md');
    expect(utf8ByteLength(markdownFilename('🙂'.repeat(200)))).toBeLessThan(
      255,
    );
  });

  it('exports pinned exact bodies with distinct case-insensitive paths and an honest manifest', () => {
    const source = [
      note('one', 'Same', 'sentinel A'),
      note('two', 'same', 'sentinel B'),
      note('three', '../../CON', 'sentinel C'),
    ];
    const { bytes, manifest } = buildLibraryArchive(source, [], {
      capturedAt: new Date('2026-09-12T06:30:00Z'),
    });
    source[0].body = 'newer typing after capture';
    source.push(note('later', 'Later note', 'not a member'));
    const archive = unzipSync(bytes);
    expect(manifest.notes).toHaveLength(3);
    expect(
      new Set(manifest.notes.map((entry) => entry.path.toLowerCase())).size,
    ).toBe(3);
    expect(
      strFromU8(
        archive[manifest.notes.find((entry) => entry.id === 'one')!.path],
      ),
    ).toBe('sentinel A');
    expect(manifest.completeFor).toBe('captured-local-library');
    expect(manifest.notes.every((entry) => entry.includesLocalDraft)).toBe(
      true,
    );
    expect(archive['manifest.json']).toBeDefined();
  });

  it('uses safe nested folder paths, root fallback and explicitly selected Trash inclusion', () => {
    const folder = {
      accountId: 'local',
      id: 'folder',
      name: '../Writing',
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const active = note('a', 'A', 'folder body', folder.id);
    const missing = note('b', 'B', 'root fallback', 'missing');
    const trashed = { ...note('c', 'C', 'trash body'), deletedAt: 1 };
    const normal = buildLibraryArchive([active, missing, trashed], [folder]);
    expect(normal.manifest.notes).toHaveLength(2);
    expect(normal.manifest.notes[0].path).not.toContain('..');
    expect(normal.manifest.notes[1].path).toBe('B.md');
    expect(
      buildLibraryArchive([trashed], [], { includeTrash: true }).manifest.notes,
    ).toHaveLength(1);
  });

  it('reserves the manifest path when a user folder has the same name', () => {
    const folder = {
      accountId: 'local',
      id: 'folder',
      name: 'manifest.json',
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const { bytes, manifest } = buildLibraryArchive(
      [note('n', 'Writing', 'text', folder.id)],
      [folder],
    );
    expect(manifest.folders[0].path).not.toBe('manifest.json');
    expect(unzipSync(bytes)['manifest.json']).toBeDefined();
  });
});
