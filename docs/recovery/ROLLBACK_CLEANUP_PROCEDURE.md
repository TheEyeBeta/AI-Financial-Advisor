# Rollback and cleanup procedure (post-drill)

**Status: NOT VERIFIED** — written procedure, not yet executed. Applies
after any run of `ISOLATED_RESTORE_PROCEDURE.md`, and separately covers the
destructive-operation rollback questions the readiness spec asks about.

## Part A — cleaning up after a recovery drill

The isolated Supabase project created for a drill contains a full copy of
production data. It cannot be left running indefinitely.

1. **Immediately after the drill concludes** (whether it passed or failed):
   - [ ] Revoke or rotate any credentials generated specifically for the
         isolated project during the drill.
   - [ ] Confirm no drill-related connection string, service-role key, or
         JWT secret was pasted into a chat tool, ticket, or CI log in
         plaintext. If one was, treat it as a leaked credential — rotate it,
         don't just delete the message.
2. **Within 24 hours of the drill:**
   - [ ] Either delete the isolated Supabase project entirely, or if it's
         being kept temporarily for further investigation of a finding,
         relabel it unambiguously (e.g. rename to
         `lens-recovery-drill-YYYYMMDD-DO-NOT-USE`) and set a calendar
         reminder to delete it.
   - [ ] Confirm deleting it (when done) via the Supabase dashboard, not
         just stopping/pausing it — a paused project still holds the data.
3. **Record the cleanup itself** in the drill's
   `RECOVERY_EVIDENCE_TEMPLATE.md` copy (section 7) — "we restored
   production data somewhere and cleaned it up" needs the same evidence
   trail as the restore itself.

## Part B — rollback questions for destructive workflows

The readiness spec asks, for every destructive workflow: who initiated it,
what changed, can it be reversed, how long is recovery available, what
audit evidence remains. Answering these from the current code (as of this
cycle's audit-trail fix — `app/services/audit.py` now called from
suspend/restore/delete):

### Account suspension and restoration

- **Reversible?** Yes — `restore_user_account` (added this cycle) exactly
  reverses `suspend_user_account`: lifts the Supabase auth ban, sets
  `account_status` back to `active`, clears `suspended_at`/`suspension_reason`.
- **Recovery window:** unbounded while the account remains `suspended` (no
  TTL on how long a suspension can be reversed).
- **Audit evidence:** `admin.user_suspended` / `admin.user_restored`
  events, now written via `audit_log()` — **but see the durability caveat
  below.**

### Job cancellation/retry

- **Reversible?** A failed admin job can be retried
  (`retry_failed_job` / `POST /api/admin/jobs/{job_id}/retry` per
  `app/services/admin_jobs.py`) — this re-runs the job, it does not undo
  whatever partial effect the failed run had. Whether a partially-failed
  job leaves safe-to-retry state depends on the individual job's own
  idempotency, not a generic guarantee this procedure can assert.
- **Recovery window:** governed by whatever retry-eligibility window
  `admin_jobs.py` enforces — verify the actual current logic at drill time
  rather than assuming unbounded.
- **Audit evidence:** `core.admin_jobs` row history (status transitions),
  `app/services/job_logger.py` run log.

### Failed chat recovery

- **Reversible?** A chat turn stuck in `processing` is swept to `failed`
  with a `failure_code` by `chat_turn_reconciliation.py` — this marks it
  resolved, it does not retry it automatically (see the "User retry" gap
  documented in `docs/tests/CRITICAL_JOURNEYS_MATRIX.md` — no retry UI
  exists yet, and the de facto manual-resend workaround risks a duplicate
  user message).
- **Recovery window:** governed by the reconciliation sweep's staleness
  threshold (`_STALE_STATUSES` / timeout window in
  `app/services/chat_turn_reconciliation.py`) — confirm the actual current
  value at drill time.
- **Audit evidence:** `ai.chat_turn_requests.status`/`failure_code`/
  `failure_reason` columns are the durable record; no separate audit-log
  entry is written for this (it's a routine reconciliation, not a
  destructive admin action).

### Orphan-cleanup dry run

- **Reversible?** The dry-run path itself changes nothing —
  `create_dry_run_snapshot` (`app/services/orphan_user_cleanup.py`)
  produces a snapshot for review without deleting anything. The
  **execute** path is the destructive one; confirm at drill time whether
  it has the same delete-request/delete-execute two-step confirmation
  pattern as user deletion, or a different mechanism — do not assume
  parity without checking the current code.
- **Recovery window / audit evidence:** verify directly against
  `app/services/orphan_user_cleanup.py` at drill time; not fully traced in
  this pass.

### Administrative deletion safeguards

- **Reversible?** No — `execute_delete_request` permanently deletes the
  Supabase auth user (cascading to dependent rows). The **safeguard** is
  upstream of the delete: it requires the account already be suspended,
  requires a short-lived (`SNAPSHOT_TTL_SECONDS = 900`, 15 minutes)
  confirmation snapshot with a token + typed email match, and forbids an
  admin from deleting themselves or the final active admin
  (`test_self_delete_forbidden`, `test_final_admin_delete_forbidden`,
  both tested).
- **Recovery window:** none, after execution — this is why suspension
  (reversible) is required before deletion (irreversible) is even offered
  as an option, and why the confirmation snapshot exists.
- **Audit evidence:** `admin.user_deleted` event via `audit_log()`
  (added this cycle), including the idempotency key and whether the
  deletion hit an already-removed (404) branch.

## Durability — applies to every "audit evidence" answer above

**Closed as of migration `0036_core_audit_events`.** `app/services/audit.py`
now writes to `core.audit_events` (Postgres, append-only, hash-chained) in
production/staging, which survives redeploys and restarts — see
`docs/security/AUDIT_TRAIL.md`. The local-JSONL path
(`AI_AUDIT_LOG_PATH`, default `logs/audit.jsonl`) remains only for
development/test, where durability doesn't matter. Destructive
account-lifecycle operations (suspend/restore/delete) now write a mandatory
pre-flight audit record *before* the destructive Supabase Auth call and
abort (503) if it cannot be durably persisted — see "Fail-closed behavior"
in `docs/security/AUDIT_TRAIL.md`.
