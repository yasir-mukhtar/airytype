# AiryType status

Sprint: 12 September 2026, 13:16–13:58 Asia/Jakarta. Starting branch `main`, commit `6075baa`. Original supplied plan SHA-256: `177c96ad2cc18bc062f9159461dc1a528f8a45eead87b7fe1550d47a6ff50ae1`. The merge adopts remote v1.2 repository annotations; current SHA-256: `5e77e7fa86054681f0a7ad60133729468c1e347fd03a7fa1ca9f25038ffc8634`.

**Runnable local development preview; the end-to-end public-release plan is not complete. No production deployment or beta release is claimed.**

## Founder approval — 12 September 2026

The user approved the current notebook's writing experience. Its editor behavior is the accepted baseline for subsequent work; the older POC remains available as a reference. Next implementation is verified-account notebook/session integration, safe session expiry and pending-work logout cancellation, followed by hosted cloud verification. Native Safari/IME and broader local-durability evidence remain separate open checks.

## Account integration — 12 September 2026

The verified account panel, separate notebook/session owner, committed write coordinator and coherent cloud startup reads are now connected. Local drafts never upload automatically. Session loss preserves/export-protects the paused account cache; pending logout can be cancelled and second tabs route logout requests to the writer. Account folder/Trash/import operations remain unavailable. The user confirmed there is no staging project; this is locally verified integration, not hosted Auth/sync or a release. Verification: **128 unit/SQL/Worker tests**, **5 account browser**, **10 editor**, and **8 production notebook** scenarios passed. See [account evidence](verification/ACCOUNTS_2026-09-12.md).

## Latest continuation — 12 September 2026

Implemented the outside-React account write coordinator and serialized repository/journal acknowledgement boundary for AT-P4-01/02. Verified late-generation preservation, exact retry, atomic rollback, session fencing and bounded request concurrency. `npm run check` now passes **93 tests in 12 files**, types, lint and build; production notebook **8/8** and native Chromium journal **1/1** pass. See [current evidence and remaining integration](verification/COORDINATOR_2026-09-12.md).

Historical coordinator-only boundary below is superseded by the account integration section above. No staging settings are configured; full remote freshness/reconciliation and hosted verification remain pending. The notebook is still local-only; gates remain open. Merged verification also passes the preserved POC’s 20 Chromium and 19 WebKit checks, with one intentional composition skip. Coordinator implementation commit: `5eae892`. The following integration merge incorporates remote main and preserves its approved POC; consult Git for publication state.

## Implementation

| Work | State | Evidence / remaining boundary |
| --- | --- | --- |
| AT-P0-01 checkout and AT-P0-02 contracts | Verified locally | Clean starting checkout, no pre-existing app or real notes; plan copied exactly; decisions recorded. Live remote branch was not refreshed. |
| AT-P0-03 toolchain and AT-P0-04 fixtures | Verified locally | Node 22.23.2, lockfile, Vite/React/TS, CodeMirror installed API inspection, licensed Inter, unit and browser fixtures. |
| P1 writing engine | Implemented; partial verification | Nine independent modes, true wrapped-row emphasis, sentence bounds, anchors/manual scroll, undo, external replacement, over-limit preservation. Chromium passes; founder writing experience approved on 12 September 2026. Native Safari/IME evidence remains pending; G1 technical verification is still open. |
| P2 local durability | Implemented; partial verification | Bounded journal, exact-generation status, origin-wide lock, failed-save memory preservation, restart, exact exports, tab ownership. Chromium strict hint observed. Broader durability/input checks pending. G2 not fully passed. |
| P3 / AT-P4-01–02 account write slice | Integrated; verified locally with mocked HTTP | Verified-account notebook, sealed create/save, atomic acknowledgement, coherent startup read/reload, session-loss fencing and cancellable local-scope logout. No hosted Auth/sync test. |
| AT-P4-03–05 reconciliation/recovery | Partial foundations | Epoch-protection/fencing primitives and recovery SQL exist. Write scheduler and coordinated auth UI/logout integrated locally; full reconciliation, conflict identity transition, checkpoint restoration/promotion and hosted multi-device testing remain pending. |
| P5 daily workflow | Local preview implemented | Notes, folders create/rename/move/delete-empty, search, imports, exports, Trash/restore. Not connected to cloud; staged cloud import, cloud dirty overlays/continuations and terminating remote export are pending. |
| P6 safety/operations | Planned | Permanent deletion, encrypted external receipts, backup automation/alerts, restoration/Auth sanitization, incident drills, SMTP, invitations, support and privacy gates are unimplemented/unverified. |
| P7 public breadth | Backend publication scaffold and local read-only responsive UI | Publishing defaults closed. No connected publication UI or cloud mobile account access. Beta observation and production input/device tests pending. |
| P8 public release | Planned | No deployment, public onboarding, launch approval or release evidence. |

## Verified in this sprint

`npm run check` passes: TypeScript for app and Worker, ESLint, 84 automated unit/SQL/Worker tests, and a production build. Three actual migrations execute in PostgreSQL WASM with pgcrypto and synthetic Auth roles. Local browser tests cover editor modes, real layout geometry, saving, export, folders, Trash, multi-tab behavior, imports, mobile restrictions and narrow desktop access. Worker deployment dry run passes without publishing.

Final browser evidence: 10 editor/app scenarios, 8 notebook scenarios, and 1 journal scenario pass. A discovered rapid-input/focus-decoration race was fixed and stress-tested with 20 repeated nine-mode runs (23,040 exact keystrokes plus undo). See [verification details](verification/SPRINT_2026-09-12.md) for commands, measurements and limits. These results do not certify hosted Supabase, native Safari/OS IME, live cloud convergence, real concurrent database connections, disaster recovery or accessibility-tool support.

## Known limitations

- This notebook stores drafts only in this browser. It never displays a simulated cloud acknowledgement. Browser data can be cleared or evicted; export remains available.
- One writing tab; successor reload is deliberate after the original saves/closes. No timeout lock stealing; account logout is coordinated by the existing writer.
- Public staging settings enable deliberate account login and notebook opening. No automatic local-note migration. A staging project has not been configured.
- Trash has no automatic expiry or permanent deletion. Publication is disabled in both server and Worker flags. Recovery quotas do not substitute for the unfinished client conflict workflow.
- Import preserves original files but the preview does not implement staged, retryable cloud batches. Archive export covers the captured local notebook, not uncached server data.
- Input latency numbers are development-build/headless-machine observations. Production performance gates and real-device UX remain pending. The production bundle still emits Vite's >500 kB chunk warning (about 924 kB JS / 310 kB gzip before splitting).
- GitHub CI is configured but not executed in this session. No release budget, recurring expense, message to another person, or external service provisioning was performed.

## Next exact work

Founder writing-experience approval is recorded. Complete the remaining native Safari/IME and broader durability evidence without reopening the approved writing-feel decision.

Next external dependency: create/configure a separate staging Supabase project, apply the numbered production migrations, and configure real Auth email and redirects. Then verify one account/note through create/save/read/reload, actual expired-session and local-scope logout behavior, two real users plus anonymous/direct-write denial, and concurrent CAS/receipt replay. Public client settings belong in `.env`; no privileged key goes to Vite.

Next local reliability work: foreground clean-note freshness with coordinated editor replacement, full conflict/prior-epoch recovery, deliberate account-cache cleanup and pending export/discard logout semantics before account switching. Connected organization/import/search/export and release operations remain behind their existing gates. Current account integration changes are uncommitted; no deployment or hosted verification occurred.
