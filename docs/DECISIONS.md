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
