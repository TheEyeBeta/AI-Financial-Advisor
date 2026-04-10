# Skill: architecture-compliance

## When to use

- Before **large features** that span frontend, backend, and database.
- When reviewing a cross-cutting change for **invariant violations** (secrets, auth, migrations, OpenAPI).
- After major refactors to confirm **dependency directions** still hold.

## Do not use for

- Single-file typos or isolated style fixes.
- Tasks already narrowed to one layer with a more specific skill.

## Risk classification

**Medium** — misses here cause subtle production incidents (auth drift, wrong migration path, leaked keys).

## Allowed files and paths

- Read-only across `src/`, `backend/websearch_service/`, `sql/`, `deployment/`, `.github/workflows/`, `docs/`.
- Write **only** if the task includes fixes; otherwise report pass/fail with citations.

## Required reading (before assessment)

- Root `AGENTS.md` — architecture map and forbidden zones.
- `src/lib/supabase.ts` and `backend/websearch_service/app/services/auth.py`
- `sql/README.md` — Alembic authority vs `sql/`
- `.github/workflows/ci.yml` — contract and quality gates

## Workflow (ordered)

1. **Dependency direction:** Browser → FastAPI → external APIs (OpenAI, Tavily, Perplexity, etc.) and Supabase; no secrets in `VITE_*` for providers or service role.
2. **Data access:** Frontend uses anon key with RLS; backend uses verified JWTs for user identity on protected routes; service role only on server where already established.
3. **Schema evolution:** Alembic is authoritative; `sql/` is reference and manual verification unless humans direct otherwise.
4. **API contract:** FastAPI changes that affect clients must regenerate `docs/openapi.json` and `src/lib/generated/api-types.ts`.
5. **CI truth:** Local verification commands should cover the same dimensions as `ci.yml` for the layers touched.

## Commands

No single mandatory command; run the subset from `AGENTS.md` §4 that matches the areas under review. When auditing without edits, at minimum:

```bash
npm run lint:ci
npm run type-check
```

Add `npm run test`, `npm run build`, backend pytest, or Alembic checks when assessing those layers.

## Forbidden actions

- Signing off “compliant” without citing **specific files** for each invariant.
- Approving architecture drift to unblock a deadline without listing accepted risks and owners.

## Done when

- You produce a **pass/fail table** against each invariant below with file-level evidence.
- Failures include **exact** remediation guidance (which skill to apply next).

### Invariant checklist (must appear in output)

| Invariant | Evidence to cite |
|-----------|------------------|
| No provider/service-role secrets in frontend env | `config/env.example`, `src/lib/env.ts` usage |
| Backend JWT verification on privileged routes | `app/services/auth.py`, route `Depends` |
| Alembic over raw `sql/` for deploy | `sql/README.md`, `alembic/versions/` |
| OpenAPI drift gate respected | `export_openapi.py`, `generate:api-types`, CI step |
| Deploy topology consistent | `deployment/DEPLOYMENT.md`, `README.md` |

## Required evidence in the final response

- Pass/fail table with paths.
- Commands run (if any) and outcomes.
- Explicit list of **accepted risks** if any invariant is intentionally waived by product decision (must have been escalated to humans).
