import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

export type FocusMode = 'off' | 'line' | 'sentence'
export type PositionMode = 'off' | 'top' | 'middle'
type Modes = { focus: FocusMode; position: PositionMode }
export const setModes = StateEffect.define<Partial<Modes>>()
const modes = StateField.define<Modes>({
  create: () => ({ focus: 'off', position: 'off' }),
  update: (value, tr) => tr.effects.reduce((current, effect) => effect.is(setModes) ? { ...current, ...effect.value } : current, value),
})

// Segment only the current Markdown block, and reuse it during caret navigation.
// Intl's offsets, like CodeMirror's, are UTF-16 offsets into the original source.
class SentenceFinder {
  private segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null
  private text = ''
  private segments: Intl.Segments | null = null

  at(state: EditorState) {
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    if (!line.text.trim()) return { from: head, to: head }
    let from = line.from, to = line.to
    for (let node = syntaxTree(state).resolveInner(head, head === line.to ? -1 : 1); node.parent; node = node.parent) {
      if (node.name === 'Paragraph') { from = node.from; to = node.to; break }
      if (/Heading|CodeBlock|FencedCode|HorizontalRule/.test(node.name)) break
    }
    const text = state.sliceDoc(from, to)
    if (text !== this.text) {
      this.text = text
      // A soft Markdown newline is prose whitespace, not a sentence boundary.
      // Replacing it with one space keeps every source offset identical.
      this.segments = this.segmenter?.segment(text.replace(/\n/g, ' ')) ?? null
    }
    const sentence = this.segments?.containing(Math.max(0, Math.min(head - from, text.length - 1)))
    // Older browsers get a whole-block focus; no guessed punctuation rules.
    return sentence ? { from: from + sentence.index, to: from + sentence.index + sentence.segment.length } : { from, to }
  }
}

const muted = Decoration.mark({ class: 'cm-focus-muted' })
const focusPaint = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  private sentences = new SentenceFinder()
  private activeLine: HTMLElement | null = null

  constructor(readonly view: EditorView) { this.refresh(); this.measureLine() }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged ||
      update.startState.field(modes) !== update.state.field(modes) ||
      syntaxTree(update.startState) !== syntaxTree(update.state)) this.refresh()
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged ||
      update.startState.field(modes) !== update.state.field(modes)) this.measureLine()
  }

  docViewUpdate() { this.measureLine() }

  private refresh() {
    const { state } = this.view
    if (state.field(modes).focus !== 'sentence' || !state.selection.main.empty) {
      this.decorations = Decoration.none
      return
    }
    const active = this.sentences.at(state)
    const ranges = []
    for (const { from, to } of this.view.visibleRanges) {
      if (from < Math.min(to, active.from)) ranges.push(muted.range(from, Math.min(to, active.from)))
      if (Math.max(from, active.to) < to) ranges.push(muted.range(Math.max(from, active.to), to))
    }
    this.decorations = Decoration.set(ranges, true)
  }

  private measureLine() {
    this.view.requestMeasure({
      key: this,
      read: view => {
        if (view.state.field(modes).focus !== 'line' || !view.state.selection.main.empty) return null
        const caret = view.state.selection.main
        const rect = view.coordsAtPos(caret.head, caret.assoc || 1)
        if (!rect) return null
        const { node } = view.domAtPos(caret.head)
        const line = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.cm-line')
        if (!line) return null
        const box = line.getBoundingClientRect()
        const top = Math.max(0, rect.top - box.top - 2)
        const bottom = Math.min(box.height, rect.bottom - box.top + 2)
        return { line, top, bottom }
      },
      write: result => {
        if (this.activeLine !== result?.line) this.clearLine()
        if (!result) return
        this.activeLine = result.line
        // Paint a window in the actual wrapped row. No text nodes, document
        // ranges, font metrics, or composition spans change for line focus.
        result.line.setAttribute('data-airy-line', '')
        result.line.style.setProperty('--row-top', `${result.top}px`)
        result.line.style.setProperty('--row-bottom', `${result.bottom}px`)
      },
    })
  }

  private clearLine() {
    this.activeLine?.removeAttribute('data-airy-line')
    this.activeLine?.style.removeProperty('--row-top')
    this.activeLine?.style.removeProperty('--row-bottom')
    this.activeLine = null
  }

  destroy() { this.clearLine() }
}, { decorations: plugin => plugin.decorations })

function isWriting(tr: Transaction) {
  return tr.docChanged && tr.newSelection.main.empty &&
    // Markdown's Enter command uses the exact root event "input".
    (tr.annotation(Transaction.userEvent) === 'input' || tr.isUserEvent('input.type') || tr.isUserEvent('input.paste') ||
      tr.isUserEvent('input.complete') || tr.isUserEvent('input.indent') || tr.isUserEvent('delete'))
}

const typewriter = ViewPlugin.fromClass(class {
  pending = false
  private suppressNative = false
  private frame = 0
  private compositionFrame = 0
  private target: number | null = null
  private composing = false
  private compositionEdited = false
  private generation = 0

  constructor(readonly view: EditorView) {
    view.scrollDOM.addEventListener('wheel', this.interrupt, { passive: true })
    view.scrollDOM.addEventListener('touchstart', this.interrupt, { passive: true })
    view.scrollDOM.addEventListener('pointerdown', this.interrupt, { passive: true })
    view.dom.addEventListener('keydown', this.onKey)
    view.contentDOM.addEventListener('compositionstart', this.onCompositionStart)
    view.contentDOM.addEventListener('compositionend', this.onCompositionEnd)
    view.contentDOM.addEventListener('blur', this.interrupt)
    window.addEventListener('resize', this.interrupt)
  }

  update(update: ViewUpdate) {
    if (update.startState.field(modes).position !== update.state.field(modes).position) this.interrupt()
    if (update.transactions.some(isWriting) && update.state.field(modes).position !== 'off') {
      if (this.composing || this.view.composing) this.compositionEdited = true
      else { this.pending = true; this.suppressNative = true; this.measureTarget() }
    } else if (update.selectionSet || update.docChanged) { this.interrupt(); this.suppressNative = false }
  }

  private stopAnimation() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.target = null
  }

  private interrupt = () => {
    this.pending = false
    this.compositionEdited = false
    this.generation++
    this.stopAnimation()
  }

  private onKey = (event: KeyboardEvent) => {
    if (/^(Arrow|Home$|End$|Page|Escape$|Tab$)/.test(event.key) || event.metaKey || event.ctrlKey) this.interrupt()
  }

  private onCompositionStart = () => { this.interrupt(); this.composing = true }
  private onCompositionEnd = () => {
    this.composing = false
    const generation = this.generation
    cancelAnimationFrame(this.compositionFrame)
    this.compositionFrame = requestAnimationFrame(() => {
      if (generation !== this.generation || !this.compositionEdited || !this.view.hasFocus ||
        !this.view.state.selection.main.empty || this.view.state.field(modes).position === 'off') return
      this.compositionEdited = false
      this.pending = true
      this.suppressNative = true
      this.measureTarget()
      this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main) })
    })
  }

  scroll() {
    // CodeMirror calls this in its write phase. Geometry belongs exclusively
    // in requestMeasure's read phase, including when a distant caret renders.
    const suppress = this.suppressNative
    this.suppressNative = false
    return suppress
  }

  private measureTarget() {
    this.view.requestMeasure({
      key: this,
      read: view => {
        const mode = view.state.field(modes).position
        if (!this.pending || this.composing || view.composing || mode === 'off' || !view.hasFocus) return null
        const caret = view.coordsAtPos(view.state.selection.main.head, view.state.selection.main.assoc || 1)
        if (!caret) return null
        const { scrollDOM } = view
        const viewport = scrollDOM.getBoundingClientRect()
        const height = scrollDOM.clientHeight
        const delta = (caret.top + caret.bottom) / 2 - viewport.top - height * (mode === 'top' ? .25 : .5)
        const target = Math.max(0, Math.min(scrollDOM.scrollHeight - height, scrollDOM.scrollTop + delta))
        return { delta, target, height, from: scrollDOM.scrollTop }
      },
      write: result => { if (result && this.pending) { this.pending = false; this.applyScroll(result) } },
    })
  }

  private applyScroll({ delta, target, height, from }: { delta: number; target: number; height: number; from: number }) {
    const { scrollDOM } = this.view
    if (this.target !== null && Math.abs(this.target - target) < 1) return true
    this.stopAnimation()
    if (Math.abs(delta) < 1) return true
    // Large jumps return directly to the writing point. Short corrections ease
    // for 110 ms, never queuing animations behind continued typing.
    if (Math.abs(delta) > height * .75 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scrollDOM.scrollTop = target
      return true
    }
    const start = performance.now()
    this.target = target
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 110)
      scrollDOM.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3)
      if (progress < 1) this.frame = requestAnimationFrame(step)
      else { this.frame = 0; this.target = null }
    }
    this.frame = requestAnimationFrame(step)
    return true
  }

  destroy() {
    this.stopAnimation()
    cancelAnimationFrame(this.compositionFrame)
    this.view.scrollDOM.removeEventListener('wheel', this.interrupt)
    this.view.scrollDOM.removeEventListener('touchstart', this.interrupt)
    this.view.scrollDOM.removeEventListener('pointerdown', this.interrupt)
    this.view.dom.removeEventListener('keydown', this.onKey)
    this.view.contentDOM.removeEventListener('compositionstart', this.onCompositionStart)
    this.view.contentDOM.removeEventListener('compositionend', this.onCompositionEnd)
    this.view.contentDOM.removeEventListener('blur', this.interrupt)
    window.removeEventListener('resize', this.interrupt)
  }
})

export const writingExperience = [
  modes, focusPaint, typewriter,
  EditorView.editorAttributes.of(view => ({
    'data-focus': view.state.field(modes).focus,
    'data-selection': view.state.selection.main.empty ? 'caret' : 'range',
    'data-position': view.state.field(modes).position,
  })),
  EditorState.transactionExtender.of(tr => isWriting(tr) && tr.state.field(modes).position !== 'off'
    ? { effects: EditorView.scrollIntoView(tr.newSelection.main) } : null),
  EditorView.scrollHandler.of(view => view.plugin(typewriter)?.scroll() ?? false),
  EditorView.scrollMargins.of(() => ({ top: 24, bottom: 28 })),
]
