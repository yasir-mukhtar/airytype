// Fixture access only. This module is never imported by the application or built.
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

function view() { return EditorView.findFromDOM(document.querySelector('.cm-content')!)! }

export function replace(text: string, head = 0) {
  const editor = view()
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: head } })
  editor.focus()
  editor.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
}

export function select(head: number, anchor = head, scroll = true) {
  const editor = view()
  editor.dispatch({ selection: EditorSelection.single(anchor, head), ...(scroll ? { effects: EditorView.scrollIntoView(head, { y: 'center' }) } : {}) })
  editor.focus()
}

export function snapshot() {
  const editor = view(), head = editor.state.selection.main.head
  const caret = editor.coordsAtPos(head, editor.state.selection.main.assoc || 1)
  const viewport = editor.scrollDOM.getBoundingClientRect()
  const active = document.querySelector<HTMLElement>('[data-airy-line]')
  return {
    text: editor.state.doc.toString(), head, anchor: editor.state.selection.main.anchor,
    scrollTop: editor.scrollDOM.scrollTop, scrollHeight: editor.scrollDOM.scrollHeight,
    viewportTop: viewport.top, viewportHeight: editor.scrollDOM.clientHeight,
    caretY: caret ? (caret.top + caret.bottom) / 2 - viewport.top : null,
    activeLineText: active?.textContent,
    rowTop: active ? parseFloat(active.style.getPropertyValue('--row-top')) : null,
    rowBottom: active ? parseFloat(active.style.getPropertyValue('--row-bottom')) : null,
    lineHeight: active?.getBoundingClientRect().height,
    focus: editor.dom.dataset.focus, position: editor.dom.dataset.position,
    selection: editor.dom.dataset.selection,
    renderedLines: editor.contentDOM.querySelectorAll('.cm-line').length,
    composing: editor.composing,
  }
}

export function scroll(top: number) { view().scrollDOM.scrollTop = top }

export function point(pos: number) {
  const rect = view().coordsAtPos(pos)!
  return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
}

export function activeText() {
  const walker = document.createTreeWalker(view().contentDOM, NodeFilter.SHOW_TEXT)
  let result = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('.cm-focus-muted')) result += node.textContent
  }
  return result
}

export function paste(text: string) {
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  view().contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
}

export function nativeSelection() { return window.getSelection()?.toString() }
