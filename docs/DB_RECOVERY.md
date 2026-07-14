# Database migration, backup, and recovery strategy

**Owner:** TheEyeBeta · **Last verified:** 2026-07-13 · **Scope:** issue #208 (audit M-06)

## Canonical migration path

- **Single source of truth:** `backend/websearch_service/alembic/` — one linear
  history, `0001` → head. A blank PostgreSQL database reaches the full secure
  schema (all six schemas, RLS, grants, functions) with one command:

  ```bash
  cd backend/websearch_service
  ALEMBIC_DATABASE_URL=postgresql+psycopg://... alembic -c alembic.ini upgrade head
  ```

- `sql/*.sql` is **reference-only** (see `sql/README.md` for the complete
  file → revision mapping). As of `0035_consolidate_manual_fixes`, no feature
  or security fix depends on a manual SQL Editor step.
- CI (`.github/workflows/ci.yml`, backend job) migrates a blank Postgres from
  `0001` to head and runs it twice (idempotency) on every PR — every upgrade
  step from every prior revision is exercised because the history is linear.
- **Verification of schema state:** the readiness probe (`/health/ready`)
  compares the database's `alembic_version` against the head revision shipped
  with the running build. A **mismatch fails readiness** (the instance will
  not serve as ready against a schema it doesn't match); an unreadable
  version table reports `unknown` and marks the service degraded without
  taking it down.

## Backup before migration (production)

1. Supabase Dashboard → Database → Backups: confirm the latest daily backup
   is recent, or take a manual snapshot (paid plans), **before** deploying a
   release containing new migrations.
2. For a belt-and-braces copy of critical user data, run a logical dump
   (human step, from an operator machine):

   ```bash
   pg_dump "$SUPABASE_DB_URL" \
     --schema=core --schema=ai --schema=trading \
     --schema=market --schema=academy --schema=meridian \
     -Fc -f pre_migration_$(date +%Y%m%d).dump
   ```

3. Record the current `alembic_version` (`SELECT version_num FROM
   public.alembic_version;`) in the release notes.

## Rollback vs. roll-forward

**Default policy: roll forward.** Downgrades that drop columns or tables
destroy data; a bad migration in production is corrected by a new revision,
not by `alembic downgrade`.

Downgrade status by revision:

| Revisions | Downgrade |
|-----------|-----------|
| `0001`–`0031` (bootstrap/consolidation era) | Mostly `NotImplementedError` — these encode the *baseline*; "undoing" them has no meaningful target state. Recovery from a failed baseline install is **forward recovery** (below), never downgrade. |
| `0032`–`0034` | Functional `downgrade()`, exercised against a disposable Postgres in review. Still data-destructive where they drop objects — production use requires the backup step above. |
| `0035` | Deliberately **partial** `downgrade()`: removes only recreatable policies/grants and the derived materialized view. Data-bearing tables/columns it may not have created (pipeline tables, job logs, ranking history, digest columns) are retained — removing them is a human decision, never an automatic rollback side effect. |

## Forward recovery procedure (tested)

Used when a migration fails mid-deploy or a database must be rebuilt:

1. **Stop writes:** scale the backend to zero / enable maintenance mode.
2. **Restore**: Supabase Dashboard restore to the pre-migration backup, or
   restore the logical dump into a fresh project:

   ```bash
   pg_restore -d "$NEW_DB_URL" --clean --if-exists pre_migration_YYYYMMDD.dump
   ```

3. **Reconcile the version marker** if the restore predates it:
   `SELECT version_num FROM public.alembic_version;` must match the revision
   recorded in the release notes; if the table is missing, `alembic stamp
   <recorded-revision>`.
4. **Re-run migrations** with the fixed revision file: `alembic upgrade head`.
5. **Validate** before re-enabling traffic:
   - `/health/ready` reports `ready` and `schema_revision.status == "ok"`.
   - Run the read-only checklists `sql/verify_ai_chat_readiness.sql` and
     `sql/verify_runtime_schema_readiness.sql` for RLS/grant assertions.
   - Spot-check RLS with a non-admin JWT (a user sees only their rows).

This procedure was rehearsed against a disposable Postgres during the #208
work: fresh `0001→0035` install, double-upgrade idempotency, `0035↔0034`
downgrade/upgrade round-trip, and RLS validation of the migrated objects
(digest UPDATE policy, chat pagination function, trading constraints).

## Rules for new migrations

- New revision per change; never edit an applied revision's `upgrade()`.
- Idempotent SQL (`IF NOT EXISTS` / `DROP ... IF EXISTS` + re-create).
- Provide a real `downgrade()`; when genuinely impossible, raise
  `NotImplementedError` **and** document the forward-recovery implication here.
- Migrations needing downtime, backfill, or multi-phase deploys stop and get
  human sign-off first (`AGENTS.md` §6).
- Verify against a disposable Postgres (fresh + re-run) before merging;
  exercise any new policy/constraint/function with real SQL, not just DDL.
