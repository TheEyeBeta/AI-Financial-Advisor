# backend/websearch_service — Backend agent rules

## Scope

- **In scope:** `backend/websearch_service/**` (FastAPI app, tests, Alembic, Dockerfile, service `.env.example`).
- **Touches frontend contract:** Any change to HTTP paths, request/response models, or status codes used by the SPA must update OpenAPI artifacts and regenerated TS types.

## Auth and secrets (non-negotiable)

- Study `app/services/auth.py` before changing authentication behavior.
- **Production:** `AUTH_REQUIRED` must not be disabled; do not configure `VITE_SUPABASE_SERVICE_ROLE_KEY` on the server.
- **JWT user identity:** Derive user id from verified token claims — not from client-supplied body fields for protected operations.
- **Secrets:** `OPENAI_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` stay server-side only.

## Migrations

- **Authoritative:** `alembic/versions/*.py`.
- **Not authoritative for deploy:** `../../sql/*.sql` (reference; see `sql/README.md`).
- New DB work: add a new Alembic revision; justify RLS and grants in the migration or in paired documentation if the change is policy-heavy.

## OpenAPI

If routers, models, or response types visible to the SPA change:

```bash
python backend/websearch_service/export_openapi.py
npm run generate:api-types
git diff --exit-code docs/openapi.json src/lib/generated/
```

## Verification

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

With Postgres available for migration work:

```bash
cd backend/websearch_service
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

## Local stack (test without Railway)

Use two terminals from the **repo root**:

1. **Backend (latest `subagents.py` / `ai_proxy.py`):** `npm run start:backend`  
   Serves **`http://localhost:7000`** by default (avoids common collisions on 8000). Override: `PORT=8000 npm run start:backend`. Resolves a venv from `backend/websearch_service/.venv` or the **repo root** `.venv`. `app/main.py` loads env from `backend/websearch_service/.env` or the **repo root** `.env` (same keys as Railway: `OPENAI_API_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, etc. — see `.env.example` in this folder).

2. **Frontend forced to local API:** `npm run dev:local`  
   Sets `VITE_PYTHON_API_URL=http://localhost:7000` for that Vite process only (your committed `.env` can still point at Railway). Optional override: `VITE_PYTHON_API_URL_LOCAL=https://host:port npm run dev:local`.

## Forbidden

- Disabling rate limits, audit logging, or auth middleware to speed up local dev in committed code (use local env config documented in this file instead).
- Adding endpoints that return service-role clients or raw secrets to callers.

## Skills

- `skills/backend-endpoint-implementation/SKILL.md`
- `skills/ai-chat-pipeline-change/SKILL.md` for `app/routes/ai_proxy.py` and related services
- `skills/db-migration-safety-review/SKILL.md` for Alembic
- `skills/supabase-rls-auth-review/SKILL.md` for policy and JWT flows
