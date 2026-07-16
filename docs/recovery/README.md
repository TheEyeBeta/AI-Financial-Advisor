# Phase 5 — Recovery drill documents

**All documents in this directory are `NOT VERIFIED`** until a human has
actually executed the drill against a real production backup, restored
into a genuinely isolated Supabase project, and recorded the results in a
dated copy of `RECOVERY_EVIDENCE_TEMPLATE.md`. Nothing here has been
executed by an agent session — production backup access and a throwaway
Supabase project are both outside what this repo/session can reach, and
per `AGENTS.md` §3, production platform actions require human-run steps.

## Reading order for running the drill

1. `BACKUP_VERIFICATION_CHECKLIST.md` — confirm the backup you're about to
   restore is real, recent, and complete.
2. `ISOLATED_RESTORE_PROCEDURE.md` — the restore itself, step by step,
   starting the RTO clock at the right moment.
3. `MIGRATION_VALIDATION_PROCEDURE.md` — referenced from step 4 of the
   restore procedure.
4. `data_integrity_verification_queries.sql` — referenced from step 6 of
   the restore procedure.
5. `RPO_RTO_WORKSHEET.md` — fill in alongside the restore, not after.
6. `RECOVERY_EVIDENCE_TEMPLATE.md` — the final record; copy it per drill,
   never edit the template in place.
7. `ROLLBACK_CLEANUP_PROCEDURE.md` — run immediately after, whether the
   drill passed or failed.

## Relationship to `docs/DB_RECOVERY.md`

`docs/DB_RECOVERY.md` is the canonical migration/backup/rollback-policy
document and already describes a forward-recovery procedure that **was**
rehearsed — but against a disposable, never-had-real-data Postgres. This
directory exists specifically to close the gap between "the migration
history is sound" (proven) and "we can recover real production data"
(not yet proven). See `ISOLATED_RESTORE_PROCEDURE.md`'s final section for
exactly what's different.

Do not update `docs/DB_RECOVERY.md`'s status claims based on anything in
this directory until a real drill has actually happened and been reviewed.
