# Account write coordinator verification — 12 September 2026

Continuation of AT-P4-01/02 in P3. This is local failure-injection evidence, not hosted Auth or gate acceptance. No staging `.env` was present; only `.env.example` exists. The production UI remains the local preview and no local-preview data is assigned or uploaded to an account.

## Implemented boundary

`SyncCoordinator` runs outside React against an initialized, account-bound `LocalRepository` and an injected `SyncTransport`. The repository's origin-wide lease remains authoritative. The coordinator rejects the local-preview namespace and secondary writers, captures an immutable account/session/writer/epoch fence, loads pending intents, and observes committed generations. It schedules a 750 ms idle delay, a two-second maximum scheduling wait under continuous commits, and a normal two-second per-note send interval. It allows two concurrent note requests and only one request per note. Slow storage/network can exceed scheduling targets; these are not latency guarantees.

Transient transport errors retain the sealed request and use exponential jittered backoff capped at 30 seconds, subject to a larger explicit retry delay. Session, service, epoch, protocol, conflict, validation/quota and local-storage failures pause for a deliberate remedy. The transport maps current repository SQL error names and HTTP failures into those states. Retry records are not rewritten by newer typing. `acknowledged` reports a write receipt only; it is not the product's full “Synced” state or a remote-freshness guarantee.

Repository journal writes, sealing and acknowledgement application share one serial queue. At execution, a queued journal record takes the current in-memory generation and canonical metadata; its commit callback acknowledges the actual written generation. An identical already-persisted snapshot does not recreate an intent cleared by acknowledgement. Acknowledgement commits its base/draft/intent/outbox transaction before updating account-bound memory. Failed transactions leave memory and replay records intact. Session loss before the transaction fences the callback. Session loss at transaction completion must still let the repository reflect that already-committed metadata, preventing the next local write from undoing it; the coordinator separately prevents further network work.

## Executed checks

- `npm run check`: passed app/Worker TypeScript, ESLint, **93 tests in 12 files**, and production build after the final source change.
- Nine new coordinator tests cover generation 41/42 with canonical folder fallback and independent title edits; exact lost-reply replay despite newer typing; session-loss fencing; atomic acknowledgement rollback/retry; namespace and reader rejection; prior-epoch pause; global/per-note concurrency; an uncommitted startup generation; and session loss in the actual local transaction completion callback.
- `npx playwright test --config tests/e2e/production.config.ts`: **8/8 passed** against the rebuilt bundle on dedicated strict port 4178. The initial sandbox attempt could not bind the port; the permitted execution outside the sandbox passed.
- `npx playwright test --config tests/storage/playwright.config.ts`: **1/1 passed**. Confirmed PID 75325 on port 5173 belongs to this repository before reusing the development server. Chromium 153.0.8010.12, 100,000-character synthetic note, 25 samples: p50 **105.8 ms**, p95 **108.4 ms**, reported **strict** hint and exact final persisted text. This is healthy headless Chromium, not storage-pressure or power-loss evidence.
- Existing bundle warning remains: approximately **930 kB JS / 312 kB gzip**. No warning suppression or deployment.

All automated browser data used isolated synthetic fixtures. No existing user browser storage was cleared. No hosted project, external users, SMTP, native IME, Safari, account switching or production publication was exercised.

## Remaining integration

The coordinator is exported but intentionally not attached to `App.tsx`. It requires an external verified-account/session owner that invalidates its supplied fence synchronously on session loss and stops the coordinator before closing or replacing the account repository. It does not acquire a second origin lease, authenticate the user, switch notebooks, transfer preview drafts, or implement logout choices/cleanup.

Next: implement the deliberate account namespace/session lifecycle and pending-work logout cancellation, then one hosted verified-account create/save/coherent read/reload path. Preserve the local preview and keep cloud organization unavailable until its connection rules are enforced. Add transport response/retry-guidance integration evidence, sustained scheduler timing/fairness measurements, remote freshness/reconciliation, conflict identity recovery and restart/handover integration before claiming P3/P4 completion. Two real hosted users and anonymous/direct-write denial, real concurrent PostgreSQL CAS, native Safari/IME and broader storage-pressure evidence remain required. G1–G8 remain open.
