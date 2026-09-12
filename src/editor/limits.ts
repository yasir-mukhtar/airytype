import { Annotation, StateField, type Transaction } from '@codemirror/state';

export const MAX_BODY_BYTES = 1024 * 1024;
export const externalChange = Annotation.define<boolean>();
const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Include adjacent UTF-16 units so edits that split/join surrogate pairs remain exact. */
export function changedDocumentBytes(
  transaction: Transaction,
  previousBytes: number,
): number {
  if (!transaction.docChanged) return previousBytes;
  const oldDoc = transaction.startState.doc;
  const newDoc = transaction.newDoc;
  const ranges: { from: number; to: number }[] = [];
  transaction.changes.iterChangedRanges((from, to) => {
    const range = {
      from: Math.max(0, from - 1),
      to: Math.min(oldDoc.length, to + 1),
    };
    const previous = ranges.at(-1);
    if (previous && range.from <= previous.to)
      previous.to = Math.max(previous.to, range.to);
    else ranges.push(range);
  });
  let bytes = previousBytes;
  for (const range of ranges) {
    const newFrom = transaction.changes.mapPos(range.from, -1);
    const newTo = transaction.changes.mapPos(range.to, 1);
    bytes -= utf8ByteLength(oldDoc.sliceString(range.from, range.to));
    bytes += utf8ByteLength(newDoc.sliceString(newFrom, newTo));
  }
  return bytes;
}

export const bodyByteCount = StateField.define<number>({
  create: (state) => utf8ByteLength(state.doc.toString()),
  update: (bytes, transaction) => changedDocumentBytes(transaction, bytes),
});

export function shouldRejectEdit(options: {
  beforeBytes: number;
  afterBytes: number;
  composing: boolean;
  external?: boolean;
  history?: boolean;
}): boolean {
  if (options.composing || options.external || options.history) return false;
  return (
    options.afterBytes > MAX_BODY_BYTES &&
    options.afterBytes >= options.beforeBytes
  );
}
