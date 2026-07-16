# Migration validation procedure (post-restore)

**Status: NOT VERIFIED against a real restored backup.** The idempotency
and round-trip checks below *have* been exercised against a disposable,
never-had-real-data Postgres (per `docs/DB_RECOVERY.md`'s existing #208
rehearsal). Running them again against a **restored production backup**,
as part of `ISOLATED_RESTORE_PROCEDURE.md` step 4, has not happened.

## Step-by-step validation

1. **Confirm starting state before migrating.**
   ```sql
   SELECT version_num FROM public.alembic_version;
   ```
   Record this. It should match what `BACKUP_VERIFICATION_CHECKLIST.md`
   recorded for the backup being restored.

2. **Run the upgrade to head.**
   ```bash
   cd backend/websearch_service
   ALEMBIC_DATABASE_URL=postgresql+psycopg://<isolated-project-conn> alembic -c alembic.ini upgrade head
   ```
   Every revision between the backup's recorded version and head applies
   in order — this is the first real test of "do our migrations apply
   cleanly on top of actual production data shapes," which a disposable
   empty-then-migrated Postgres cannot test.

3. **Re-run the upgrade (idempotency check).**
   ```bash
   alembic -c alembic.ini upgrade head
   ```
   Should be a no-op (Alembic reports already at head). If any migration
   errors on a second run, it was not written idempotently
   (`IF NOT EXISTS` / `DROP ... IF EXISTS` per `docs/DB_RECOVERY.md`'s
   "Rules for new migrations") — this is a real bug to fix, not something
   to work around during the drill.

4. **Run `alembic check`.**
   ```bash
   alembic -c alembic.ini check
   ```
   Confirms no unapplied model changes / drift between the migration
   history and the schema state.

5. **Spot-check the newest few revisions' effects directly**, not just
   "alembic says head" — for whichever revisions are newest at drill time,
   manually verify their actual DDL/DML took effect (e.g. a new column
   exists with the right type/default, a new constraint actually rejects
   the case it's supposed to). Pick revisions specific to the current
   `HEAD` at drill time; this document intentionally does not hardcode a
   revision list since it will drift from the real migration history.

6. **RLS spot-check with a non-admin JWT** (per `docs/DB_RECOVERY.md`'s
   existing pattern): confirm a regular user's JWT can only see their own
   rows across `core.users`, `ai.chats`, `trading.trade_journal`, and
   `academy.user_lesson_progress` — restoring real data is exactly the
   scenario where a subtle RLS gap (e.g. a policy referencing a since-
   renamed column) would surface that an empty-database migration test
   cannot catch.

7. **Run the read-only verification checklists** already in the repo:
   ```bash
   psql "$ISOLATED_PROJECT_DB_URL" -f sql/verify_ai_chat_readiness.sql
   psql "$ISOLATED_PROJECT_DB_URL" -f sql/verify_runtime_schema_readiness.sql
   ```

8. **Confirm `/health/ready` on a backend instance pointed at the restored,
   migrated database** reports `schema_revision.status: "ok"` — this is
   the same check production uses to gate traffic, so it should be trusted
   as the final signal here too, not treated as redundant with the manual
   steps above.

## Pass/fail

Record each step's outcome in `RECOVERY_EVIDENCE_TEMPLATE.md`. Any failure
here means the restore is **not** validated, regardless of how far through
`ISOLATED_RESTORE_PROCEDURE.md` you got — do not proceed to declaring the
drill successful on a database that failed migration validation.
