import type { Text } from '@codemirror/state';
import type { SentenceLanguage } from './types';

export const MAX_SENTENCE_CONTEXT = 16_000;
export interface SourceRange {
  from: number;
  to: number;
}
export type SentenceResult =
  | { kind: 'sentence'; range: SourceRange }
  | {
      kind: 'line';
      reason: 'empty' | 'code' | 'url' | 'table' | 'long-block' | 'unavailable';
    };

const isBoundary = (line: string) =>
  /^\s*(?:#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})/.test(line);
const isTable = (line: string) =>
  /^\s*\|.*\|\s*$/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*\|/.test(line);
const unsafeInline = /`+[^`]*`+|https?:\/\/[^\s<>]+|\]\([^\n)]*\)/g;

/** Bounded Markdown contexts prevent whole-note work on every caret movement. */
export function proseContext(
  doc: Text,
  position: number,
): SourceRange | SentenceResult {
  const line = doc.lineAt(Math.max(0, Math.min(position, doc.length)));
  if (!line.text.trim()) return { kind: 'line', reason: 'empty' };
  if (isTable(line.text)) return { kind: 'line', reason: 'table' };
  if (/^\s*(?:`{3,}|~{3,})/.test(line.text) || /^(?: {4}|\t)/.test(line.text))
    return { kind: 'line', reason: 'code' };
  let from = line.from;
  let to = line.to;
  if (!isBoundary(line.text)) {
    for (let n = line.number - 1; n >= 1; n--) {
      const previous = doc.line(n);
      if (
        !previous.text.trim() ||
        isBoundary(previous.text) ||
        isTable(previous.text)
      )
        break;
      from = previous.from;
      if (to - from > MAX_SENTENCE_CONTEXT)
        return { kind: 'line', reason: 'long-block' };
    }
    for (let n = line.number + 1; n <= doc.lines; n++) {
      const next = doc.line(n);
      if (!next.text.trim() || isBoundary(next.text) || isTable(next.text))
        break;
      to = next.to;
      if (to - from > MAX_SENTENCE_CONTEXT)
        return { kind: 'line', reason: 'long-block' };
    }
  }
  if (to - from > MAX_SENTENCE_CONTEXT)
    return { kind: 'line', reason: 'long-block' };
  return { from, to };
}

export class SentenceLocator {
  private cache?: {
    text: string;
    language: SentenceLanguage;
    segments: SourceRange[];
  };

  locate(
    doc: Text,
    position: number,
    language: SentenceLanguage,
    affinity = 1,
  ): SentenceResult {
    const context = proseContext(doc, position);
    if ('kind' in context) return context;
    if (typeof Intl.Segmenter !== 'function')
      return { kind: 'line', reason: 'unavailable' };
    const text = doc.sliceString(context.from, context.to);
    const localPosition = position - context.from;
    for (const match of text.matchAll(unsafeInline)) {
      if (
        localPosition >= match.index &&
        localPosition <= match.index + match[0].length
      ) {
        return {
          kind: 'line',
          reason: match[0].startsWith('`') ? 'code' : 'url',
        };
      }
    }
    if (this.cache?.text !== text || this.cache.language !== language) {
      const segmenter = new Intl.Segmenter(language, {
        granularity: 'sentence',
      });
      const segments = Array.from(
        segmenter.segment(text),
        ({ index, segment }) => ({ from: index, to: index + segment.length }),
      );
      this.cache = { text, language, segments };
    }
    const segments = this.cache.segments;
    const segment = segments.find(
      (range, index) =>
        localPosition >= range.from &&
        (localPosition < range.to ||
          (localPosition === range.to &&
            (affinity < 0 || index === segments.length - 1))),
    );
    return segment
      ? {
          kind: 'sentence',
          range: {
            from: context.from + segment.from,
            to: context.from + segment.to,
          },
        }
      : { kind: 'line', reason: 'empty' };
  }
}
