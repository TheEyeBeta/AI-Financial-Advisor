# Recovery drill evidence — [DATE]

**Status: NOT VERIFIED / template only** until a real drill fills this in.
Copy this file to `RECOVERY_EVIDENCE_<YYYYMMDD>.md` for each real drill;
never edit this template in place with real results.

## Summary

| Field | Value |
|---|---|
| Drill date | |
| Conducted by | |
| Backup restored (timestamp) | |
| Isolated Supabase project used | _(name — must be a genuinely separate project, never production/staging-shared)_ |
| Git SHA of the app version tested | |
| Alembic revision at backup time | |
| Alembic revision at head (drill time) | |
| Overall result | RPO met: ___ / RTO met: ___ / Data integrity clean: ___ |

## 1. Backup verification

Attach or summarize `BACKUP_VERIFICATION_CHECKLIST.md` results:

- [ ] All items passed
- [ ] Exceptions (list):

## 2. Restore procedure

Attach or summarize `ISOLATED_RESTORE_PROCEDURE.md` execution:

- [ ] Restore completed without manual intervention
- [ ] Manual repair required (describe):

## 3. Migration validation

Attach or summarize `MIGRATION_VALIDATION_PROCEDURE.md` results:

- [ ] Upgrade to head succeeded on first attempt
- [ ] Idempotency re-run succeeded
- [ ] `alembic check` clean
- [ ] RLS spot-check passed (non-admin JWT sees only own rows)
- [ ] `sql/verify_ai_chat_readiness.sql` clean
- [ ] `sql/verify_runtime_schema_readiness.sql` clean
- [ ] `/health/ready` reports `ready`, `schema_revision.status: "ok"`

## 4. Data-integrity verification

Paste the actual output of every query in
`data_integrity_verification_queries.sql`, not just pass/fail:

### Users
```
(paste query output)
```

### Profiles
```
(paste query output)
```

### Chats
```
(paste query output)
```

### Paper trades
```
(paste query output)
```

### Academy progress
```
(paste query output)
```

### Audit records
```
(paste query output, plus note on whether the audit log file itself was
separately verified — see the note in
data_integrity_verification_queries.sql section 6)
```

Any "Expected: 0" query returning non-zero:

| Query | Actual count | Investigated? | Root cause | Resolution |
|---|---|---|---|---|

## 5. RPO / RTO results

Attach or summarize `RPO_RTO_WORKSHEET.md`:

- RPO: ______ (target ≤24h)
- RTO: ______ (target ≤4h)
- Bottleneck identified: ______

## 6. Destructive-operation audit trail check

Per the readiness spec's destructive-operation questions, for any
suspend/restore/delete/orphan-cleanup activity in the restored data window:

- **Who initiated it?** _(cross-reference `admin.user_suspended` /
  `admin.user_restored` / `admin.user_deleted` audit events, if the audit
  log for that period was separately archived and available)_
- **What was changed?** _(from the audit event payload)_
- **Can it be reversed?** _(per the action type — suspend is reversible via
  restore; delete-execute is not)_
- **How long was recovery available?** _(delete-request snapshot TTL — 15
  minutes per `SNAPSHOT_TTL_SECONDS` in
  `app/services/user_account_lifecycle.py` — note this is far shorter than
  the drill timeline; a real delete cannot be "recovered" by this drill,
  only investigated after the fact)_
- **What audit evidence remains?** _(state plainly whether the audit log
  file was available for this window or not — do not claim evidence exists
  if it wasn't actually checked)_

## 7. Rollback / cleanup

Confirm `ROLLBACK_CLEANUP_PROCEDURE.md` was followed:

- [ ] Isolated project deleted or clearly relabeled post-drill
- [ ] No production system was touched during this drill
- [ ] No credentials used in this drill were left in shell history, CI
      logs, or committed anywhere

## 8. Follow-ups

| Finding | Severity | Owner | Target date |
|---|---|---|---|

## Sign-off

- **Reviewed by:** _(a second person, not just the drill operator)_
- **Date reviewed:** _____
- **This drill's result supersedes the "NOT VERIFIED" status in
  `docs/DB_RECOVERY.md` for:** _(update that file's status line to
  reference this evidence file once reviewed)_
