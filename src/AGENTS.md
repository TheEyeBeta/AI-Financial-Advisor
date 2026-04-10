# src/ — Frontend agent rules

## Scope

- **In scope:** `src/**`, root `index.html`, Vite config at repo root, Tailwind/PostCSS config, `e2e/**` when the task is UI behavior.
- **Read-mostly for contract changes:** `docs/openapi.json`, `src/lib/generated/**` — regenerate via `export_openapi.py` + `npm run generate:api-types`, never hand-edit generated types unless the repo already does so elsewhere (it should not).

## Architecture reminders

- **Supabase:** `src/lib/supabase.ts` exposes `supabase` plus `aiDb`, `coreDb`, `tradingDb`, `marketDb`, `academyDb`, `meridianDb`. Use the **smallest schema surface** needed.
- **Config:** `src/lib/env.ts` — never introduce `VITE_OPENAI_*` or service-role keys.
- **HTTP:** Prefer existing `apiClient` / service modules over ad-hoc `fetch` when those patterns exist for the same backend.

## Forbidden

- Embedding API keys or service-role credentials in frontend code or `VITE_*` env vars.
- Bypassing RLS by routing privileged operations through the browser if the backend is the trusted path for that operation.
- Large stylistic refactors (global formatting, sweeping renames) unrelated to the task.

## Verification

From repo root:

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

If the task touches user flows covered by E2E:

```bash
npm run test:e2e
```

## When to use skills

- General bugfix / UI behavior: `skills/frontend-bugfix/SKILL.md`
- AI chat / streaming / advisor UX tied to backend proxy: `skills/ai-chat-pipeline-change/SKILL.md`
