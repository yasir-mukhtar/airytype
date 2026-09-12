# Editor boundary

`createEditor` creates one CodeMirror view. Its returned controller owns document memory, preferences, navigation, undo/redo, find, and exact current-text export. Configuration uses compartments; the shell should call `openNote` only for navigation and `replaceExternal` only when it has established the draft is clean. The editor cannot independently decide whether a remote update is safe.

`onChange` reports complete memory text and its exact UTF-8 byte count. Ordinary over-limit insertions are rejected in full. Composition-tagged input is preserved even above 1 MiB; the shell must keep that draft locally and pause cloud upload. Reductions and history remain available. External replacement clears obsolete undo; a bounded twelve-note session cache restores history, selection, and scroll when the source still matches.

Focus uses CodeMirror's public wrapped-row geometry and bounded `Intl.Segmenter` contexts. Dimming never changes font metrics. Mixed bidirectional rows temporarily disable the effect; code, tables, URLs, blank lines, unavailable segmentation, and prose blocks above 16,000 UTF-16 units use line fallback. The default surrounding text color, `#72716b`, has 4.73:1 contrast against the app's `#fcfbf9` surface.

Typing anchors use requestMeasure read/write phases and are canceled by wheel, pointer, and touch intent. Geometry-only updates wait for the next frame to avoid recursively restarting CodeMirror's layout loop. Neither ordinary navigation nor sidebar resizing requests a typing anchor. Focus decorations are deferred until measurement completes; composition retains the current decorations until commit.

Cosmetic focus transactions also wait for native input observers and require the DOM selection to agree with CodeMirror's selection. This guards against a discovered rapid-typing race where an asynchronous decoration update could synchronize an older caret while the browser was processing input. The nine-mode test asserts the entire resulting document and undo, including a sustained rapid-input burst.

Verification commands:

- `npx vitest run tests/editor/limits.test.ts tests/editor/sentence.test.ts`
- `npx playwright test --config tests/editor/playwright.config.ts`

The browser suite exercises all nine modes, visible-row geometry, selection suspension, typewriter anchors and wheel inspection, whole-paste rejection, external undo reset, note state restoration, first/last rows, and preservation of composition-tagged over-limit transactions. App integration tests check settings/layout and exact export/reload of persisted 100,000- and 500,000-character drafts. Their keyboard-to-two-animation-frame samples are exploratory development-build measurements, not production performance gate evidence.

Actual Safari, native OS IME, clipboard integration, dead keys, assistive technology, mixed-bidi geometry, and production-build performance remain manual/release checks. The composition-tagged transaction test does not claim native IME verification.
