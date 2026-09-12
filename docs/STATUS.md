# AiryType status

Sprint: 12 September 2026, 13:16–13:58 Asia/Jakarta. Starting branch `main`, commit `6075baa`. Canonical plan: v1.2, unchanged SHA-256 `177c96ad2cc18bc062f9159461dc1a528f8a45eead87b7fe1550d47a6ff50ae1`.

**Runnable local development preview; the end-to-end public-release plan is not complete. No production deployment or beta release is claimed.**

## Implementation

| Work | State | Evidence / remaining boundary |
| --- | --- | --- |
| AT-P0-01 checkout and AT-P0-02 contracts | Verified locally | Clean starting checkout, no pre-existing app or real notes; plan copied exactly; decisions recorded. Live remote branch was not refreshed. |
| AT-P0-03 toolchain and AT-P0-04 fixtures | Verified locally | Node 22.23.2, lockfile, Vite/React/TS, CodeMirror installed API inspection, licensed Inter, unit and browser fixtures. |
| P1 writing engine | Implemented; partial verification | Nine independent modes, true wrapped-row emphasis, sentence bounds, anchors/manual scroll, undo, external replacement, over-limit preservation. Chromium passes; native Safari/IME and founder writing judgment pending. G1 not passed. |
| P2 local durability | Implemented; partial verification | Bounded journal, exact-generation status, origin-wide lock, failed-save memory preservation, restart, exact exports, tab ownership. Chromium strict hint observed. Broader durability/input checks pending. G2 not fully passed. |
| P3 / AT-P4-01–02 cloud write foundations | Implemented—not verified as an integrated cloud workflow | SQL locked CAS, receipts, coherent reads, quotas, verified-owner policies, immutable sealed requests, atomic late ack, pinned-account transport, auth helpers. Notebook remains local. No hosted auth/sync test. |
| AT-P4-03–05 reconciliation/recovery | Partial foundations | Epoch-protection/fencing primitives and recovery SQL exist. Full scheduler/reconciliation, complete conflict identity transition, coordinated auth UI/logout, checkpoint restoration/promotion, hosted multi-device testing are pending. |
| P5 daily workflow | Local preview implemented | Notes, folders create/rename/move/delete-empty, search, imports, exports, Trash/restore. Not connected to cloud; staged cloud import, cloud dirty overlays/continuations and terminating remote export are pending. |
| P6 safety/operations | Planned | Permanent deletion, encrypted external receipts, backup automation/alerts, restoration/Auth sanitization, incident drills, SMTP, invitations, support and privacy gates are unimplemented/unverified. |
| P7 public breadth | Backend publication scaffold and local read-only responsive UI | Publishing defaults closed. No connected publication UI or cloud mobile account access. Beta observation and production input/device tests pending. |
| P8 public release | Planned | No deployment, public onboarding, launch approval or release evidence. |

## Verified in this sprint

`npm run check` passes: TypeScript for app and Worker, ESLint, 84 automated unit/SQL/Worker tests, and a production build. Three actual migrations execute in PostgreSQL WASM with pgcrypto and synthetic Auth roles. Local browser tests cover editor modes, real layout geometry, saving, export, folders, Trash, multi-tab behavior, imports, mobile restrictions and narrow desktop access. Worker deployment dry run passes without publishing.

Final browser evidence: 10 editor/app scenarios, 8 notebook scenarios, and 1 journal scenario pass. A discovered rapid-input/focus-decoration race was fixed and stress-tested with 20 repeated nine-mode runs (23,040 exact keystrokes plus undo). See [verification details](verification/SPRINT_2026-09-12.md) for commands, measurements and limits. These results do not certify hosted Supabase, native Safari/OS IME, live cloud convergence, real concurrent database connections, disaster recovery or accessibility-tool support.

## Known limitations

- This notebook stores drafts only in this browser. It never displays a simulated cloud acknowledgement. Browser data can be cleared or evicted; export remains available.
- One writing tab; successor reload is deliberate after the original saves/closes. No timeout lock stealing or coordinated cloud logout UI.
- Cloud account login functions and transport are prepared but not wired into the notebook. Adding environment variables alone does not enable sync or migrate local drafts.
- Trash has no automatic expiry or permanent deletion. Publication is disabled in both server and Worker flags. Recovery quotas do not substitute for the unfinished client conflict workflow.
- Import preserves original files but the preview does not implement staged, retryable cloud batches. Archive export covers the captured local notebook, not uncached server data.
- Input latency numbers are development-build/headless-machine observations. Production performance gates and real-device UX remain pending. The production bundle still emits Vite's >500 kB chunk warning (about 924 kB JS / 310 kB gzip before splitting).
- GitHub CI is configured but not executed in this session. No release budget, recurring expense, message to another person, or external service provisioning was performed.

## Next exact work

Sprint implementation commit: `a4625c4`, followed by the final production-regression fix and evidence commit. The compiled production notebook passed the same 8 browser workflow scenarios at 13:57 Jakarta. Local preview was left running at `http://127.0.0.1:5173`. No commits were pushed.

Finish G1 native Safari/IME and founder writing sessions, then G2 storage-pressure/multi-browser evidence. Next implementation task is `AT-P4-01/02` in P3: connect one verified staging account/note through the final journal/sealed request/CAS/atomic ack path, including coordinated same-account session handling and pending-work logout cancellation. Prove two real hosted sessions and anonymous/direct-write denial before extending reconciliation to multiple devices. Preserve the local namespace; transfer only through a deliberate, verified import.

The current safe preview does not require cloud credentials. Completing the hosted slice requires a separately configured staging Supabase project and its public client settings, with actual Auth/email configuration; the frontend must never receive a privileged service key.
