import { describe, expect, it } from 'vitest';
import { searchNotes, searchTokens } from '../../src/app/search';
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
