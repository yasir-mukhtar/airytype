# Decisions

## 2026-09-12 — Adopt plan v1.2 and retain its gates

The user authorized implementation of the supplied plan in one sprint ending at 13:58 Asia/Jakarta. Its canonical copy is `docs/AIRYTYPE_END_TO_END_PLAN.md`. The stack, public-v1 scope, original task identifiers, and all second-review dispositions remain adopted. Implementation is not gate acceptance.

Initial checkout was clean at `6075baa` and contained repository housekeeping and 26 reference PNGs, with no application or real pre-cloud notes found. No existing user code or notes were replaced. Weekly founder capacity remains unspecified; the plan's 20-hour illustration is not a commitment.

## 2026-09-12 — Local preview plus cloud preparation in this time box

Ship a runnable development notebook with durable local saves and organize it behind the same typed repository boundary. Prepare SQL, auth, transport, and Worker modules in parallel, but keep them disconnected from the notebook until account/session transitions, hosted isolation/concurrency, reconciliation, recovery identity cutover, and real device handoff pass. This is preparation beyond the dependency-ready phase, not a public or beta release and not a change to G1–G8.

The preview's local create/move/trash operations are experimental conveniences. The connected cloud product must enforce online organization mutations and staged cloud imports as required by the plan. Local data is never automatically reassigned to an authenticated account. No client-only fake authentication or simulated “Synced” indicator is used.

## 2026-09-12 — Browser and database evidence boundaries

The in-app Browser reported no available browser after its documented discovery check. Use standalone Playwright/Chromium for automated browser tests. Native Safari, actual OS IME, accessibility tools, and two physical devices remain mandatory evidence gaps.

Use PGlite with pgcrypto to execute the actual migrations in PostgreSQL WASM. Only the Auth identities/roles are synthesized by the test harness. This provides executable SQL tests without claiming hosted Supabase or multi-connection concurrency evidence. Never apply the synthetic bootstrap to a hosted project.

## 2026-09-12 — Fail closed for unfinished service operations

Publications default disabled in both Worker configuration and the database. Unknown `/p` and `/api` URLs never receive the app HTML. No permanent deletion or account deletion endpoint is exposed before external encrypted receipts and retryable cleanup exist. Trash therefore has no automatic expiry in the preview. Recovery snapshots are never silently pruned to satisfy normal-note quotas.

Use origin-wide Web Locks with no timeout stealing. Secondary tabs remain read-only until a saved writer closes and the successor deliberately reloads. Browser session namespaces and cloud account identifiers remain separate.

## 2026-09-12 — Separate Worker and browser type environments

Generate Cloudflare runtime bindings from `wrangler.jsonc`, then typecheck them using `tsconfig.worker.json`. Keep generated Worker globals out of the browser compiler to avoid DOM/global type collisions. Unit tests import the pure Worker router; only the entrypoint references generated bindings.

## 2026-09-12 — Serialize cloud acknowledgements through the live repository

The handoff continuation authorizes useful local coordinator/failure-injection work when staging is unavailable. Implemented that bounded AT-P4-01/02 slice without enabling account UI or moving preview data. Journal writes and sync persistence now share a repository queue; live memory inherits committed acknowledgement metadata before another journal write can restore stale fields. Acknowledged is an internal write-receipt state, not a “Synced” UI claim. The external account/session lifecycle, coordinated logout and hosted verification remain pending. See [coordinator evidence](verification/COORDINATOR_2026-09-12.md).

## 2026-09-12 — Merge remote approved POC and plan adoption

The user explicitly requested commit, push and merge to main. Fetch found remote main at `7adba39`, containing approved writing POC `2d7103e` and canonical-plan adoption `ee76008`, while the local implementation descended from `6075baa`. The earlier local-only baseline inspection therefore missed existing remote work. Preserve both histories with a merge; do not force-push.

Retain the newer notebook entry, dependency versions, storage/sync implementation and verification scripts. Keep the approved POC source and original regression suite independently runnable at development-only `/poc.html`, adding its Lora font dependency and `test:poc` script. Scope the POC Playwright configuration to its own suite so it cannot accidentally run notebook fixtures. Retain remote canonical plan adoption annotations and update current hash references. The newer Inter notebook and approved Lora POC still need founder behavior reconciliation; merging does not certify that product decision or any release gate.

## 2026-09-12 — Current notebook writing experience approved

The user confirmed “1. Writing experience approved.” in response to the browser-testing backlog for the current notebook at `/`. Record this as founder approval of the current writing experience and its adoption as the baseline for further work. Preserve the current editor behavior; the older `/poc.html` remains a reference, with no removal requested. This resolves the outstanding founder writing-feel/reconciliation decision recorded at merge.

Next implementation remains deliberate verified-account notebook/session integration with safe session expiry and cancellable pending-work logout, followed by the hosted one-note cloud path. No browser/device, writing-session duration, or native input method was specified in the approval, so it adds product acceptance without inventing native Safari/IME or storage-pressure evidence. Those G1/G2 checks remain open; the approval does not certify cloud sync or release readiness.

## 2026-09-12 — Integrate the verified account notebook without migrating local drafts

After approving the current writing experience, the user authorized the next account-integration step and confirmed no staging project exists. Implement and verify the account flow locally with injected service responses; do not provision a service or claim hosted verification. The approved editor remains the baseline.

One local repository retains the origin writer lease across account views. Separate immutable account repositories borrow that same ownership. Opening an account is deliberate, including after reload; preview notes are never reassigned or uploaded. Account startup validates the complete bounded manifest and coherent bodies before mounting the account editor. Dirty, missing-source and prior-epoch device copies remain protected; exact same-epoch outboxes remain replayable.

Normal logout pauses new edits, flushes local work and permits cancellation before SDK signout. The available choices are wait, cancel and export; pending uploads block completion. No force-discard or namespace deletion is implemented. Resolved logout uses SDK local scope and hides account content; caches remain available only through explicit same-account reopening. Secondary tabs route scoped logout requests to the writer. Session loss fences callbacks synchronously, hides the editor, preserves export and the unsaved-writing unload guard, and permits returning to the local notebook. Same email is not permission to attach an orphaned notebook to a different account ID.

Account folder/Trash/import mutations are disabled until their connected workflows exist. Export remains explicitly device-cache scoped. Startup requests time out after 15 seconds and retain the account cache for export; late callbacks stay fenced. Foreground freshness/reconciliation, recovery identity cutover, successful email verification/reset delivery, offline logout discard/cleanup policy and hosted multi-device verification remain open.
