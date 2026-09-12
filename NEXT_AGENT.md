# AiryType — next-agent handoff

Updated: 12 September 2026, after the 13:16–13:58 Asia/Jakarta implementation sprint.

## Latest continuation — account write coordinator

The handoff was read and continued on 12 September 2026. New `src/sync/coordinator.ts` and `errors.ts` implement account-scoped committed-generation scheduling, two global requests/one per note, immutable retries and typed pause states. `LocalRepository.sealForSync` / `acknowledgeSync` now serialize journal writes and acknowledgement memory updates. The integration gap described in the original handoff below is addressed at that repository boundary; account UI/session lifecycle and full remote reconciliation are still missing.

Current evidence: [COORDINATOR_2026-09-12.md](docs/verification/COORDINATOR_2026-09-12.md). Final check: 93 tests/12 files, types/lint/build; production notebook 8/8; Chromium journal 1/1, p95 108.4 ms at 100k characters. No staging `.env`, hosted tests or native-device evidence. Coordinator implementation is committed as `5eae892`. The integration merge includes remote main at `7adba39`; consult Git for publication state. The remote approved POC is retained separately at `/poc.html` in development.

Next implementation: connect a deliberate verified-account notebook/session owner to the tested coordinator, including synchronous session-loss fencing and pending-work logout cancellation before exposing account switching. Preserve `local-preview`. See the evidence file's remaining integration section before extending the coordinator. The existing local UI is still not connected to Auth/cloud.

The fetched remote history corrects the original sprint’s incomplete baseline inspection: an approved POC already existed on remote main. Read the merged `AGENTS.md`, README and merge record in `docs/DECISIONS.md`. Keep both implementations until founder behavior reconciliation is complete.

## Start here

AiryType is a **working local development preview with tested cloud foundations**. It is not an integrated cloud service, private beta, or public release. Preserve the implementation and finish the missing integration; do not restart the project or claim the complete plan has shipped.

Repository: `/Users/hy4-mac-006/AiryType`. Branch at handoff: `main`.

- `71f28f6` — final production notebook verification and pending-note navigation fix.
- `a4625c4` — local writing preview, cloud foundations, tests and project records.
- `6075baa` — original repository/reference-image baseline.

The worktree was clean before this handoff file was added. Neither sprint commit was pushed. Inspect current Git status and instructions before editing, because another session may have made changes after this record.

The previous sprint's 13:58 deadline has ended. Follow the user's next instructions for scope and time; do not treat the old deadline as a new recurring work window.

## Read in this order

1. [README.md](README.md) — startup and current product boundary.
2. [docs/STATUS.md](docs/STATUS.md) — implemented work, incomplete gates and next task.
3. [docs/DECISIONS.md](docs/DECISIONS.md) — adopted choices and preparation performed ahead of gates.
4. [docs/AIRYTYPE_END_TO_END_PLAN.md](docs/AIRYTYPE_END_TO_END_PLAN.md) — canonical v1.2 plan. Start with §§2, 10 and 14, then the sections relevant to your task.
5. [docs/verification/SPRINT_2026-09-12.md](docs/verification/SPRINT_2026-09-12.md) — tests actually run, measurements, fixes and evidence limits.
6. For cloud work, [supabase/README.md](supabase/README.md); for editor work, [src/editor/README.md](src/editor/README.md).

The canonical plan now retains remote main’s repository-adoption annotations. Current SHA-256: `5e77e7fa86054681f0a7ad60133729468c1e347fd03a7fa1ca9f25038ffc8634`. The original supplied-file hash is recorded in historical sprint evidence. Keep this one plan authoritative rather than creating another implementation plan. Update status and decisions when work materially changes.

## What the user can use now

- Markdown-source editor with one CodeMirror view, independent off/line/sentence focus and off/top/middle scrolling, find, undo, and distraction-free mode.
- Device-local drafts using Dexie/IndexedDB, bounded writes, exact-generation save indicators, failed-save preservation, reload recovery and one origin-wide writer tab.
- Multiple notes, nested folders, folder management, literal title/body search, Trash and restore.
- Validated UTF-8 Markdown/text import, exact current-draft Markdown download and ZIP notebook export with safe paths, a manifest and optional Trash.
- Persisted browser preferences, read-only mobile behavior and writable narrow desktop layouts.

The preview's namespace is `local-preview`. Three synthetic notes are seeded on the first writable visit. No real notes existed in the starting repository, but the user may now have written real drafts in the preview. Never clear browser storage or recreate its database to make a test pass.

“Saved on this device” means a completed local transaction. It does not mean cloud sync or backup. Browser data can be cleared or evicted; keep export usable during every failure state.

## Code entrypoints

| Area | Files and integration notes |
| --- | --- |
| App shell | [src/app/App.tsx](src/app/App.tsx): navigation, dialogs, editor integration and save UI. [src/app/notebook.ts](src/app/notebook.ts): repository singleton and cached initialization/seeding. |
| Editor | [src/editor/createEditor.ts](src/editor/createEditor.ts), [interactions.ts](src/editor/interactions.ts), [types.ts](src/editor/types.ts): `createEditor`, compartments, native-input/geometry guards and controller interface. |
| Local repository | [src/storage/repository.ts](src/storage/repository.ts): `LocalRepository` / `createLocalRepository`, memory snapshots and organization. [journal.ts](src/storage/journal.ts): bounded coalescing. [writer-lock.ts](src/storage/writer-lock.ts): `airytype:writer`. |
| Local database | [src/storage/database.ts](src/storage/database.ts), [types.ts](src/storage/types.ts): drafts, bases, intents, outbox, recovery records and session fences. |
| Sync primitives | [src/sync/persistence.ts](src/sync/persistence.ts): `SyncPersistence.seal` / `acknowledge`. [protocol.ts](src/sync/protocol.ts): reconciliation and acknowledgement rules. These are not a running sync coordinator. |
| Cloud transport | [src/sync/transport.ts](src/sync/transport.ts): `SupabaseSyncTransport` pins the validated account's bearer token for private requests. |
| Auth | [src/auth/client.ts](src/auth/client.ts), [session.ts](src/auth/session.ts): optional client, signup/login/reset/session helpers and explicitly local-scope signout. No connected account UI or namespace coordinator yet. |
| Import/export | [src/export/markdown.ts](src/export/markdown.ts), [library.ts](src/export/library.ts): exact bodies, UTF-8 validation, collision-safe paths and pinned local membership. |
| Database | [supabase/migrations](supabase/migrations): ordered core, organization and publication migrations; RPC signatures and gaps are in the backend README. |
| Worker | [worker/router.ts](worker/router.ts), [publication.ts](worker/publication.ts), [wrangler.jsonc](wrangler.jsonc): narrow Markdown delivery, protected route handling, publishing disabled. |

Important integration gap: `LocalRepository` owns live in-memory drafts/status while `SyncPersistence` updates IndexedDB records directly. Wiring those classes together requires a single coordinator that serializes and reflects acknowledgements into the current memory generation. Merely scheduling `send()` and `acknowledge()` beside the current repository is insufficient: later journal writes must not restore stale base metadata or clear newer typing.

## Next concrete task

The next gate work is native Safari/IME and founder writing evidence for G1, then storage-pressure/multi-browser evidence for G2. These remain incomplete even though Chromium automation passes. Record what can be tested automatically and what still needs the founder or a native device; do not invent observation results.

The next implementation slice is **P3, AT-P4-01/AT-P4-02: one verified staging account and one note through the final journal → sealed request → CAS RPC → atomic acknowledgement path**. These task IDs begin in P3 and later expand in P4; retain that dependency rather than renumbering them.

Suggested bounded sequence:

1. Inspect the current source, tests, session/namespace model and actual environment configuration. Reuse the existing stack and repository boundary.
2. Implement the coordinator outside React: one origin-wide writer, current account/session/epoch fence, bounded cloud scheduling, one immutable in-flight request per note, typed pause/retry states and safe memory/IndexedDB transitions.
3. Add a deliberate authenticated notebook flow without reassigning or uploading the `local-preview` namespace automatically. A local-to-account transfer must retain its source until cloud acknowledgement and export verification.
4. Wire one verified staging account's create/save/read/reload. The account UI alone is not completion. Preserve generation 42 when an acknowledgement for generation 41 arrives; retry a dropped acknowledgement with the exact sealed ID and payload.
5. Implement coordinated session loss and logout before offering account switching. Settle local writes and offer the plan's pending-cloud choices before `signOutLocal()`. Cancelling logout must keep the session and drafts usable; another browser's session must remain valid.
6. Verify with two actual hosted users plus anonymous requests: owner isolation, direct-write denial, CAS races, coherent body/version reads and exact receipt replay. Keep release gates open until the required hosted/native evidence exists.

If staging access is unavailable, continue useful local coordinator/failure-injection work and clearly record the missing hosted check. Do not replace the secure path with last-write-wins saves or pretend that synthetic identities establish live Auth behavior.

## Existing tests and how to run

Node version is pinned in `.nvmrc` to 22.23.2. Dependencies and Chromium were installed in the previous session; inspect availability before installing again.

```sh
npm ci                         # When dependencies need installation
npm run dev                    # http://127.0.0.1:5173
npm run check                  # App/Worker types, lint, unit/SQL tests, build
npx playwright install chromium # When the browser binary is absent
npm run test:editor
npm run test:e2e
npx playwright test --config tests/storage/playwright.config.ts
npx playwright test --config tests/e2e/production.config.ts
npm run worker:check            # Bundle dry run; does not deploy
```

Run `npm run build` before the production browser suite if sources changed. Its dedicated strict port is **4178**, with server reuse disabled. The default preview port **4173 belonged to another local app** during the sprint; do not kill or reuse unrelated servers. Confirm which app owns any reused development port as well.

The development preview was left running at `http://127.0.0.1:5173`; process survival is not guaranteed across sessions. Preserve that origin for existing browser drafts. The in-app browser was unavailable in the previous session, so Playwright was used after documented discovery failed. Recheck available browser capabilities and applicable instructions in the new session rather than assuming this remains true.

Recorded sprint results, not checks rerun while writing this handoff:

- `npm run check`: **84 tests across 11 files**, app and Worker typechecks, lint and production build passed.
- **10 editor/app**, **8 notebook**, and **1 journal** browser scenarios passed. The production bundle also passed the same **8 notebook** scenarios.
- Rapid-input stress passed **20 repetitions**, covering **180 mode runs and 23,040 exact keystrokes**, including whole-document and undo equality assertions.
- Healthy Chromium journal sample: 100k-character note, normal 100 ms schedule, p95 **107.1 ms**, observed `strict` hint and exact final persisted bytes. This is not a power-loss guarantee.
- Input measurements at 100k/500k were development-build observations, not certified production latency. See the evidence document for exact conditions.

Tests under `tests/db` run the actual SQL migrations in PGlite with pgcrypto and synthetic Auth roles. **Never apply `tests/db/bootstrap.sql` to Supabase.** It is test infrastructure, not a production migration. These tests do not cover hosted PostgREST, real JWT/SMTP behavior or concurrent PostgreSQL connections.

Use relevant existing regression tests after changes; do not repeatedly run every suite without a new failure or changed risk. Freeze source while testing input races: editing/formatting can trigger HMR and invalidate browser observations. Browser reports/screenshots are ignored under `test-results/{editor,e2e,storage,production}`.

## Fixes that must survive future refactoring

- Focus-decoration transactions previously reordered rapidly typed letters. Preserve the native `beforeinput`/`input` fences, deferred cosmetic work, DOM/editor selection agreement check, and composition guards in `interactions.ts`.
- Geometry-only follow-ups must not recursively re-enter CodeMirror's active measurement cycle. Keep one scroll owner; manual scrolling must not trigger a timer snap-back.
- A pending note creation/switch briefly allowed editing the previous note before navigation finished. `openingNote` now pauses writing during the transition, and layout effects align editor identity before interaction resumes. Do not remove this protection for cosmetic responsiveness.
- The global search shortcut must reveal the library before focusing its input, or intended search typing can modify the note.
- Initialization/seeding is cached outside React. Do not seed from the stale initial snapshot on every remount.
- Import batches must not repeatedly change the active editor. Preserve intervening user navigation and select at most the final import.
- Keep the editor's current memory exportable after a storage failure, including initial creation and failed close. A saved indicator must correspond to the exact committed generation.
- Keep browser and Worker TypeScript environments separate. `worker-configuration.d.ts` is generated; combining its globals with browser DOM types previously caused conflicts.

## Unfinished service work and constraints

- `.env.example` contains only optional **public staging** URL/key settings. No hosted project, real SMTP or live cloud session was configured. Supplying environment variables alone does not connect notebook sync. Never put a service-role key in `VITE_` variables.
- All `SyncPersistence` calls require the origin writer lock; its fence callback alone does not acquire ownership. Secondary tabs must not drain queues, clear namespaces or perform independent account cleanup.
- Full reconciliation, clean-note freshness, conflict recovery identity cutover, prior-epoch recovery, missing-source recovery, recovery promotion and checkpoint restore-as-new-note remain unfinished. Preserve clean as well as dirty device copies across an epoch change.
- Cloud organization/search/export integration remains unfinished: connected mutations need the plan's connection rules, search must retain server continuation after dirty overlays filter a page, and complete exports must terminate with pinned membership and explicit failures.
- Realtime is not activated. Prove metadata-only, server-side insert/update-only publication and hostile-subscriber isolation before enabling it; notifications are hints, not the sync truth.
- Public Markdown SQL/Worker code exists but publication defaults **off in both database and Worker**. There is no connected publishing UI. Unknown `/p` and `/api` routes must never fall back to app HTML.
- Permanent-note/account deletion, encrypted external receipts, retryable cleanup, backup jobs/alerts and a quarantined restore with Auth sanitization have not been implemented/verified. Trash has no automatic expiry. Do not expose physical deletion before its receipt boundary exists.
- Gateway abuse controls, hosted quotas/manifest-envelope validation, real SMTP, invitations/admission, support/incident operations, native accessibility and beta observation are pending. GitHub CI is configured but was not run remotely.
- A production bundle warning remains at about 925 kB JS / 310 kB gzip. Optimize against measured cold-start needs; do not hide the warning or sacrifice the writing safeguards just to reduce a metric.

The plan's G1–G8 gates remain open as documented. Continue toward them, retain honest save/recovery states, preserve all existing drafts, and leave an updated status/evidence record for the following session.
