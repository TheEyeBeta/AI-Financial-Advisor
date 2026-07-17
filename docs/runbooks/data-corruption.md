# Runbook: Data corruption

**Rehearsed:** NO

- **Trigger:** integrity-check queries failing (`docs/recovery/data_integrity_verification_queries.sql`); user-visible impossible state (negative holdings, oversold positions, orphaned rows); bug found that wrote bad data.
- **Severity:** SEV-1.
- **User impact:** wrong balances/positions/history — trust-destroying even in paper trading.

## Immediate containment
1. **Stop the writer** — identify and disable the code path writing bad data (feature-level: disable the affected feature or roll back the deploy). Do not "fix" rows while the writer is still corrupting.
2. Snapshot now: capture the current state of affected tables (Supabase SQL export of the affected rows) before any repair, for forensics and rollback of the repair itself.
3. No cohort expansion; no unrelated deploys.

## Diagnostics
```sql
-- run the canned checks:
-- docs/recovery/data_integrity_verification_queries.sql
```
- Which invariant broke? DB constraints (#207: positive values, oversell triggers) make several corruption classes *impossible* at the DB layer — if one "happened", first suspect the read/derivation layer (e.g., ledger rebuild) rather than stored rows.
- Bound the blast radius: affected users, time window (audit log + `updated_at` columns).

## Dashboards / logs
Supabase SQL editor, audit log, Sentry (the writing bug often threw somewhere).

## Recovery
Ordered preference (per `docs/DB_RECOVERY.md`):
1. **Derive-and-repair:** for trading state, the journal is the source of
   truth — but **validate the journal first**: if the incident could have
   affected journal writes, a rebuild faithfully reproduces the corruption.
   Check integrity and coverage (row counts vs audit trail, timestamps
   monotonic per account, no gaps in the incident window, spot-check against
   the containment snapshot), run the ledger rebuild
   (`paper-trading-sync.ts` semantics) against an **isolated copy** and
   reconcile its output before applying anything to production.
2. **Targeted restore:** pull affected rows from backup into an isolated restore (`docs/recovery/ISOLATED_RESTORE_PROCEDURE.md`), reconcile, apply surgically.
3. **Full PITR restore:** last resort, owner authorization required — loses post-corruption writes; see `backup-restore.md`.

## Rollback
Of the *repair*: the pre-repair snapshot from containment step 2.

## Validation
Integrity queries clean; affected users' state spot-checked against journal history; fix deployed with a regression test before re-enabling the writer.

## Communication
SEV-1 cadence. Tell affected users specifically what was wrong and what was corrected — precision builds trust; vagueness destroys it.

## Post-incident
Add the violated invariant as a DB constraint or automated integrity check if it wasn't one; record in `docs/recovery/RECOVERY_EVIDENCE_TEMPLATE.md`.
