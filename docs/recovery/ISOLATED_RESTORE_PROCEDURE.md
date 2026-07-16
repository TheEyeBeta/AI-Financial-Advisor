# Isolated restore procedure

**Status: NOT VERIFIED.** This procedure has not been executed. It is
written from `docs/DB_RECOVERY.md`'s existing forward-recovery steps (which
*were* rehearsed against a disposable Postgres — fresh install, idempotent
re-run, downgrade/upgrade round-trip, RLS validation) plus the additional
detail this Phase 5 exercise specifically requires: restoring a **real
production backup** into a **genuinely isolated Supabase project**.

**Hard requirement — do not weaken this:** the restore target must be a new,
separate Supabase project, never the production project and never a
project/database shared with production or with staging (per the same
`LOAD_TEST_ISOLATED_INFRA_CONFIRMED` principle used for load testing). If
the only available "isolated" project turns out to share the Postgres
instance, connection pooler, or any other resource with production, this
procedure has not actually been followed — stop and get a truly separate
project first.

## Preconditions

- [ ] `BACKUP_VERIFICATION_CHECKLIST.md` completed with all items passing
      for the backup you're about to restore.
- [ ] A new, empty Supabase project created specifically for this drill,
      with a name that makes its throwaway purpose obvious (e.g.
      `lens-recovery-drill-YYYYMMDD`).
- [ ] Confirmed this new project has no production traffic pointed at it
      and never will (it should be deleted or clearly relabeled after the
      drill — see `ROLLBACK_CLEANUP_PROCEDURE.md`).
- [ ] `RPO_RTO_WORKSHEET.md` open and ready — start the RTO clock the
      moment you begin step 1 below, not before.

## Procedure

1. **Start the RTO clock.** Record the exact start timestamp in
   `RPO_RTO_WORKSHEET.md`.

2. **Restore the backup into the isolated project.**
   - Platform-level restore: Supabase Dashboard → the *new* project →
     Database → Backups → restore from the production backup snapshot, if
     your plan supports cross-project restore. If it does not, use the
     logical-dump path below.
   - Logical-dump path (per `docs/DB_RECOVERY.md`):
     ```bash
     pg_restore -d "$ISOLATED_PROJECT_DB_URL" --clean --if-exists pre_migration_YYYYMMDD.dump
     ```
     Never point `$ISOLATED_PROJECT_DB_URL` at anything other than the new
     isolated project — double-check this literally, out loud, before
     running the command.

3. **Reconcile the schema version marker.**
   - `SELECT version_num FROM public.alembic_version;` in the restored
     database.
   - Compare against the `alembic_version` recorded in
     `BACKUP_VERIFICATION_CHECKLIST.md` / release notes for that backup.
   - If missing or mismatched, `alembic stamp <recorded-revision>` (never
     guess the revision — use the recorded value only).

4. **Apply migrations forward to head**, against the isolated project only:
   ```bash
   cd backend/websearch_service
   ALEMBIC_DATABASE_URL=postgresql+psycopg://<isolated-project-conn> alembic -c alembic.ini upgrade head
   ```
   See `MIGRATION_VALIDATION_PROCEDURE.md` for what to check here.

5. **Start the backend against the restored, migrated database.**
   - Point a local or disposable backend instance's `SUPABASE_URL` /
     `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` at the isolated
     project — never reuse production env vars for this step.
   - Confirm `/health/ready` reports `ready` and
     `schema_revision.status: "ok"`.

6. **Run data-integrity verification** — see
   `DATA_INTEGRITY_VERIFICATION_QUERIES.sql` for the exact queries covering
   users, profiles, chats, paper trades, academy progress, and audit
   records (the six categories the readiness spec names explicitly).

7. **Stop the RTO clock** the moment step 6 passes cleanly (or record where
   it failed and continue troubleshooting with the clock still running —
   RTO is "time to a *verified-correct* restored system," not "time to a
   restore command exiting 0").

8. **Record everything** in `RECOVERY_EVIDENCE_TEMPLATE.md`: elapsed time,
   any manual repair performed, and the full verification-query output.

9. **Clean up** per `ROLLBACK_CLEANUP_PROCEDURE.md` — the isolated project
   should not be left running indefinitely with a copy of production data
   in it.

## What makes this different from the existing rehearsed procedure

`docs/DB_RECOVERY.md`'s forward-recovery steps were exercised against a
**disposable, empty-then-migrated Postgres** — that proves the migration
history is sound, but it does not prove a *real production backup* restores
cleanly, because a disposable Postgres never had production's actual data
volume, data shapes, or any latent inconsistency real usage might have
introduced. This procedure is what closes that gap. Until it has actually
been run once, `docs/DB_RECOVERY.md`'s claims remain scoped to "the
migration history is sound," not "we have proven we can recover production
data."
