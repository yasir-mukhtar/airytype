# AiryType project context

The writing-experience proof of concept is approved. This repository is the baseline for future work. Read `README.md` for setup, behavior decisions, validation, and known limits.

## Where to work

- `src/App.tsx`: stable CodeMirror instance, Markdown styling, and mode controls.
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

Use `npm run build` for TypeScript and the production build. For interaction changes, run the relevant Playwright checks with `npm test`; install the test browsers with `npx playwright install chromium webkit` when necessary. Native composition automation is Chromium-only. Other real operating-system input methods and mobile virtual keyboards remain manual verification work.
