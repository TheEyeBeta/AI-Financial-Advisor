# Durable audit trail (`core.audit_events`)

**Owner:** TheEyeBeta · **Introduced:** migration `0036_core_audit_events` (2026-07-18)
**Scope:** production/staging audit records for privileged and destructive
backend operations (account suspend/restore/delete, admin job triggers, AI
proxy provider-fallback and abuse events).

## Why this exists

Railway service filesystems outside a mounted volume are ephemeral — a
redeploy or restart discards anything written to local disk. The previous
audit trail (`app/services/audit.py` appending JSONL to `logs/audit.jsonl`)
was therefore **not durable in production**: the record of who suspended,
restored, or deleted an account could vanish on the next deploy. This
document describes the replacement: a database-backed, append-only,
hash-chained table, `core.audit_events`, that all destructive admin
operations write to before (and after) performing the underlying action.

## Schema

See `backend/websearch_service/alembic/versions/0036_core_audit_events.py`
for the authoritative definition. Summary:

| Column | Purpose |
|---|---|
| `id`, `created_at` | Identity and ordering. |
| `actor_type` (`admin`\|`service_role`\|`system`\|`user`), `actor_pseudonymous_id` | Who did it — never a raw email or auth UUID, only an HMAC-SHA256 pseudonym (see below). |
| `action` | Event name, e.g. `admin.user_suspended`. |
| `target_type`, `target_pseudonymous_id` | What was acted on — same pseudonymization as the actor. |
| `request_id` | Correlates to `X-Request-ID` / the lifecycle operation's own request id, for cross-referencing structured logs. |
| `release_sha` | Build identity (`GIT_SHA`/`RAILWAY_GIT_COMMIT_SHA`) at write time. |
| `result` (`success`\|`failure`\|`denied`\|`error`\|`pending`), `reason_code` | Outcome and a short machine-readable reason. |
| `metadata` (JSONB) | Everything else, redacted (see below). |
| `schema_version` | Row-shape version, for forward-compatible readers. |
| `prev_integrity_hash`, `integrity_hash` | Hash chain — see Integrity. |

## What is never stored

`app/services/audit.py`'s `_redact()` strips any metadata key matching a
sensitive-key marker (`email`, `prompt`, `message`, `token`, `authorization`,
`password`, `secret`, `api_key`, `cookie`, `portfolio`, `position`,
`holding`, `balance`, ...) before it reaches `metadata`, replacing the value
with `"[REDACTED]"` — recursing into nested dicts *and* lists/tuples, so
e.g. `{"items": [{"email": "..."}]}` is redacted too. Actor and target
identifiers (auth UUIDs, admin principal emails, and any call site's
`user_id` field — chat/search routes pass the verified Supabase auth UUID
this way) never appear raw in `metadata` — they are promoted to
`actor_pseudonymous_id`/`target_pseudonymous_id` and one-way HMAC-SHA256
hashed with a server-side pepper (`AUDIT_PSEUDONYM_PEPPER`, required outside
development/test — an *unset* `ENVIRONMENT` is treated as non-dev, not as a
silent invitation to use the insecure dev pepper) before they're written.
The hash is deterministic (same input → same pseudonym) so events about the
same actor/target can still be correlated, but the original value cannot be
recovered from the audit record. A client-supplied, non-UUID `request_id`
(e.g. a free-form `X-Request-ID` header) is only kept in `metadata` if it
matches a bounded, plausible-correlation-id shape (`[A-Za-z0-9_-]{1,64}`);
anything else is dropped rather than stored unvalidated.

## Authorization

- `core.audit_events` has RLS **enabled and forced**.
- Only `service_role` has a policy: `INSERT` and `SELECT`. There is **no**
  policy for `anon` or `authenticated` — PostgREST default-denies every
  command for those roles on this table.
- Grants mirror the policies exactly: `GRANT SELECT, INSERT ... TO
  service_role` and nothing else. The migration explicitly `REVOKE`s first,
  because `core` has a pre-existing default ACL (from an earlier migration)
  that grants `service_role` full `arwd` on any *new* table in that schema —
  without the explicit revoke, the additive `GRANT SELECT, INSERT` would
  have left `UPDATE`/`DELETE` in place. (Caught by the disposable-Postgres
  check described below — see `\dp core.audit_events` before/after in the
  PR evidence.)
- **No UPDATE/DELETE/TRUNCATE grant exists for any role, including
  `service_role`.** This is enforced twice: once by omission from the
  grants, and again by `BEFORE UPDATE OR DELETE` (per-row) and
  `BEFORE TRUNCATE` (per-statement) triggers, all calling
  `core.audit_events_reject_mutation()`, which raises unconditionally — so
  even a superuser/table-owner session cannot silently mutate, remove, or
  wipe the table (`TRUNCATE` does not fire row-level triggers, which is why
  it needs its own statement-level one). `app/services/audit.py` never
  attempts any of these.

## Integrity chain

A `BEFORE INSERT` trigger (`core.audit_events_set_integrity()`) computes
`integrity_hash` as `sha256(prev_hash || id || created_at(UTC) || actor_type
|| actor_pseudonymous_id || action || target_type ||
target_pseudonymous_id || request_id || release_sha || result ||
reason_code || metadata || schema_version)` — every persisted column feeds
the hash, not just a subset, and `created_at` is serialized in a fixed UTC
format (not `::text`, which is session-timezone dependent and would make
the hash unreproducible across connections with different `TimeZone`
settings).

`prev_hash` comes from a singleton "chain head" row
(`core.audit_events_chain_head`, one row, no grants to any role) rather than
from `SELECT ... ORDER BY created_at DESC LIMIT 1` on the growing table. That
distinction matters under concurrency: a plain `SELECT` (even guarded by an
advisory lock) still uses the snapshot taken at the start of the enclosing
`INSERT` statement under READ COMMITTED, so a transaction that waited on a
lock would not see what the lock-holder just committed — two concurrent
inserts could both read the same "latest" row and fork the chain (two rows
claiming the same `prev_integrity_hash`). `SELECT ... FOR UPDATE` against an
*existing* row doesn't have that problem: once the lock is granted, Postgres
re-fetches the latest committed version of that specific row. The trigger
function is `SECURITY DEFINER` (owned by the migration role, with a pinned
`search_path`) so ordinary callers only ever need `INSERT` on
`core.audit_events` itself — never direct access to the chain-head table.
This was caught as a real bug during PR review (an advisory-lock-only first
draft still forked under concurrent load) and is covered by
`test_concurrent_inserts_do_not_fork_the_chain` in the disposable-Postgres
suite.

The hash is computed **inside the database**, not supplied by the
application, so a compromised or buggy app-layer client cannot forge or
skip a link in the chain. Tampering (or an out-of-band row edit via a
maintenance connection) breaks the chain from that point forward —
detectable by recomputing hashes and comparing (see Recovery validation SQL
below).

## Fail-closed behavior for destructive operations

`audit_log(..., mandatory=True)` raises `AuditPersistenceError` if the
durable write fails. `app/services/user_account_lifecycle.py` calls this
**before** each destructive Supabase Auth call (ban, unban, delete) with an
`*_attempted` / `pending` event, and again after with the final outcome:

- If the pre-flight write fails, the destructive call is never made — the
  route returns `503` and the account is untouched.
- If the post-hoc write fails (the destructive action already succeeded
  against Supabase Auth), the route still returns an error rather than a
  silent `200`, so an operator knows to reconcile manually rather than
  trusting an unaudited destructive change. The delete flow specifically
  marks its confirmation snapshot `executed` only *after* the outcome audit
  record has been durably persisted — otherwise a retry with the same
  idempotency key would hit the idempotent early-return path and silently
  never re-attempt the missing audit write. A retry after that kind of
  failure instead re-runs the guard checks against Supabase (which will now
  report the target as already gone), surfacing the gap loudly instead of
  masking it.

Non-destructive/best-effort events (AI-provider fallback telemetry,
rate-limit-abuse detection, admin-job-enqueue) call `audit_log()` without
`mandatory=True`: a transient audit-store failure is logged and swallowed
rather than breaking those request paths.

## Development / test fallback

Outside `production`/`staging` (`ENVIRONMENT` unset, `development`, or
`test`), `audit_log()` writes to a local JSONL file
(`AI_AUDIT_LOG_PATH`, default `logs/audit.jsonl`) instead of the database,
matching the previous behavior and requiring no Supabase credentials for
local development. This path is explicitly **not** used in
production/staging.

## Retention / export design (no silent deletion)

Because there is no DELETE grant or policy for normal operation, retention
is handled by **export**, never by deleting rows in place:

1. A scheduled job (not yet implemented — tracked as follow-up work) reads
   rows older than the retention window (proposed: 400 days) via the
   `service_role` SELECT policy and writes them to an append-only, durable
   destination (object storage — S3/GCS — or a data-warehouse sink),
   verifying the export succeeded (row count + checksum match) before
   considering that batch archived.
2. Only after a successful, verified export **and** sign-off from a human
   owner would a separate, explicitly-audited maintenance procedure ever
   remove archived rows from the primary table — this requires a
   superuser/maintenance connection outside the app's normal `service_role`
   path (which has no DELETE grant), and must itself be logged as a new
   `admin.audit_retention_purge` event referencing the export batch it
   corresponds to. This procedure does not exist yet; until it does, rows
   accumulate indefinitely, which is the safe default.
3. Any future automation must never delete a row that has not been
   confirmed exported. "Export unconfirmed" always wins over "table is
   getting large."

## Recovery validation SQL

Run against a copy of the database (never against production directly) to
verify the chain hasn't been tampered with:

```sql
-- Recompute each row's hash from its own content + the previous row's
-- integrity_hash, and compare to the stored value. Any mismatch means the
-- chain was broken (data changed out-of-band, or an out-of-band DELETE
-- and re-insert was used to imitate the trigger's owner mutation guard).
-- Must mirror core.audit_events_set_integrity() in
-- alembic/versions/0036_core_audit_events.py exactly (field order, UTC
-- serialization) — update both together if either changes.
WITH ordered AS (
  SELECT
    id, created_at, actor_type, actor_pseudonymous_id, action, target_type,
    target_pseudonymous_id, request_id, release_sha, result, reason_code,
    metadata, schema_version,
    integrity_hash,
    LAG(integrity_hash) OVER (ORDER BY created_at, id) AS expected_prev_hash,
    prev_integrity_hash
  FROM core.audit_events
)
SELECT id, created_at, action
FROM ordered
WHERE prev_integrity_hash IS DISTINCT FROM expected_prev_hash
   OR integrity_hash <> encode(
        digest(
          COALESCE(prev_integrity_hash, '<genesis>') || '|' ||
          id::text || '|' ||
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
          actor_type || '|' ||
          COALESCE(actor_pseudonymous_id, '') || '|' || action || '|' ||
          COALESCE(target_type, '') || '|' ||
          COALESCE(target_pseudonymous_id, '') || '|' ||
          COALESCE(request_id::text, '') || '|' ||
          COALESCE(release_sha, '') || '|' || result || '|' ||
          COALESCE(reason_code, '') || '|' || metadata::text || '|' ||
          schema_version::text,
          'sha256'
        ),
        'hex'
      );
-- Expect zero rows. Any row returned is a candidate tamper/corruption event
-- — escalate per docs/runbooks/data-corruption.md.
```

```sql
-- Sanity checks after a migration or restore:
SELECT count(*) FROM core.audit_events;                      -- non-decreasing over time
SELECT min(created_at), max(created_at) FROM core.audit_events;
SELECT action, count(*) FROM core.audit_events GROUP BY action ORDER BY 2 DESC;
```

## Migration notes: rollback vs. forward-fix

- `0036_core_audit_events` downgrade drops the table, its triggers, and its
  functions. This is safe **only** before the table holds real data (e.g.
  immediately after a failed deploy, before traffic). Once production audit
  records exist, **never run the downgrade** — it destroys audit history,
  which defeats the purpose of this table. Prefer a forward-fix migration
  (e.g. `0037_...` adding a column or adjusting a policy) over any downgrade
  once this table is live.
- Do not run this migration against production directly from a workstation.
  It ships through the same Alembic pipeline as every other migration.

## Disposable-Postgres integration evidence

Verified against a local, ephemeral PostgreSQL 16 cluster (not Supabase,
not shared, destroyed after each check): full `alembic upgrade head` chain
(`0001` → `0036`) applied cleanly; `alembic downgrade -1` followed by
`upgrade head` round-tripped cleanly; `service_role` could `INSERT`;
`anon`/`authenticated` got `permission denied` for both `INSERT` and
`SELECT`; `pg_class.relrowsecurity`/`relforcerowsecurity` and `pg_policies`
confirmed at the catalog level (not just via permission-denied behavior);
`UPDATE`/`DELETE`/`TRUNCATE` were all rejected by the triggers even when run
as the table owner; two sequential inserts produced a correctly linked hash
chain (`row2.prev_integrity_hash == row1.integrity_hash`); 15 concurrent
inserts from separate connections produced zero forked `prev_integrity_hash`
groups.

Two real bugs were caught by this process and fixed before merge:

1. A pre-existing schema-level default ACL granting `service_role`
   `UPDATE`/`DELETE` on any new `core` table (confirmed via `\dp
   core.audit_events` before/after the explicit `REVOKE`).
2. The hash-chain race described above — an advisory-lock-only first draft
   still forked the chain under concurrent inserts; replaced with the
   chain-head `SELECT ... FOR UPDATE` design.

Automated, opt-in version of the same checks:
`backend/websearch_service/tests/test_audit_events_disposable_postgres.py`
(skipped unless `AUDIT_INTEGRATION_DATABASE_URL` points at a disposable
Postgres with migrations already applied through `0036`).

## Related docs

- `docs/runbooks/account-compromise.md` — querying this table during an
  incident.
- `docs/runbooks/ai-provider-unavailable.md` — provider-fallback events now
  live here in production (not `logs/audit.jsonl`).
- `docs/security/THREAT_MODEL.md` — audit log entry.
- `docs/MONITORING_IMPLEMENTATION_PLAN.md` §1/§2 — closes the "durable
  audit log storage" gap tracked there.
