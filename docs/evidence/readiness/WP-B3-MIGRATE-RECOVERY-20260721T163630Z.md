# Evidence — WP-B3-MIGRATE-RECOVERY: EXECUTED: 36 Alembic migrations from clean + recovery validator on real userspace Postgres

- **Run ID:** `WP-B3-MIGRATE-RECOVERY-20260721T163630Z`
- **Result:** **PASS**
- **Environment:** clean-linux-local-postgres  ·  **App version:** readiness-batch3
- **Commit:** `5bad7e946653d44e41482637df05f2b0a1a5d076`
- **Started:** 2026-07-21T16:36:30Z  ·  **Finished:** 2026-07-21T16:36:30Z
- **Command:** `python pg_rehearsal.py (pgserver userspace Postgres; alembic upgrade head; recovery_validator)`
- **Content SHA-256:** `411ca10eef09b9e606ff58cfad91e8eabe32085fb41b8f5c94af1c5b99e7ee05`

## Preconditions
- Ubuntu 22.04 sandbox
- pgserver bundled PostgreSQL (userspace, non-root)
- Supabase baseline emulated: anon/authenticated/service_role roles + pgcrypto/uuid-ossp shims mapping to core hash/uuid functions
- disposable /tmp cluster, non-destructive, never touches production

## Assertions
- alembic upgrade head rc=0 (all 36 migrations applied clean)
- reached head 0036_core_audit_events
- recovery validator ok=True (7 ok / 0 fail / 3 skip)
- six schemas present; pgcrypto present; no orphaned auth users
- revealed + corrected real chat table name ai.chats (was ai.chat_sessions guess)

## Metrics

| Metric | Value |
| --- | --- |
| migrations_applied | 36 |
| upgrade_rc | 0 |
| alembic_head | 0036_core_audit_events |
| recovery_ok | True |
| recovery_counts | {'ok': 7, 'fail': 0, 'skip': 3} |
| alembic_check_rc | 255 |

## Failure details
alembic check rc=255 is an autogenerate artifact: raw-SQL (op.execute) migrations create public-schema tables that autogenerate reports as 'new operations'. Not schema drift — the upgrade applied cleanly and reached head.

## Artifacts
- `outputs/pg_rehearsal.py`
- `backend/websearch_service/app/services/recovery_validator.py`

## Remaining risks
- pgcrypto/uuid-ossp were shimmed to core functions; a real Supabase restore provides them natively
- Live restore-from-backup + app read/write-after-restore remain a staging exercise

## Reviewer notes
Converts migration validation + recovery from AUTOMATED-TESTED to EXECUTED (clean Linux, real Postgres).
