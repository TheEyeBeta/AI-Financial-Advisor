# Skill: deployment-readiness

## When to use

- Preparing a **release** or verifying a branch is safe to deploy.
- Changing **deployment** artifacts under `deployment/` or Docker-related paths.
- Confirming **environment variable** parity across Vercel (frontend) and Railway/Render (backend) against documented templates.

## Do not use for

- Implementing unrelated application features.
- Performing live dashboard changes (document instructions for humans instead).

## Risk classification

**Medium–High** — wrong CORS or trusted hosts, missing secrets, schema not upgraded before code expects new columns.

## Allowed files and paths

- `deployment/**`
- `config/env.example`, `backend/websearch_service/.env.example`
- `README.md` and `deployment/DEPLOYMENT.md` for cross-checking instructions
- Application code **only** when required to align startup behavior with deploy docs (minimal diff)

## Required reading (before edits)

- `deployment/DEPLOYMENT.md`
- `README.md` environment sections
- `deployment/AGENTS.md`
- Root `AGENTS.md` forbidden zones for dashboards and secrets

## Workflow (ordered)

1. Build a **checklist**: frontend env (`VITE_*`), backend secrets (OpenAI, Tavily, Perplexity, Supabase server keys, JWT verification), CORS/trusted hosts, ports, health endpoints.
2. Confirm **order of operations**: run Alembic migrations (or equivalent managed process) before enabling code that depends on new schema.
3. For Docker Compose edits: validate compose file syntax locally.
4. List **human-only** steps explicitly (Vercel/Railway/Supabase dashboards); do not assume agent access.
5. Run verification commands below for the components touched.

## Commands

Frontend production build (matches Vite pipeline):

```bash
npm run build
```

Backend tests when server code changed:

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

Docker Compose validation when compose files changed:

```bash
docker-compose -f deployment/docker-compose.yml config
```

When migrations ship with the release:

```bash
cd backend/websearch_service
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

(use a disposable database with `ALEMBIC_DATABASE_URL` set)

## Forbidden actions

- Committing real `.env` files or secrets.
- Disabling `TRUSTED_HOSTS`, CORS, or auth in production to silence errors.
- Telling operators to apply `sql/*.sql` as the primary production migration path.

## Done when

- Checklist is complete with **owner** for each human step.
- Local builds/tests relevant to the release pass.
- Migration order and rollback expectations are stated when schema changes.

## Required evidence in the final response

- Environment variable diff table (name → where set → purpose), drawn from documented templates only.
- Commands run and outcomes.
- Explicit **deploy order** (migrations vs app deploy) and any rollback notes.
