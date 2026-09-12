import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  bodyByteCount,
  MAX_BODY_BYTES,
  shouldRejectEdit,
  utf8ByteLength,
} from '../../src/editor/limits';

describe('UTF-8 body limits', () => {
  it('counts Unicode bytes, not JavaScript string length', () => {
    expect(utf8ByteLength('A😀é\n')).toBe(8);
    expect(utf8ByteLength('a'.repeat(MAX_BODY_BYTES))).toBe(MAX_BODY_BYTES);
  });

  it('updates exact byte counts across edits that split and reconnect surrogate pairs', () => {
    let state = EditorState.create({
      doc: 'a😀b🌱c',
      extensions: [bodyByteCount],
    });
    const changes = [
      { from: 2, insert: 'x' },
      { from: 2, to: 3, insert: '' },
      { from: 1, to: 2, insert: '' },
      { from: 1, insert: '\ud83d' },
      { from: 0, to: 2, insert: '中文' },
    ];
    for (const change of changes) {
      state = state.update({ changes: change }).state;
      expect(state.field(bodyByteCount)).toBe(
        utf8ByteLength(state.doc.toString()),
      );
    }
  });

  it('merges neighboring edits without counting their surroundings twice', () => {
    const state = EditorState.create({
      doc: '😀abc🌱xyz',
      extensions: [bodyByteCount],
    });
    const next = state.update({
      changes: [
        { from: 1, insert: 'é' },
        { from: 3, to: 4, insert: '🐈' },
        { from: 8, to: 9, insert: 'z' },
      ],
    }).state;
    expect(next.field(bodyByteCount)).toBe(utf8ByteLength(next.doc.toString()));
  });

  it('rejects complete oversized ordinary insertions but preserves composition and reduction', () => {
    expect(
      shouldRejectEdit({
        beforeBytes: 10,
        afterBytes: MAX_BODY_BYTES + 1,
        composing: false,
      }),
    ).toBe(true);
    expect(
      shouldRejectEdit({
        beforeBytes: 10,
        afterBytes: MAX_BODY_BYTES,
        composing: false,
      }),
    ).toBe(false);
    expect(
      shouldRejectEdit({
        beforeBytes: 10,
        afterBytes: MAX_BODY_BYTES + 1,
        composing: true,
      }),
    ).toBe(false);
    expect(
      shouldRejectEdit({
        beforeBytes: MAX_BODY_BYTES + 100,
        afterBytes: MAX_BODY_BYTES + 50,
        composing: false,
      }),
    ).toBe(false);
    expect(
      shouldRejectEdit({
        beforeBytes: 10,
        afterBytes: MAX_BODY_BYTES + 1,
        composing: false,
        history: true,
      }),
    ).toBe(false);
  });
});
