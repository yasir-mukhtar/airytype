# AiryType

A calm Markdown writing workspace built with React, TypeScript, Vite, CodeMirror 6, Dexie, Supabase, and Cloudflare Workers.

**Current state: local development preview, with tested cloud foundations. Not a deployed service or a real-data beta.** The writing notebook saves in this browser. Auth and sync modules exist, but they are not connected to the notebook until the account, conflict, and hosted-database gates pass.

## Run

Use Node 22.23.2 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Keep that origin stable to keep using the same browser notebook. The first writable visit creates three synthetic demonstration notes. Only one tab can write; a second tab reads saved changes. After the first tab has saved and closed, reload the second to take ownership.

## What works in this preview

- Plain Markdown editing with visible wrapped-line or sentence focus, independent top/middle typewriter scrolling, find, undo, and distraction-free writing.
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
npx playwright test --config tests/storage/playwright.config.ts
npm run worker:check
```

`check` runs TypeScript, ESLint, unit/PostgreSQL-WASM tests, and a production build. Browser suites test the actual editor and notebook. Worker checking is a non-deploying bundle dry run. The CI workflow is included but has not been run by GitHub in this sprint.

## Cloud foundation

Three additive migrations implement owner-isolated private records, locked version checks, idempotent request receipts, coherent snapshot reads, organization, search, checkpoints, and explicit publication snapshots. The Worker provides a narrow plaintext publication endpoint that defaults closed. Auth helpers and a session-fenced Supabase transport are included. See [the backend contract](supabase/README.md).

Copy `.env.example` to `.env` only when configuring a separate staging project. Never put a service-role key in any `VITE_` variable. Frontend public project settings do not enable notebook cloud integration. Worker settings are configured separately in `wrangler.jsonc`; publication requires both application and server flags. Permanent note/account deletion is unavailable until the external deletion-receipt and recovery path is implemented.

No hosted Supabase project, production email, deployment, backup scheduler, or restore drill was configured during this sprint. PostgreSQL WASM verifies SQL behavior with synthetic identities; it does not establish hosted RLS, live authentication, concurrent connections, or API response limits.

## Project records

- [Canonical implementation plan](docs/AIRYTYPE_END_TO_END_PLAN.md)
- [Current status and exact next work](docs/STATUS.md)
- [Implementation decisions](docs/DECISIONS.md)
- [Verification evidence](docs/verification/SPRINT_2026-09-12.md)
- [Editor behavior and limitations](src/editor/README.md)
- [Third-party licenses](docs/THIRD_PARTY_LICENSES.md)

The original Ulysses reference images remain untouched. The UI uses Inter, bundled locally under the SIL Open Font License; app icons come from Lucide.
