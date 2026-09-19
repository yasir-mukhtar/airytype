import { describe, expect, it } from 'vitest';
import { searchNotes, searchTokens, snippet } from '../../src/app/search';
import type { NoteRecord } from '../../src/storage/types';

function note(
  id: string,
  title: string,
  body: string,
  updatedAt = 1,
): NoteRecord {
  return {
    id,
    title,
    body,
    updatedAt,
    accountId: 'test',
    folderId: null,
    kind: 'normal',
    writerId: 'test',
    generation: 1,
    baseVersion: null,
    createdAt: 1,
    deletedAt: null,
  };
}

describe('literal local search', () => {
  it('requires all tokens, preserves punctuation literally, and finds current draft text', () => {
    const notes = [
      note('a', 'Pagi', 'sentinel 100% _literal_'),
      note('b', 'Pagi', 'sentinel 100X something'),
    ];
    expect(
      searchNotes(notes, 'PAGI 100% _literal_').map((item) => item.id),
    ).toEqual(['a']);
    expect(searchNotes(notes, 'missing')).toEqual([]);
  });
  it('ranks all-title then some-title then body matches with deterministic ties', () => {
    const notes = [
      note('body', 'Other', 'quiet morning', 10),
      note('partial', 'Morning', 'quiet'),
      note('title-b', 'Quiet morning', ''),
      note('title-a', 'Quiet morning', ''),
    ];
    expect(searchNotes(notes, 'quiet morning').map((item) => item.id)).toEqual([
      'title-a',
      'title-b',
      'partial',
      'body',
    ]);
  });
  it('caps tokens at five, handles whitespace and does not interpret quotes or wildcards', () => {
    expect(searchTokens('  one\n two three four five six ')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
    expect(searchTokens('"quoted" % _')).toEqual(['"quoted"', '%', '_']);
  });
});

describe('note list previews', () => {
  it('uses body context instead of repeating the leading title, without changing the note', () => {
    const noteWithHeading = note(
      'a',
      'Morning pages',
      '\n# Morning pages #\n\nThe light moves across the desk.',
    );
    const before = structuredClone(noteWithHeading);
    expect(snippet(noteWithHeading.body, '', noteWithHeading.title)).toBe(
      'The light moves across the desk.',
    );
    expect(noteWithHeading).toEqual(before);
    expect(
      snippet('# A different thought\n\nMore words.', '', 'Morning pages'),
    ).toBe('A different thought More words.');
  });

  it('keeps literal source context when searching and leaves escaped and code headings alone', () => {
    const body = '# Morning pages\n\nThe light moves across the desk.';
    expect(snippet(body, '#', 'Morning pages')).toBe(
      '# Morning pages The light moves across the desk.',
    );
    expect(searchNotes([note('a', 'Morning pages', body)], '#')).toHaveLength(
      1,
    );
    expect(snippet('\\# A literal hash', '', 'A literal hash')).toBe(
      '\\# A literal hash',
    );
    expect(snippet('    # A code example', '', 'A code example')).toBe(
      '# A code example',
    );
    expect(snippet('# Morning pages\n', '', 'Morning pages')).toBe('');
  });
});
