# AiryType

A single-screen Markdown writing experiment: **Focus → Off / Line / Sentence** and **Position → Off / Top / Middle**. React, TypeScript, Vite, and CodeMirror 6. One locally bundled font family, Lora, on a light writing surface.

**Status: approved proof of concept.** This is the baseline for future AiryType work. Start with the behavior decisions and verification limits below before extending the writing experience.

## Run

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The sample is immediately editable. The document and mode choices live only in memory; refreshing restores the sample. There is no saving, persistence, backend, account system, or publishing feature.

```sh
npm run build
npx playwright install chromium webkit
npm test
```

## Implementation and behavior

- **One editor instance.** React renders the small interface and changes a CodeMirror state field. Typing does not round-trip through React. Markdown remains the canonical, unmodified source; syntax receives restrained prose styling, with all markup still editable.
- **Visual line focus.** CodeMirror measures the caret and its containing rendered line. A paint-only mask leaves the current wrapped row at full intensity and gently fades the rest. This does not insert spans into composing text, change font metrics, or rewrite source. Measurement runs in CodeMirror's layout-read phase; mask updates run in its write phase.
- **Sentence focus.** `Intl.Segmenter` uses the browser locale and only the current Markdown paragraph. Its segmentation is reused when navigating within unchanged text. Soft source newlines become spaces in the segmentation copy, preserving the exact UTF-16 offsets. Decorations fade the visible text outside the active sentence. Blank lines remain blank; headings and code fall back to their source line boundaries. Without `Intl.Segmenter`, the whole block stays focused.
- **Selection stays readable.** A nonempty selection suspends fading. Native selection, spellcheck, keyboard commands, and CodeMirror history remain in charge. Pointer mode changes preserve editor focus; keyboard mode changes preserve normal radio navigation.
- **Typing determines scrolling.** Only text input, Markdown Enter, paste, and deletion request the selected anchor. Top is 25% of the editor viewport; Middle is 50%. Arrow keys, Home/End, Page Up/Down, selection, undo/redo, clicks, and mode changes retain normal navigation behavior. Wheel, touch, pointer, and navigation input interrupt any pending correction.
- **Stable geometry.** All modes share enough top and bottom padding to let the first and last characters reach either anchor. Switching modes never changes padding or repositions the caret. Small typing corrections ease over 110 ms; a distant caret returns directly rather than animating through many pages. Reduced-motion preferences disable the easing.
- **Composition.** Fixed scrolling waits until composition commits. CodeMirror handles the input and history; AiryType does not prevent or replace composition events.

The implementation lives in `src/App.tsx`, `src/writing.ts`, and `src/styles.css`. Test fixture access is isolated in `tests/browser-driver.ts` and is absent from the production build.

## Reference study

The repository's Ulysses screenshots were inspected before interaction tuning, including **Fixed scrolling feature**, **Highlight options**, both **top** examples, both **mid** examples, **per sentence**, **Full screen**, **Full screen heading and body**, and **Light Mode New File**. The POC follows their narrow writing measure, stable typing position, and intensity-only focus, with a more readable surrounding-text fade and its own serif typography.

## Verification and limits

The completed suite passed **39 checks across Chromium and WebKit**, with one intentional WebKit skip for the Chromium-only native composition test. The TypeScript check and production build also pass.

Browser checks cover wrapped continuous typing; English and Indonesian punctuation; soft line breaks; headings, paragraphs, and blank lines; all nine mode combinations; manual scrolling far from the caret; clicks and dragged selections; Shift+arrow, arrows, Home/End, and Page Up/Down; paste; undo/redo; empty documents and both document ends; a roughly 180,000-character Markdown document; small screens; and 200% text enlargement. The long-document check also verifies that CodeMirror renders a bounded viewport rather than the whole document.

Native Japanese composition is exercised through Chromium's input protocol. WebKit runs the shared interaction suite, but real macOS/iOS/Android input methods and virtual keyboards still need hands-on testing. WebKit's keyboard test uses Option+Tab, as Safari does when full keyboard access is disabled.

Sentence boundaries inherit browser ICU behavior, including its occasional ambiguity around abbreviations and punctuation. Extremely large individual paragraphs and more writing systems deserve further evaluation. The font bundle and CodeMirror make the initial download larger than a plain textarea; the production JavaScript is roughly 250 KB compressed.

## Implications for the full app

Keep the editing document independent of React and future application state. Preserve the distinction between an edit's **intent** and a document change: history, navigation, and external updates should not automatically activate typewriter scrolling. Keep visual focus and layout measurement outside the Markdown data model. Any later document switching or persistence should preserve editor state and history rather than reconstructing the editor on every change. No infrastructure for those later features is included here.
