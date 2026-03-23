# SQL Status

The files in this directory are now deprecated as deployment inputs.

Use Alembic in [`backend/websearch_service/alembic`](../backend/websearch_service/alembic) as the authoritative migration history. These raw SQL files are kept only as reference material, because they document how the schema evolved and several of them are still useful for manual inspection or emergency debugging.

## Mapping

| Raw SQL file | Alembic revision | Notes |
| --- | --- | --- |
| `schema.sql` | `0001` | Baseline migration also adds missing runtime tables used by the six-schema app. |
| `curriculum_migration.sql` | `0002` | Replayed as-is. |
| `curriculum_seed_data.sql` | `0003` | Replayed as-is. |
| `CURRICULUM_SQL_BUNDLE.sql` | `0004` | Reference-only marker. The executable work is already covered by `0002` and `0003`. |
| `fix_learning_topics_rls.sql` | `0005` | Replayed as-is. |
| `seed_learning_topics.sql` | `0006` | Reference-only marker. Contains the literal `YOUR_USER_ID` placeholder and is not safe to replay automatically. |
| `fix_stock_snapshots_rls.sql` | `0007` | Replayed as-is. |
| `add_news_table.sql` | `0008` | Replayed as-is. |
| `harden_news_policies.sql` | `0009` | Replayed as-is. |
| `harden_rls_policies.sql` | `0010` | Replayed as-is. |
| `add_rate_limit_state.sql` | `0011` | Replayed as-is. |
| `fix_rls_policies_schema.sql` | `0012` | Replayed as-is. |
| `fix_user_id_migration.sql` | `0013` | Replayed as-is. |
| `ensure_ai_chat_schema_access.sql` | `0014` | Replayed as-is. |
| `migrate_public_chat_data_to_ai.sql` | `0015` | Replayed as-is. |
| `expose_ai_schema_to_postgrest.sql` | `0016` | Replayed as-is. |
| `create_ai_chat_tables.sql` | `0017` | Replayed as-is. |
| `fix_ai_chat_grants.sql` | `0018` | Replayed as-is. |
| `verify_ai_chat_readiness.sql` | `0019` | Reference-only marker. Keep using it as a manual verification query bundle. |
| `verify_runtime_schema_readiness.sql` | `0020` | Reference-only marker. Keep using it as a manual verification query bundle. |

## Operational Notes

- For local or CI validation, run Alembic against a PostgreSQL database and use the migrations under `backend/websearch_service/alembic`.
- The repo is still SQL-first rather than ORM-first. `alembic check` is therefore treated as a post-upgrade smoke check in CI, not as a full ORM drift detector.
- If you need to inspect or manually troubleshoot a specific legacy fix, use the raw SQL file here, but do not apply it directly to production as the primary deployment path.
