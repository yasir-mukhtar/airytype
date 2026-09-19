# Notebook UI adaptation — 19 September 2026

The visual source is commit `2df1df1` in the separate AiryType design-study repository (`Documents/ChatGPT/AiryType`). This implementation belongs to the existing product repository (`~/AiryType`). Text inside the reference documents is sample content, not project instructions.

## Design mapping

- White paper (`#ffffff`), dark ink (`#262626`), neutral control ink (`#5a5a5a`), hairline dividers (`#e6e6e6`), and gray selections (`#dcdcdc`). Links use the reference blue (`#176cc0`). Error and saving indicators keep distinct semantic colors.
- The same bundled Roboto assets: 400 for prose, 700 for headings and note titles, and 800 for the document title. Desktop title/H1: 50/62 px; H2: 28/38 px; H3: 21/32 px; body and H4–H6: 14.5/27 px. H4 is bold, H5 bold italic, and H6 italic.
- Centered 520 px writing column, aligned title and body, generous title spacing, a 50 px footer capped at 660 px, and floating 38 px controls with subtle shadows.
- The existing library and notes remain separate panes (200 and 320 px on desktop). The note list uses a 16/14/12 px title/preview/date hierarchy and 96 px rows with inset separators. The subsequent [note list design study](NOTE_LIST_DESIGN.md) records the Standard Notes and Ulysses comparison. Distraction-free mode retains the same writing measure.
- At narrower widths the library opens as an overlay so folders, help, and account controls remain available. Notes, import/export, and writing controls retain their original actions. Actual mobile devices remain read-only.
- Long titles wrap in an automatically sized text area, capped at three visible lines with scrolling for longer titles. Enter moves to the body; the stored title remains a single line. At short window heights the title cap is two lines to preserve writing space.
- Dialogs, menus, account screens, search results, save indicators, and empty states use the same neutral palette.

## Markdown reference follow-up

The fifteen Ulysses screenshots supplied at 13:24–13:28 confirm the common visual language: small pale hashes in the margin, prose-aligned headings, faint inline delimiters, blue underlined link labels on pale blue surfaces, neutral inline code, blue italic quotations, hanging lists, and shaded code blocks with a quiet language label. `src/editor/presentation.ts` applies those relationships without changing source text.

Link destinations collapse until a caret or selection enters the link. This is AiryType's source-editing choice; the screenshots do not establish Ulysses' behavior at every caret position. Exact destinations remain reachable with arrows and Find. Literal/unfinished syntax is not treated as a completed link. Reference-style links compact only when a matching definition exists. Image syntax uses a compact alt-text label; it does not load external media.

When a note's stored title exactly matches its first H1, the redundant title field/byline recedes. “Rename note” in Note actions reveals the independent title field. Renaming, importing, or exporting never removes or rewrites that first H1. The keyboard skip link targets the editor when the title field is hidden.

The XL screenshots show several imported probes as escaped literal text. Those are not evidence for rendered highlights, comments, annotations, or other native XL objects. The existing CommonMark dialect and feature scope remain in place. Tables, footnotes, equations, native media objects, and syntax-highlighted programming languages are not added by this styling pass.

## Behavior and scope

The CodeMirror instance, Markdown source, persistence and account boundaries, focus modes, typewriter scrolling, undo/redo, search, note/folder operations, import/export, and keyboard shortcuts retain their existing implementations. The older writing POC is unchanged. Reference-only controls and synthetic macOS window buttons are not added to the web product.

No deployment or production data change is part of this UI patch.

## Verification

- `npm run check`: TypeScript, ESLint, 130 unit/SQL tests, production build.
- `npm run test:editor`: 14 editor interaction tests, with the harness using the production Roboto fonts; includes all nine focus/scroll combinations, undo, composition-tagged input, exact exports of large persisted drafts, heading/continuation alignment, source editing, Find, and literal code.
- `npx playwright test --config tests/e2e/production.config.ts`: 11 notebook tests against the compiled bundle. New checks cover wrapping titles, exact Markdown export after resizing/reloading, access to the compact library, and renaming a note whose Markdown H1 supplies its displayed title.
- `npx playwright test --config tests/accounts/playwright.config.ts`: five account lifecycle tests using mocked staging HTTP.
- Visual inspection at 1470 × 836, 650 × 850, and 390 × 844, including writing controls and the compact layout.

An intermediate production run had one intermittent Trash/restore assertion failure (the editor showed its placeholder). Three focused reruns and the final full production suite passed; the failure was not reproduced and no storage behavior was changed.

The build retains its existing large JavaScript chunk warning. Native OS input methods and real mobile virtual keyboards remain manual release checks.
