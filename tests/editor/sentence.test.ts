import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  MAX_SENTENCE_CONTEXT,
  SentenceLocator,
} from '../../src/editor/sentence';

const doc = (text: string) => Text.of(text.split('\n'));

describe('bounded Markdown sentence focus', () => {
  it('uses caret affinity at a shared boundary and the preceding sentence at document end', () => {
    const source = doc('First sentence. Second sentence.');
    const locator = new SentenceLocator();
    expect(locator.locate(source, 16, 'en', -1)).toEqual({
      kind: 'sentence',
      range: { from: 0, to: 16 },
    });
    expect(locator.locate(source, 16, 'en', 1)).toEqual({
      kind: 'sentence',
      range: { from: 16, to: 32 },
    });
    expect(locator.locate(source, 32, 'en')).toEqual({
      kind: 'sentence',
      range: { from: 16, to: 32 },
    });
  });

  it('keeps trailing whitespace with the previous sentence', () => {
    const source = doc('First.   Second.');
    expect(new SentenceLocator().locate(source, 7, 'en')).toEqual({
      kind: 'sentence',
      range: { from: 0, to: 9 },
    });
  });

  it('bounds context at headings, list items, quotes and blank lines', () => {
    const source = doc(
      '# Heading.\n\nBefore.\n\n- One item.\n- Another item.\n\n> A quotation.\n\nAfter.',
    );
    const locator = new SentenceLocator();
    const result = locator.locate(source, 31, 'en');
    expect(result.kind).toBe('sentence');
    if (result.kind === 'sentence')
      expect(source.sliceString(result.range.from, result.range.to)).toBe(
        '- One item.',
      );
    expect(locator.locate(source, 11, 'en')).toEqual({
      kind: 'line',
      reason: 'empty',
    });
  });

  it('falls back safely for inline code, URL destinations, tables and very large blocks', () => {
    const locator = new SentenceLocator();
    expect(locator.locate(doc('Use `a.b` here.'), 6, 'en')).toEqual({
      kind: 'line',
      reason: 'code',
    });
    expect(
      locator.locate(doc('Visit https://example.com/a.b today.'), 20, 'en'),
    ).toEqual({ kind: 'line', reason: 'url' });
    expect(
      locator.locate(doc('[A link](https://example.com) is here.'), 20, 'en'),
    ).toEqual({ kind: 'line', reason: 'url' });
    expect(locator.locate(doc('| A | B |'), 3, 'en')).toEqual({
      kind: 'line',
      reason: 'table',
    });
    expect(
      locator.locate(doc('a'.repeat(MAX_SENTENCE_CONTEXT + 1)), 10, 'en'),
    ).toEqual({ kind: 'line', reason: 'long-block' });
  });

  it.each([
    [
      'en',
      'Dr. Smith met Mr. Jones. The price was 3.14. “Really?” 😀 Yes… maybe.',
    ],
    ['id', 'Harga Rp. 10.000. Bawa buku, pena, dll. Besok menulis lagi, dsb.'],
    ['id', 'Menulis bersama. A mixed-language sentence! 👩🏽‍💻 Tetap utuh.'],
  ] as const)(
    'returns exact source ranges for %s punctuation fixtures',
    (language, text) => {
      const source = doc(text);
      const locator = new SentenceLocator();
      for (let position = 0; position <= text.length; position++) {
        const result = locator.locate(source, position, language);
        expect(result.kind).toBe('sentence');
        if (result.kind === 'sentence') {
          expect(result.range.from).toBeLessThanOrEqual(position);
          expect(result.range.to).toBeGreaterThanOrEqual(position);
          expect(source.sliceString(result.range.from, result.range.to)).toBe(
            text.slice(result.range.from, result.range.to),
          );
        }
      }
      expect(source.toString()).toBe(text);
    },
  );
});
