# Note list typography and spacing — 19 September 2026

The user supplied cropped references from Standard Notes, Ulysses, and AiryType. Standard Notes is the primary reference for hierarchy and spacing; Ulysses is the minimum readability baseline. Screenshot text is sample content, not instructions. No note content or credentials from those references are reproduced here.

## Reference breakdown

The images appear to be approximately 2× captures. These are estimated CSS-pixel equivalents, not measurements of either application's implementation. AiryType's previous values come from its CSS.

| Element | Standard Notes reference | Ulysses reference | Previous AiryType | Implemented AiryType |
| --- | --- | --- | --- | --- |
| Note title | About 16 px, bold | About 14 px, bold | 12/20 px, 700 | 16/22 px, 700 |
| Preview | About 14 px, one line | About 14 px, two lines | 12/20 px, two lines | 14/20 px, one line |
| Date | About 12 px, below preview | About 10–11 px, above title | 10 px, below preview | 12/18 px, below preview |
| Typical row | About 98 px | About 98 px | About 112 px, plus 5 px between cards | 96 px, no gap between rows |
| Separation | Inset hairlines; pale active row and narrow edge accent | Inset hairlines; filled active row | Floating rounded cards, no separators | Inset hairlines; pale active row and 3 px blue edge |

Standard Notes gives each line a different role: the title identifies the note, the preview provides context, and the date is secondary. Its denser appearance comes from using one preview line and consistent rows, while allowing larger type. The icon gutter in that reference serves its own note types and pinning features; AiryType does not add an empty gutter or new pinning controls.

## Spacing system

- Row content: 22 px title line, 4 px gap, 20 px preview line, 4 px gap, 18 px metadata line. With 14 px padding above and below, each row is 96 px tall.
- Shared left edge: 18 px for the heading, search field, row text, and separator. Compact layouts use 12 px.
- Header: a 22/28 px bold view title, 34 px new-note button, and 18 px top / 12 px bottom padding. The redundant “THE NOTEBOOK” eyebrow is removed. In compact or hidden-library layouts, the existing view selector becomes the heading rather than repeating it.
- Search: 14 px text in a 38 px field. Note count and “Last edited” use 12/18 px, with 10 px above and 8 px below. The noninteractive sorting label no longer carries a dropdown arrow.
- The first row starts at 139 px on desktop, compared with approximately 169 px before. More of the panel is available for notes.
- Panel width: 320 px on desktop, 280 px below 1200 px, 240 px below 900 px, and 160 px below 600 px. Typography stays readable as the panel narrows; titles and previews truncate instead of shrinking.

## Hierarchy and retained behavior

Titles use `#262626`, previews `#515151`, and dates `#707070`. The selected row uses `#f2f4f7` with a `#176cc0` edge; separators remain `#e6e6e6`. Title tooltips retain the full name, and dates expose the full local timestamp on hover. Folder metadata remains where relevant; the repeated “Markdown” label is removed.

Normal previews skip a leading heading that exactly matches the note title. A different leading heading keeps its words without the opening Markdown hashes. Search snippets use the untouched source, preserving literal Markdown queries and their context. No stored title or body is rewritten.

Selection, keyboard focus, current-note indication, search, saving indicators, folder navigation, import/export, Trash/recovery, and mobile read-only behavior remain intact. The editor's Markdown presentation, focus modes, and typewriter scrolling are unchanged.

## Verification

- `npm run check`: type checking, lint, 130 unit/SQL tests, and production build.
- `npm run test:editor`: 14 editor and application integration tests.
- `npx playwright test --config tests/e2e/production.config.ts`: 11 notebook tests against the production bundle.
- Visual inspection at desktop, 650 px, and 390 px widths; title, preview, date, row height, and header geometry checked in the browser.

The production build retains its existing large JavaScript chunk warning.
