# Runbook: Backup restore

**Rehearsed:** NO — and this one **must** be rehearsed against a scratch
project before it is trusted (see `docs/recovery/BACKUP_VERIFICATION_CHECKLIST.md`).

- **Trigger:** invoked from `data-corruption.md` or `database-unavailable.md` when derive-and-repair cannot recover.
- **Severity:** inherits SEV-1 context.
- **User impact:** during PITR restore, writes since the restore point are lost (RPO reality — `docs/recovery/RPO_RTO_WORKSHEET.md`).

## Immediate containment
1. **Owner authorization required before any production restore** — a restore is itself a destructive operation.
2. Freeze writes where possible (announce downtime; backend can be scaled to zero to guarantee no writes race the restore).

## Diagnostics
- Supabase dashboard → Database → Backups: available snapshots/PITR window for the project's plan. Confirm the actual retention **now**, not from memory.
- Choose the restore point: latest moment provably before corruption (from `data-corruption.md` blast-radius bounding).

## Procedure
Follow `docs/recovery/ISOLATED_RESTORE_PROCEDURE.md`:
1. Restore the snapshot to an **isolated** target (new project/branch), never in place first.
2. Run `docs/recovery/data_integrity_verification_queries.sql` against the isolated restore.
3. Either (a) surgically copy verified rows into production, or (b) full cut-over per the procedure — decision + rationale recorded.
4. Alembic revision of the restored schema must match the running build (`/health/ready` schema component) — upgrade the restored DB if the backup predates the current migration.

## Rollback
Of a failed restore: production untouched until step 3 — abort is clean before then. A botched cut-over reverts to the pre-restore snapshot taken at containment.

## Validation
Integrity queries clean; readiness green; row-count and spot-content reconciliation against the evidence template (`docs/recovery/RECOVERY_EVIDENCE_TEMPLATE.md` — fill it in, it is the rehearsal/real-run record).

## Communication
Downtime + data-loss window stated precisely to all users (SEV-1 cadence).

## Post-incident
Log RPO/RTO actually achieved vs the worksheet's targets; schedule the next rehearsal (a restore procedure that hasn't been rehearsed in 6 months is stale).
