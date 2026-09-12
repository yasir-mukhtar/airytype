import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { sample } from './sample'
import { setModes, writingExperience, type FocusMode, type PositionMode } from './writing'

const proseHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'prose-h1' },
  { tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'prose-heading' },
  { tag: tags.strong, class: 'prose-strong' },
  { tag: tags.emphasis, class: 'prose-emphasis' },
  { tag: [tags.processingInstruction, tags.meta], class: 'prose-mark' },
  { tag: tags.link, class: 'prose-link' },
  { tag: tags.url, class: 'prose-url' },
])

function ModePicker<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly T[]; onChange: (value: T) => void
}) {
  const pointerChoice = useRef(false)
  return <div className="mode-picker" role="group" aria-labelledby={`${label}-label`}>
    <span className="mode-label" id={`${label}-label`}>{label}</span>
    <div className="mode-options"
      onPointerDown={event => { pointerChoice.current = true; event.preventDefault() }}
      onPointerCancel={() => { pointerChoice.current = false }}
      onKeyDown={() => { pointerChoice.current = false }}>
      {options.map(option => <label className="mode-option" key={option} onClick={event => {
        // Pointer choices preserve the writing caret; keyboard choices retain
        // normal radio focus and arrow-key behavior.
        if (pointerChoice.current) { pointerChoice.current = false; event.preventDefault(); onChange(option) }
      }}>
        <input type="radio" name={label} value={option} checked={option === value} onChange={() => onChange(option)} />
        <span>{option[0].toUpperCase() + option.slice(1)}</span>
      </label>)}
    </div>
  </div>
}

export function App() {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const [focus, setFocus] = useState<FocusMode>('off')
  const [position, setPosition] = useState<PositionMode>('off')

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: sample,
        selection: { anchor: sample.indexOf('Give them a little room.') },
        extensions: [
          history(), markdown(),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(proseHighlight),
          EditorView.lineWrapping, writingExperience,
          EditorView.contentAttributes.of({ 'aria-label': 'Writing area', spellcheck: 'true', autocapitalize: 'sentences' }),
        ],
      }),
    })
    editor.current = view
    // Keep ample padding in every mode, so changing modes never moves text.
    // Only initial presentation uses this comfortable reading inset.
    view.requestMeasure({
      read: () => ({ height: view.scrollDOM.clientHeight, inset: window.innerWidth <= 650 ? 38 : 70 }),
      write: ({ height, inset }) => { view.scrollDOM.scrollTop = Math.max(0, height / 2 - inset) },
    })
    view.focus()
    return () => { editor.current = null; view.destroy() }
  }, [])

  function changeFocus(value: FocusMode) {
    setFocus(value)
    editor.current?.dispatch({ effects: setModes.of({ focus: value }) })
  }

  function changePosition(value: PositionMode) {
    setPosition(value)
    editor.current?.dispatch({ effects: setModes.of({ position: value }) })
  }

  return <div className="app">
    <header className="masthead">
      <div className="wordmark">AiryType<span aria-hidden="true">·</span></div>
      <span className="session-note" title="This is a temporary writing session. Refreshing the page resets the text.">Just this session</span>
    </header>
    <main className="writing-surface" aria-label="Markdown editor">
      <div className="editor-host" ref={host} />
    </main>
    <footer className="controls">
      <ModePicker label="Focus" value={focus} options={['off', 'line', 'sentence']} onChange={changeFocus} />
      <span className="control-divider" aria-hidden="true" />
      <ModePicker label="Position" value={position} options={['off', 'top', 'middle']} onChange={changePosition} />
    </footer>
  </div>
}
