import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
} from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { bracketMatching } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import {
  bodyByteCount,
  changedDocumentBytes,
  externalChange,
  MAX_BODY_BYTES,
  shouldRejectEdit,
} from './limits';
import {
  editorPreferences,
  writingInteractions,
  type CompositionSession,
} from './interactions';
import { editorTheme, markdownHighlighting } from './theme';
import { markdownPresentation } from './presentation';
import {
  defaultEditorPreferences,
  type EditorController,
  type EditorOptions,
} from './types';

export type {
  EditorOptions,
  EditorPreferences,
  EditorChange,
  FocusMode,
  ScrollMode,
  SentenceLanguage,
} from './types';
export type EditorHandle = EditorController;

/** The document lives in one EditorView. React receives changes without controlling its body. */
export function createEditor(options: EditorOptions): EditorController {
  let noteId = options.noteId;
  let preferences = { ...defaultEditorPreferences, ...options.preferences };
  let readOnly = options.readOnly ?? false;
  let destroyed = false;
  const composition: CompositionSession = { active: false };
  const appearance = new Compartment();
  const editable = new Compartment();
  const undoHistory = new Compartment();
  const cache = new Map<
    string,
    { state: EditorState; top: number; left: number }
  >();
  const readOnlyExtensions = (): Extension => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];

  const extensions: Extension = [
    bodyByteCount,
    appearance.of(editorPreferences.of(preferences)),
    editable.of(readOnlyExtensions()),
    undoHistory.of(history()),
    EditorView.lineWrapping,
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    bracketMatching(),
    markdown(),
    markdownHighlighting,
    markdownPresentation,
    search({ top: true }),
    keymap.of([
      ...markdownKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    placeholder('Start writing…'),
    editorTheme,
    EditorView.contentAttributes.of({
      'aria-label': 'Note content',
      'data-testid': 'note-editor',
      spellcheck: 'true',
      autocapitalize: 'sentences',
    }),
    writingInteractions(composition),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) return transaction;
      const beforeBytes = transaction.startState.field(bodyByteCount);
      const afterBytes = changedDocumentBytes(transaction, beforeBytes);
      if (
        !shouldRejectEdit({
          beforeBytes,
          afterBytes,
          composing:
            composition.active || transaction.isUserEvent('input.type.compose'),
          external: transaction.annotation(externalChange),
          history:
            transaction.isUserEvent('undo') || transaction.isUserEvent('redo'),
        })
      )
        return transaction;
      queueMicrotask(() => {
        if (!destroyed)
          options.onLimit?.(
            'This change exceeds the 1 MiB note limit. Nothing was inserted; your previous draft is intact.',
          );
      });
      return [];
    }),
    EditorView.updateListener.of((update) => {
      if (
        !update.docChanged ||
        update.transactions.every(
          (transaction) =>
            !transaction.docChanged || transaction.annotation(externalChange),
        )
      )
        return;
      const bytes = update.state.field(bodyByteCount);
      options.onChange({
        noteId,
        body: update.state.doc.toString(),
        bytes,
        overLimit: bytes > MAX_BODY_BYTES,
      });
      if (bytes > MAX_BODY_BYTES)
        options.onLimit?.(
          'Your complete draft is preserved locally and available to export. Reduce it below 1 MiB before cloud sync can resume.',
        );
    }),
  ];

  const freshState = (doc: string) => EditorState.create({ doc, extensions });
  const view = new EditorView({
    parent: options.parent,
    state: freshState(options.doc),
  });

  function reconfigure() {
    view.dispatch({
      effects: [
        appearance.reconfigure(editorPreferences.of(preferences)),
        editable.reconfigure(readOnlyExtensions()),
      ],
    });
  }

  return {
    view,
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    setPreferences(next) {
      preferences = { ...preferences, ...next };
      reconfigure();
    },
    openNote(note) {
      if (note.noteId === noteId) {
        readOnly = note.readOnly ?? false;
        reconfigure();
        return;
      }
      cache.delete(noteId);
      cache.set(noteId, {
        state: view.state,
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      });
      while (cache.size > 12) cache.delete(cache.keys().next().value!);
      noteId = note.noteId;
      readOnly = note.readOnly ?? false;
      const cached = cache.get(noteId);
      const state =
        cached && cached.state.doc.toString() === note.doc
          ? cached.state
          : freshState(note.doc);
      view.setState(
        state.update({
          effects: [
            appearance.reconfigure(editorPreferences.of(preferences)),
            editable.reconfigure(readOnlyExtensions()),
          ],
        }).state,
      );
      // Restoring the scroll snapshot must not move the caret or trigger anchoring.
      if (cached && state === cached.state) {
        view.scrollDOM.scrollTop = cached.top;
        view.scrollDOM.scrollLeft = cached.left;
      } else view.scrollDOM.scrollTop = 0;
    },
    replaceExternal(doc) {
      if (doc === view.state.doc.toString()) return;
      const position = Math.min(view.state.selection.main.head, doc.length);
      const scrollTop = view.scrollDOM.scrollTop;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: { anchor: position },
        effects: undoHistory.reconfigure([]),
        annotations: [
          externalChange.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
      // A clean authoritative replacement starts fresh history, so Undo cannot revert another device's edit.
      view.dispatch({
        effects: undoHistory.reconfigure(history()),
        annotations: Transaction.addToHistory.of(false),
      });
      view.scrollDOM.scrollTop = scrollTop;
    },
    setReadOnly(value) {
      readOnly = value;
      view.dispatch({ effects: editable.reconfigure(readOnlyExtensions()) });
    },
    undo: () => undo(view),
    redo: () => redo(view),
    find: () => openSearchPanel(view),
    destroy() {
      destroyed = true;
      cache.clear();
      view.destroy();
    },
  };
}
