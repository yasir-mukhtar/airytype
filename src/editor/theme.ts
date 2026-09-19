import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const editorTheme = EditorView.theme({
  '&': {
    '--markdown-marker': '#d2d2d2',
    height: '100%',
    color: 'var(--editor-text, #262626)',
    backgroundColor: 'transparent',
    fontSize: '14.5px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'AiryRoboto, -apple-system, BlinkMacSystemFont, sans-serif',
    lineHeight: '27px',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'thin',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '592px',
    margin: '0 auto',
    padding: '24px 36px 160px',
    caretColor: 'var(--editor-text, #262626)',
    minHeight: '100%',
  },
  '.cm-line': { padding: '0' },
  '.cm-line.airy-heading': { color: '#262626', fontWeight: '700' },
  '.cm-line.airy-heading-1': {
    fontSize: '50px',
    lineHeight: '62px',
    fontWeight: '800',
    paddingBottom: '12px',
  },
  '.cm-line.airy-heading-2': {
    fontSize: '28px',
    lineHeight: '38px',
    paddingTop: '8px',
    paddingBottom: '8px',
  },
  '.cm-line.airy-heading-3': {
    fontSize: '21px',
    lineHeight: '32px',
    paddingTop: '6px',
    paddingBottom: '6px',
  },
  '.cm-line.airy-heading-4': {
    fontSize: '14.5px',
    lineHeight: '27px',
    paddingTop: '5px',
    paddingBottom: '5px',
  },
  '.cm-line.airy-heading-5': {
    fontSize: '14.5px',
    lineHeight: '27px',
    fontStyle: 'italic',
    paddingTop: '5px',
    paddingBottom: '5px',
  },
  '.cm-line.airy-heading-6': {
    fontSize: '14.5px',
    lineHeight: '27px',
    fontWeight: '400',
    fontStyle: 'italic',
    paddingTop: '5px',
    paddingBottom: '5px',
  },
  '.airy-md-marker, .airy-md-marker *': {
    color: 'var(--markdown-marker)',
    fontWeight: '400',
    fontStyle: 'normal',
    textDecoration: 'none',
  },
  '.airy-heading-marker': {
    display: 'inline-block',
    width: 'var(--marker-width)',
    marginLeft: 'calc(-1 * var(--marker-width))',
    fontSize: '11px',
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    lineHeight: '1',
    whiteSpace: 'pre',
    textAlign: 'right',
  },
  '.airy-link-label': {
    color: 'var(--link, #176cc0)',
    backgroundColor: 'var(--link-surface, #ebf4fe)',
    borderRadius: '2px',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '.airy-link-label .airy-inline-code': {
    color: 'inherit',
    backgroundColor: 'transparent',
  },
  '.airy-link-source, .airy-link-source *': {
    color: '#949494',
    textDecoration: 'none',
  },
  '.airy-image-label::before': {
    content: '"img "',
    fontSize: '10px',
    color: '#949494',
  },
  '.airy-inline-code': {
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    fontStyle: 'normal',
    fontSize: '0.9em',
    color: '#333333',
    backgroundColor: '#f5f5f5',
    padding: '2px 0',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '.cm-line.airy-hanging-line': {
    paddingLeft: 'var(--prefix-width)',
    textIndent: 'calc(-1 * var(--prefix-width))',
  },
  '.airy-block-prefix': {
    display: 'inline-block',
    width: 'var(--prefix-width)',
    textIndent: '0',
    whiteSpace: 'pre',
  },
  '.airy-list-prefix': { textAlign: 'right', color: '#707070' },
  '.cm-line.airy-quote': {
    color: 'var(--link, #176cc0)',
    fontSize: '21px',
    lineHeight: '33px',
    fontStyle: 'italic',
  },
  '.airy-quote .airy-block-prefix': { fontSize: '14.5px' },
  '.cm-line.airy-code-block': {
    backgroundColor: '#f5f5f5',
    color: '#333333',
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    fontStyle: 'normal',
    fontSize: '13px',
    lineHeight: '20px',
    paddingLeft: '8px',
    paddingRight: '8px',
  },
  '.cm-line.airy-code-first': {
    borderTopLeftRadius: '5px',
    borderTopRightRadius: '5px',
    paddingTop: '5px',
  },
  '.cm-line.airy-code-last': {
    borderBottomLeftRadius: '5px',
    borderBottomRightRadius: '5px',
    paddingBottom: '5px',
  },
  '.cm-line.airy-code-fence': {
    color: '#aaaaaa',
    fontFamily: 'inherit',
    fontSize: '10px',
    lineHeight: '12px',
    textAlign: 'right',
  },
  '.cm-line.airy-code-fence-active': {
    color: '#949494',
    textAlign: 'left',
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
  },
  '.cm-line.airy-rule': { color: '#cccccc' },
  '.cm-line.airy-reference': { color: '#949494', fontSize: '12px' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--editor-text, #262626)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--editor-selection, #dedede)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--link-surface, #ebf4fe)' },
  '.cm-searchMatch': {
    backgroundColor: '#ffe394',
    outline: '1px solid #d0a633',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ffc449' },
  '.cm-placeholder': { color: '#707070' },
  '.airy-focus-muted, .airy-focus-muted *': {
    color: 'var(--editor-muted, #727272) !important',
  },
  '.airy-focus-muted .airy-md-marker, .airy-md-marker .airy-focus-muted, .airy-md-marker.airy-focus-muted, .airy-focus-muted .airy-md-marker *':
    {
      color: 'var(--markdown-marker) !important',
    },
  '.cm-panels': {
    background: 'var(--surface, #ffffff)',
    color: '#262626',
    fontSize: '13px',
  },
  '.cm-panels-top': { borderBottom: '1px solid #e6e6e6' },
  '.cm-search': { padding: '12px 18px !important' },
  '.cm-textfield': {
    border: '1px solid #dcdcdc',
    borderRadius: '4px',
    padding: '5px 8px',
    background: '#ffffff',
    color: '#262626',
  },
  '.cm-button': {
    background: '#f3f3f3',
    color: '#262626',
    border: '1px solid #dcdcdc',
    borderRadius: '4px',
    textTransform: 'none',
  },
  '@media (max-width: 700px)': {
    '.cm-content': { paddingLeft: '22px', paddingRight: '22px' },
    '.cm-line.airy-heading-1': { fontSize: '38px', lineHeight: '48px' },
    '.cm-line.airy-heading-2': { fontSize: '25px', lineHeight: '34px' },
    '.airy-heading-marker': { fontSize: '9px' },
  },
  '@media (forced-colors: active)': {
    '&': { '--markdown-marker': 'GrayText' },
    '.airy-focus-muted, .airy-focus-muted *': {
      color: 'CanvasText !important',
    },
    '.cm-cursor': { borderLeftColor: 'CanvasText' },
    '.airy-md-marker, .airy-md-marker *': { color: 'GrayText' },
  },
});

export const markdownHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: tags.heading,
      color: '#262626',
    },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    {
      tag: tags.monospace,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
    },
    {
      tag: [tags.character, tags.tagName, tags.angleBracket],
      color: '#4e8657',
    },
  ]),
);
