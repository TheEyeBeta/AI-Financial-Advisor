# sql/ — Legacy SQL and manual verification (not migrations)

## Authority

- **Alembic** under `backend/websearch_service/alembic` is the **deployment** source of truth for schema evolution.
- Files here are **reference**, emergency debugging aids, and **manual verification** scripts per `sql/README.md`.

## Rules for agents

- **Do not** instruct applying these files to production as the default upgrade path.
- **Do** use them to understand **why** a policy exists or to craft a **new Alembic revision** that encodes the same intent safely.
- **Do** treat `verify_*.sql` and similar as **read-only checklists** unless a human explicitly requests execution in a specific environment.

## Risk

- Many scripts assume a particular schema order, role grants, or PostgREST exposure. Running them out of order can **widen RLS**, break grants, or duplicate objects.

## Skill

- `skills/db-migration-safety-review/SKILL.md`
- `skills/supabase-rls-auth-review/SKILL.md`
