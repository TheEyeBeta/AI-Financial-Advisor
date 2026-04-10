# Skill: db-migration-safety-review

## When to use

- Authoring a new **Alembic** revision under `backend/websearch_service/alembic/versions/`.
- Reviewing an existing revision for production safety (locking, backfills, RLS, grants).
- Assessing upgrade ordering relative to application code that depends on new columns or policies.

## Do not use for

- Applying raw `sql/*.sql` files as the primary deployment path (see `sql/README.md` — reference only).
- Application-only changes with no database schema impact.

## Risk classification

**High** — data loss, extended locks, broken RLS, failed deploys, inconsistent PostgREST exposure.

## Allowed files and paths

- `backend/websearch_service/alembic/**`
- `sql/**` as **read-only context** for historical intent and verification snippets
- Application code **only** when the migration and code must ship in a documented order (keep diffs minimal)

## Required reading (before edits)

- `sql/README.md` — authority of Alembic vs `sql/`.
- The latest few revisions in `backend/websearch_service/alembic/versions/` for naming and upgrade style.
- Any ADR or doc referenced by the migration (e.g. `docs/adr/`).

## Workflow (ordered)

1. State whether the change is **additive**, **data backfill**, or **destructive**; stop and escalate destructive work without human approval.
2. Prefer online-safe patterns: add columns as nullable or with defaults before enforcing constraints; avoid long exclusive locks in hot tables without a plan.
3. Encode **RLS and grants** explicitly when policies change; do not rely on implicit defaults if the repo’s prior migrations set them explicitly.
4. Never instruct operators to run `sql/*.sql` on production as the main upgrade; fold intent into Alembic unless a human mandates a one-off with a written runbook.
5. Validate upgrade path against a **disposable** Postgres instance.

## Commands (mandatory when migrations change)

Set `ALEMBIC_DATABASE_URL` to a throwaway database (see CI for DSN shape: `postgresql+psycopg://...`).

```bash
cd backend/websearch_service
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

If application code depends on the new schema, also run:

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

## Forbidden actions

- Dropping columns or tables without documented backup, backfill, and deploy ordering approved by a human.
- Data fixes inside migrations without idempotence and without acknowledging failure modes.
- Widening RLS or disabling policies “temporarily” in committed migrations.

## Done when

- `upgrade head` and `alembic check` succeed on a clean disposable database.
- Rollback or forward-only story is stated in the final response when risk is non-trivial.
- Application tests pass when code and schema change together.

## Required evidence in the final response

- Revision id(s) and purpose.
- Results of `alembic upgrade head` and `alembic check`.
- Explicit note of any manual Supabase dashboard steps still required (should be rare; escalate if central to the change).
