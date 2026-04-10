# Skill: supabase-rls-auth-review

## When to use

- Changes touch **RLS policies**, **GRANT**s, schema exposure to PostgREST, or multi-schema layout (`core`, `ai`, `trading`, `market`, `academy`, `meridian`).
- Changes touch **JWT verification** or Supabase env configuration on the backend.
- Changes touch **frontend Supabase clients** (`src/lib/supabase.ts`, typed database access) in ways that affect authorization or data exposure.

## Do not use for

- Pure UI styling with no data or auth path changes.
- Backend endpoints with no database or auth impact (use `backend-endpoint-implementation`).

## Risk classification

**Critical** — account takeover patterns, cross-tenant data leaks, privilege escalation via widened policies or service-role misuse.

## Allowed files and paths

- `src/lib/supabase.ts`, `src/lib/env.ts`, `src/types/database.ts` and related type-only modules
- `backend/websearch_service/app/services/auth.py`
- `backend/websearch_service/app/services/supabase_client.py`
- `backend/websearch_service/alembic/**` when policies are versioned there
- `sql/**` as **read-only** historical reference

## Required reading (before edits)

- `backend/websearch_service/app/services/auth.py` — production invariants (`AUTH_REQUIRED`, forbidden `VITE_*` service role on server).
- `src/lib/supabase.ts` — schema accessors and demo-mode behavior.
- `docs/adr/ADR-003-supabase-over-firebase-self-hosted-postgresql.md` for platform context.
- Relevant Alembic revisions that last touched the policies you are modifying.

## Workflow (ordered)

1. Write a short **threat model**: anon key + RLS, authenticated user JWT, service role on server only.
2. Verify **user identity** for privileged backend operations comes from **verified JWT claims**, not from unauthenticated request body fields.
3. Ensure the frontend uses the **minimal** schema client for each query; avoid introducing service-role keys in the browser.
4. For policy changes: prefer **tightening** or explicit role separation; document any intentional relaxation with product/security sign-off (escalate if missing).
5. Align migrations (Alembic) with runtime expectations; do not rely on manual `sql/` application for production unless explicitly human-directed.

## Commands

Always run the applicable gates from root `AGENTS.md` §4 for touched layers.

Frontend-leaning changes:

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

Backend-leaning changes:

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

**Integration tests** (`pytest tests/integration/`) require secrets and environment setup per `.github/workflows/integration-tests.yml`. Run only when configured locally; otherwise document manual verification steps.

## Forbidden actions

- Shipping or documenting `SUPABASE_SERVICE_ROLE_KEY` or provider API keys to the frontend.
- Setting `AUTH_REQUIRED=false` in any committed configuration intended for production.
- Using `sql/*.sql` as the default production migration path instead of Alembic.

## Done when

- Policies, grants, and code paths are consistent across DB definitions and application usage.
- Automated tests pass where available; where integration tests cannot run, provide **concrete manual verification** steps (queries, expected results).

## Required evidence in the final response

- Threat model summary (three bullets maximum).
- Files and migrations touched.
- Commands run and outcomes.
- Manual verification checklist when automated integration tests were not run.
