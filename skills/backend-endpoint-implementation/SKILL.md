# Skill: backend-endpoint-implementation

## When to use

- Adding or changing a **FastAPI** route consumed by the SPA or external HTTP clients.
- Changing request/response **Pydantic** models, status codes, or router tags in ways that affect the public HTTP contract.

## Do not use for

- Purely internal Python refactors with no HTTP surface change (use normal `AGENTS.md` workflow and backend tests only).
- Database-only work (use `db-migration-safety-review`).
- AI chat streaming and proxy logic (use `ai-chat-pipeline-change`).

## Risk classification

**Medium–High** — authentication gaps, accidental data exposure, OpenAPI/type drift, CI failure on coverage or contract checks.

## Allowed files and paths

- `backend/websearch_service/app/**`
- `backend/websearch_service/tests/**`
- `docs/openapi.json` (via regeneration only)
- `src/lib/generated/api-types.ts` (via `npm run generate:api-types` only)

Do not expand scope into `src/**` except generated types and, if unavoidable, the single caller module (prefer keeping changes backend-only).

## Required reading (before edits)

- `backend/websearch_service/app/main.py` — how routers are mounted.
- `backend/websearch_service/app/services/auth.py` — `Depends` patterns and production constraints.
- The **most similar existing route module** to the one you are adding or changing.

## Workflow (ordered)

1. Identify the HTTP method, path, auth requirement, and error shape used by sibling endpoints.
2. Implement using the same router, dependency injection, and response patterns as nearby code.
3. Add or update **pytest** coverage for new branches and error paths.
4. If the HTTP contract changed: run OpenAPI export and TypeScript generation from the repo root; commit updated `docs/openapi.json` and `src/lib/generated/api-types.ts`.
5. Run verification commands below; fix failures before claiming completion.

## Commands (mandatory subset — run what applies)

From repository root:

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

If routes/models affecting OpenAPI changed:

```bash
python backend/websearch_service/export_openapi.py
npm run generate:api-types
git diff --exit-code docs/openapi.json src/lib/generated/ || exit 1
```

Full frontend gate (required if OpenAPI artifacts changed):

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

## Forbidden actions

- Adding a new externally reachable endpoint without an explicit **auth decision** documented in code (mirror existing `Depends` usage; do not invent bypasses).
- Hand-editing `src/lib/generated/api-types.ts` or `docs/openapi.json` instead of regeneration.
- Lowering `--cov-fail-under` or skipping tests to merge.

## Done when

- Pytest passes with coverage policy intact.
- OpenAPI and generated types match the implementation when the contract changed.
- ESLint, TypeScript, unit tests, and production build succeed whenever generated types or frontend callers changed.

## Required evidence in the final response

- List of files changed.
- Pytest command and outcome.
- If applicable: OpenAPI regeneration commands and confirmation that `git diff` on `docs/openapi.json` and `src/lib/generated/` is clean after regeneration.
- Any follow-up needed for deploy (env vars, CORS) called out explicitly.
