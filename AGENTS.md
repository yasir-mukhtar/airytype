# AiryType project context

The approved writing-experience proof of concept and the subsequent local notebook are preserved. The notebook is a local development preview with tested cloud foundations; account integration and release gates remain open. Read `README.md` for setup, behavior decisions, validation, and known limits.

## Where to work

- `src/app/App.tsx`, `src/editor/`: current local notebook and editor.
- `src/storage/`, `src/sync/`: local journal and account write coordinator.
- `poc.html`, `src/poc-main.tsx`, `src/App.tsx`: preserved session-only approved POC.
- `src/writing.ts`: caret focus, sentence segmentation, and typewriter scrolling.
- `src/styles.css`: the light writing surface and responsive typography.
- `tests/writing.spec.ts`: browser interaction regression coverage.
- `Ulysses Reference/`: original design reference screenshots; preserve them.

## Behavior to preserve

- Plain Markdown is the canonical document. Visual focus must not rewrite source or break selection and undo/redo.
- Line focus means the actual wrapped visual row, not an entire source line.
- Typewriter scrolling follows writing intent. Navigation, manual scrolling, selection, and history must remain free.
- Keep geometry reads in CodeMirror's measure phase; avoid recreating the editor when React state changes.
- The approved baseline intentionally keeps text only in memory. Add persistence or broader application features only when the current task calls for them.

## Validation

Use `npm run check` for types, lint, unit/SQL tests and the production notebook build. Run current notebook interaction checks with `npm run test:editor` / `npm run test:e2e`; run the preserved POC checks with `npm run test:poc`; install the test browsers with `npx playwright install chromium webkit` when necessary. Native composition automation is Chromium-only. Other real operating-system input methods and mobile virtual keyboards remain manual verification work.
