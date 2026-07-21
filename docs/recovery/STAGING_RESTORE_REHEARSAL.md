# Staging Restore Rehearsal — Procedure & Evidence Template

Controlled, **non-destructive to production** rehearsal that restores a backup
into an isolated staging target and validates it with the recovery validator
(`app/services/recovery_validator.py`). Never run against production; never point
the validator's write path at production (it is read-only by design).

## Preconditions
- Isolated staging Postgres (Supabase branch or a throwaway instance) — NOT production.
- A recent production backup snapshot (logical dump or PITR base) copied to a
  restore target you own.
- `ALEMBIC_DATABASE_URL` pointing at the restore target.
- Env validator green for staging (`python -m app.env_validation`).

## Procedure
1. **Provision** an empty staging DB instance (record its ref; confirm it is NOT a production ref — the env validator's `PRODUCTION_RESOURCE_DENYLIST` guards this).
2. **Restore** the backup into the target (`pg_restore` / branch restore). Record start/finish timestamps.
3. **Migrate to head** (verifies migrations apply cleanly on the restored base):
   ```bash
   cd backend/websearch_service
   alembic -c alembic.ini upgrade head
   alembic -c alembic.ini check      # expect: no new operations / at head
   ```
4. **Run the recovery validator** against the restored target (read-only):
   ```python
   from app.services.recovery_validator import validate_recovery
   report = validate_recovery(
       run_sql,                                   # psycopg cursor.execute→fetchall adapter
       expected_migration_head="0031",            # bump per release
       row_count_minimums={"core.users": 1},
       backup_metadata={"available": True, "last_backup_at": "<snapshot ISO ts>"},
   )
   assert report.ok, report.to_dict()
   ```
5. **Record evidence** with the evidence recorder (`scripts/evidence_recorder.py`),
   work package `WP-RECOVERY-REHEARSAL`, attaching `report.to_dict()` under metrics.
6. **Tear down** the staging target.

## Pass criteria
- Migrations reach head with no pending operations.
- Recovery report `ok == True` (all critical schemas/tables/extensions/provisioning present, row-count sane, backup fresh).
- Restore duration within the RTO worksheet (`docs/recovery/`).

## Evidence template (fill per run)
| Field | Value |
| --- | --- |
| Run ID | WP-RECOVERY-REHEARSAL-<UTC> |
| Backup snapshot timestamp | |
| Restore start / finish | |
| Restore duration (RTO) | |
| Data age at snapshot (RPO) | |
| Alembic head after upgrade | |
| Recovery validator result | PASS / FAIL |
| Failing checks (if any) | |
| Reviewer | |

Do **not** claim recovery evidence without a filed record from this procedure.
