# AiryType

A calm Markdown writing workspace built with React, TypeScript, Vite, CodeMirror 6, Dexie, Supabase, and Cloudflare Workers.

**Current state: local notebook with an integrated staging account preview. Not a deployed service or a real-data beta.** Without cloud settings, writing stays in this browser. With a separately configured staging project, the account panel opens a verified account notebook and connects its create/save/read path. Hosted Auth and database verification are still pending.

## Run

Use Node 22.23.2 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Keep that origin stable to keep using the same browser notebook. The first writable visit creates three synthetic demonstration notes. Only one tab can write; a second tab reads saved changes. After the first tab has saved and closed, reload the second to take ownership.

## What works in this preview

- Plain Markdown editing with quiet formatting markers, a six-level heading hierarchy, compact links that reveal their source for editing, visible wrapped-line or sentence focus, independent top/middle typewriter scrolling, find, undo, and distraction-free writing.
- A bounded local journal with truthful saving/error indicators, reload recovery, and an origin-wide writing lock.
- Notes, nested folders, literal title/body search, moving, Trash and restore.
- UTF-8 `.md`/`.txt` import; exact current-draft Markdown download; ZIP library export with a manifest, safe folder paths, and optional Trash.
- Per-browser preferences and read-only mobile behavior. Narrow desktop windows remain writable.

Browser storage can be cleared or evicted. Download important writing. “Saved on this device” is a local transaction acknowledgement, not cloud backup or cross-device sync.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:editor
npm run test:e2e
npx playwright test --config tests/accounts/playwright.config.ts
npx playwright test --config tests/e2e/production.config.ts
npx playwright test --config tests/storage/playwright.config.ts
npm run worker:check
```

`check` runs TypeScript, ESLint, unit/PostgreSQL-WASM tests, and a production build. Browser suites test the actual editor and notebook. Worker checking is a non-deploying bundle dry run. The CI workflow is included but has not been run by GitHub in this sprint.

## Cloud foundation

Three additive migrations implement owner-isolated private records, locked version checks, idempotent request receipts, coherent snapshot reads, organization, search, checkpoints, and explicit publication snapshots. The Worker provides a narrow plaintext publication endpoint that defaults closed. Auth helpers and a session-fenced Supabase transport are included. See [the backend contract](supabase/README.md).

Copy `.env.example` to `.env` only when configuring a separate staging project. Never put a service-role key in any `VITE_` variable. Those public settings enable the account panel. Sign-in opens a separate account notebook; local-preview notes are never reassigned or uploaded automatically. On reload, use the account panel’s Open account notebook action to deliberately reopen it. Worker settings are configured separately in `wrangler.jsonc`; publication requires both application and server flags. Permanent note/account deletion is unavailable until the external deletion-receipt and recovery path is implemented.

Account writes show a cloud receipt separately from device saving. Pending logout pauses editing and offers waiting, cancellation, or export; it calls SDK local-scope signout only once uploads are resolved. Session loss hides and pauses account writing while preserving device drafts for export or same-account recovery. Existing account caches are retained after signout. Forced discard, account switching, full conflict recovery, and remote-change subscriptions are not available yet. Folder changes, Trash/restore and imports are disabled in the account preview; local notebook tools continue to work. Account ZIP exports explicitly cover device-cached notes.

The account browser suite runs the real application and Auth SDK against mocked HTTP in isolated contexts on port 5180. It is not hosted Supabase evidence.

No hosted Supabase project, production email, deployment, backup scheduler, or restore drill was configured during this sprint. PostgreSQL WASM verifies SQL behavior with synthetic identities; it does not establish hosted RLS, live authentication, concurrent connections, or API response limits.

## Project records

- [Canonical implementation plan](docs/AIRYTYPE_END_TO_END_PLAN.md)
- [Current status and exact next work](docs/STATUS.md)
- [Implementation decisions](docs/DECISIONS.md)
- [Verification evidence](docs/verification/SPRINT_2026-09-12.md)
- [Editor behavior and limitations](src/editor/README.md)
- [Third-party licenses](docs/THIRD_PARTY_LICENSES.md)

The original Ulysses reference images remain untouched. The notebook uses locally bundled Roboto (regular, bold, and extra-bold) under the SIL Open Font License; app icons come from Lucide. Its white surfaces, neutral controls, centered reading column, and typography follow the design study at `2df1df1`. See [the UI adaptation notes](docs/UI_ADAPTATION.md).

## Preserved approved writing POC

The remote approved session-only POC is retained at `http://127.0.0.1:5173/poc.html` during development, with its original Lora typography and writing behavior. Its source remains in `src/App.tsx`, `src/writing.ts`, `src/sample.ts`, and `src/styles.css`; `src/poc-main.tsx` is its separate entry. It does not use notebook storage and is not included in the production notebook bundle. Run its original Chromium/WebKit checks with `npm run test:poc` (install both Playwright browsers first). The main `/` notebook uses the newer `src/app` and `src/editor` implementation.

The merge retains the remote canonical plan's repository-adoption note. The user approved the current notebook writing experience on 12 September 2026. It is the accepted baseline for further work; the older POC remains available as a reference. Native-input and durability verification remain tracked separately in `docs/STATUS.md`.
