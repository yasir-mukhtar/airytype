# Cloud boundary and verification

The SQL is an implementation scaffold for a separately configured Supabase project. It has been exercised with PostgreSQL WASM (PGlite 0.5.8, including pgcrypto) and synthetic Auth identities. No migration has been applied to a hosted project; no real login, SMTP delivery, concurrent database connections, Realtime isolation, backup, restore or production public delivery has been verified.

Apply the numbered migrations in order through the Supabase migration workflow. Do not apply `tests/db/bootstrap.sql` to Supabase: it supplies synthetic `auth.users`, `auth.uid()` and API roles for the local tests only. Hosted Supabase already manages those objects. Realtime activation is intentionally absent. Use reconciliation until metadata-only `insert, update` publication settings and hostile subscriber tests have passed in the actual project.

Every browser mutation takes one `p_request` JSON object. The common fields are `protocol: 1`, `epoch` from `get_service_state`, and a fresh UUID `mutation_id`. Persist the entire request before delivery; retries reuse exactly the same object and ID. Versions are positive decimal strings. New IDs are client-generated UUIDs, and creation requires `expected_version: null`. Never rewrite a sealed request's epoch after disaster recovery.

| RPC | Additional request fields | Result |
| --- | --- | --- |
| `create_note` | `note_id`, `expected_version: null`, `title`, `body`, `folder_id` | Note acknowledgement |
| `save_note` | `note_id`, `expected_version`, `title`, `body`, `folder_id` | Note acknowledgement |
| `trash_note`, `restore_note` | `note_id`, `expected_version` | Note acknowledgement |
| `recover_note` | New `note_id`, `expected_version: null`, `source_note_id`, prior `source_version`, `title`, `body`, `folder_id` | Recovery acknowledgement with corrected title/folder |
| `create_folder` | `folder_id`, `expected_version: null`, `name`, `parent_id` | Folder acknowledgement |
| `update_folder` | `folder_id`, `expected_version`, `name`, `parent_id` | Folder acknowledgement |
| `delete_folder` | `folder_id`, `expected_version` | Folder tombstone acknowledgement |
| `publish_note` | `note_id`, acknowledged `expected_version` | Token, source version, publication version |
| `update_publication`, `unpublish_note` | `note_id`, `expected_version`, `publication_version` | Token and versioned publication state |

Note acknowledgements contain `epoch`, `note_id`, `version`, canonical `title`, `folder_id`, `kind`, `deleted_at`, `mutation_id`. They contain no body. Exact receipt replay happens under the account lock after present authorization, lifecycle, service, epoch and protocol checks, before a new CAS or rate/quota charge. A reused ID with a different request digest fails. Accepted receipts are retained at least seven days; the admin-only bounded `airytype_private.cleanup_receipts(1000)` function requires a separately configured daily scheduler.

The server derives ownership from `auth.uid()` and verifies `auth.users.email_confirmed_at`. Caller fields claiming an owner or verification are not authorization. Ordinary authenticated users have no table-write grants. All private read policies require the same verified, active owner and service read availability. Internal mutation functions are inaccessible to browser roles, and definer functions have a fixed empty search path and explicit schema-qualified references.

Read APIs:

- `get_service_state()` returns `{epoch, minimum_protocol, reads_enabled, writes_enabled}`. This content-free configuration is available anonymously.
- `get_note(p_note_id)` returns the joined title/body/folder/version/lifecycle/epoch snapshot or null when unavailable to the caller.
- `list_manifest()` returns one scalar object with complete `notes`, `folders` and per-kind `counts`, without bodies. It returns null on denied private access; clients must not interpret that as an empty library.
- `search_notes(p_query, p_offset = 0, p_limit = 20, p_trash = false)` returns `{epoch, results, next_offset}`. At most five whitespace-separated tokens use literal case-insensitive matching. `%`, `_` and backslashes are ordinary text. The continuation remains valid even when local dirty overlays remove every displayed result on a page.
- `list_revisions(p_note_id)` returns available checkpoint snapshots with decimal `source_version` strings.
- `read_publication(p_token)` is the only anonymous content RPC. It reads an explicit publication snapshot and checks account lifecycle, verification, source lifecycle and service flags in the same statement.

Publishing defaults closed in `service_state.publications_enabled` and in Worker `PUBLICATIONS_ENABLED`. Enabling it requires both flags plus deployment-level request rate limiting, actual GET/HEAD tests, origin routing checks and publication-token invalidation during restore. The Worker needs only the public project key. Its `SUPABASE_URL` and `SUPABASE_ANON_KEY` are separate from the Vite build-time settings. There is no service-role key in the app or Worker. Invocation request logs must stay disabled so the URL token is not written to logs.

`worker/router.ts` reserves `/p` and `/p/*` before assets and reserves `/api/*` without providing deletion. `assets.not_found_handling` must remain `none`. The public endpoint returns UTF-8 Markdown with no HTML execution, `nosniff`, a restrictive CSP, `no-store`, noindex and no CORS. Unknown/revoked tokens are 404; backend errors are generic 503. GET and HEAD query the same authoritative snapshot and HEAD omits the body.

Implemented limits include 1 MiB UTF-8 bodies, 200-code-point titles, 1,000 active / 2,000 retained normal notes, 50 MiB normal plus published text, 200 / 10 MiB recovery copies, 100 active folders, depth three and a 240-accepted-mutation/minute/account budget. Failed mutations roll back, including their counter increment; receipt retries are not charged twice. Gateway abuse limits must separately bound failed requests and reads. Entity creation pauses beyond 10,000 manifest entries or 2 MiB serialized manifest metadata; existing edits and export remain available. Checkpoints are sparse pre-change snapshots with ten-per-note, seven-day and 100 MiB/account retention, deduplicated by source version. Checkpoint age cleanup currently occurs during account writes; idle accounts require the scheduled cleanup still listed below.

Required work before trusting this as a service:

- Verify the integrated account notebook against a hosted project using two real sessions. Browser session/auth, sealed request, coherent startup reads and cancellable local-scope logout are connected and tested with mocked HTTP; full reconciliation/recovery remains incomplete. See `docs/verification/ACCOUNTS_2026-09-12.md`. Local browser/SQL tests do not establish hosted behavior.
- Verify concurrent account locking, two-device CAS races, full-capacity manifest response limits and latency through PostgREST, role grants and Data API configuration on hosted Supabase.
- Finish deliberate prior-epoch/missing-source recovery, restore-checkpoint-as-new-note and explicit recovery promotion. `recover_note` currently accepts an owned divergent/deleted source with a valid prior source version; a missing source or same-version restored epoch copy remains protected locally and exportable until the corresponding deliberate cloud recovery route is implemented.
- Add external encrypted deletion receipts, retryable deletion operations, private backup storage, identity sanitization and a rehearsed restore/cutover. Permanent note deletion, account deletion and automatic trash expiry are unavailable. No ordinary RPC can physically purge notes. Trash retains writing until that safe path exists.
- Configure invitation/signup policy, Auth redirect allowlists, production SMTP, abuse controls, receipt/checkpoint scheduled cleanup, operational alerts and independent encrypted backups. Restoring the database requires independent API/Realtime/Worker quarantine; service flags alone are insufficient.

Run `npx vitest run tests/db/core.test.ts tests/worker/publication.test.ts` for the automated backend tests. These execute all three migrations and verify the SQL contract plus Worker routing/headers, but they do not emulate hosted Auth, PostgREST, multiple PostgreSQL connections or Cloudflare network policies.
