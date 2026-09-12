import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--editor-text, #343431)',
    backgroundColor: 'transparent',
    fontSize: '20px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    lineHeight: '1.75',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'thin',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '760px',
    margin: '0 auto',
    padding: '24px 36px 160px',
    caretColor: 'var(--editor-text, #343431)',
    minHeight: '100%',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--editor-text, #343431)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--editor-selection, #dedbcf)' },
  '.cm-selectionMatch': { backgroundColor: '#ece5c8' },
  '.cm-searchMatch': {
    backgroundColor: '#f1e4b4',
    outline: '1px solid #dcc56c',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e6d088' },
  '.cm-placeholder': { color: '#77766f' },
  '.airy-focus-muted, .airy-focus-muted *': {
    color: 'var(--editor-muted, #72716b) !important',
  },
  '.cm-panels': {
    background: 'var(--surface, #faf9f6)',
    color: '#343431',
    fontSize: '13px',
  },
  '.cm-panels-top': { borderBottom: '1px solid #e5e3dc' },
  '.cm-search': { padding: '12px 18px !important' },
  '.cm-textfield': {
    border: '1px solid #d5d3ca',
    borderRadius: '4px',
    padding: '5px 8px',
    background: '#fffefa',
    color: '#343431',
  },
  '.cm-button': {
    background: '#eeece5',
    color: '#343431',
    border: '1px solid #d5d3ca',
    borderRadius: '4px',
    textTransform: 'none',
  },
  '@media (max-width: 700px)': {
    '.cm-content': { paddingLeft: '22px', paddingRight: '22px' },
  },
  '@media (forced-colors: active)': {
    '.airy-focus-muted, .airy-focus-muted *': {
      color: 'CanvasText !important',
    },
    '.cm-cursor': { borderLeftColor: 'CanvasText' },
  },
});

export const markdownHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: '#30322d', fontWeight: '650' },
    { tag: tags.strong, fontWeight: '650' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    {
      tag: [tags.link, tags.url],
      color: '#536b57',
      textDecoration: 'underline',
      textUnderlineOffset: '3px',
    },
    { tag: [tags.processingInstruction, tags.meta], color: '#737368' },
    { tag: [tags.monospace, tags.escape], color: '#805641' },
    { tag: tags.quote, color: '#696b5d' },
  ]),
);
