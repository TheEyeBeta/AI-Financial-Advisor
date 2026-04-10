# Skill: frontend-bugfix

## When to use

- Fixing incorrect UI behavior, React state, hooks, or routing under `src/`.
- Addressing failing or missing **Vitest** tests tied to frontend logic.
- Adjusting **Playwright** E2E tests or flows when user journeys are in scope.

## Do not use for

- Changes to FastAPI routes or shared HTTP contracts (use `backend-endpoint-implementation` and OpenAPI regeneration).
- Database migrations or RLS (use `db-migration-safety-review` / `supabase-rls-auth-review`).
- AI proxy / streaming server logic (use `ai-chat-pipeline-change`).

## Risk classification

**Low–Medium** — regressions in auth-gated flows, accidental extra network calls, or type errors if contracts are touched without backend alignment.

## Allowed files and paths

- `src/**`
- `e2e/**` when the defect is coverage by E2E or selectors need updating
- Frontend tests colocated with features as already practiced in the repo

**Read-only unless the task explicitly includes backend work:** `docs/openapi.json`, `src/lib/generated/**`.

## Required reading (before edits)

- `src/AGENTS.md`
- The smallest set of components/hooks involved in the bug’s data path.
- If Supabase is involved: `src/lib/supabase.ts` and the relevant schema helper (`aiDb`, `coreDb`, etc.).

## Workflow (ordered)

1. Reproduce the bug mentally or via tests; identify the **data source** (Supabase vs `apiClient` vs local state).
2. Apply the **minimal** code change; prefer existing hooks and service modules.
3. Add or update tests when logic is non-trivial or regression-prone.
4. Run verification commands; fix lint and types before finishing.

## Commands (mandatory)

From repository root:

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

If E2E coverage is relevant to the fix:

```bash
npm run test:e2e
```

## Forbidden actions

- Adding provider or service-role secrets to `VITE_*` variables or source.
- Modifying `docs/openapi.json` or generated `api-types.ts` without a corresponding backend change and regeneration.
- Large formatting-only or rename-only diffs across unrelated files.

## Done when

- Lint, typecheck, unit tests, and build succeed.
- E2E runs succeed or the final response documents why E2E was not run (scope, environment, or time) and what was verified instead.

## Required evidence in the final response

- Files touched and how they fix the defect.
- Commands run with outcomes.
- Any manual test steps the user should perform in the browser.
