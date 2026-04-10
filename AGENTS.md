# AGENTS.md — AI-Financial-Advisor (Codex / agent constitution)

You are working in **AI-Financial-Advisor**: a Vite + React + TypeScript frontend, a **FastAPI** backend in `backend/websearch_service`, **Supabase** (PostgreSQL + Auth + RLS), and **GitHub Actions** CI. Treat this file as **hard constraints**. If a task conflicts with it, **stop** and ask a human.

## 1. Architecture map (evidence-based)

- **Frontend:** `src/` — Vite app, Tailwind, shadcn/ui, TanStack Query, React Router.
- **Backend:** `backend/websearch_service/` — FastAPI, AI proxy (`app/routes/ai_proxy.py`), search, trade engine routes, scheduled jobs in `app/main.py`.
- **Client ↔ API:** Browser calls backend via `VITE_PYTHON_API_URL` / `VITE_WEBSEARCH_API_URL` (see `src/lib/env`, `src/services/api.ts` and related modules).
- **Database:** Six logical schemas used from the app: `core`, `ai`, `trading`, `market`, `academy`, `meridian` (see `src/lib/supabase.ts`). **Authoritative schema history:** `backend/websearch_service/alembic/`. **`sql/` is reference and manual verification only** — see `sql/README.md`.
- **Deploy:** Frontend → Vercel; backend → Railway or Render; DB/Auth → Supabase. Details: `deployment/DEPLOYMENT.md`.
- **Generated API types:** `docs/openapi.json` + `src/lib/generated/api-types.ts` (CI enforces drift).

## 2. Dependency and change-direction rules

- **Allowed:** Minimal edits in the smallest surface that fixes the issue; reuse existing patterns (hooks, `apiClient`, FastAPI routers, Pydantic models, Alembic revisions).
- **Forbidden:** Broad refactors, renaming public API shapes without updating OpenAPI + generated types, “while we’re here” cleanups unrelated to the task.
- **Never:** Add model/provider secrets to `VITE_*` or commit secrets to the repo. Never weaken production auth (`AUTH_REQUIRED`, JWT verification, RLS) to “make it work.”

## 3. Forbidden zones (unless the task explicitly requires touching them and you follow the matching skill)

- **Production platform dashboards** (Vercel/Railway/Supabase) — no changes from agents without human-run steps; document what to set instead.
- **Applying raw `sql/*.sql` to production** as the primary migration path — use Alembic; use `sql/` for inspection or documented manual checks only.
- **Disabling security checks** in CI workflows to pass builds.
- **Shipping service-role keys to the browser** or reading `user_id` from unverified client input on privileged backend paths (backend must use verified JWT claims — see `app/services/auth.py`).

Read **local** `AGENTS.md` in the directory you edit (`src/`, `backend/websearch_service/`, `sql/`, `deployment/`) before substantive work.

**Task playbooks:** recurring workflows live under `skills/` — start at `skills/INDEX.md` and pick the narrowest skill.

## 4. Mandatory verification (run from repo root unless noted)

After **any** change that could affect types, lint, tests, or API contracts:

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

**CI parity:** the frontend job in `.github/workflows/ci.yml` runs `npm run test:coverage` in addition to the steps above. Local `npm run test` is fine; use `npm run test:coverage` when matching CI’s unit-test step exactly.

If you changed **FastAPI routes, models, or OpenAPI-relevant metadata**:

```bash
python backend/websearch_service/export_openapi.py
npm run generate:api-types
# Ensure no drift vs committed artifacts (same check as CI)
git diff --exit-code docs/openapi.json src/lib/generated/ || exit 1
```

If you changed **Python service code** (always for backend tasks):

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

If you changed **Alembic migrations**:

```bash
cd backend/websearch_service
# Against a disposable local Postgres with ALEMBIC_DATABASE_URL set:
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

**Stop condition:** If a check fails, fix root cause or stop — do not silence lint, skip tests, or lower coverage thresholds without human approval.

## 5. Workflow (every task)

1. **Read** relevant local `AGENTS.md` and the smallest set of existing files that define the pattern you will extend.
2. **Plan** the smallest diff; list files you will touch before editing.
3. **Implement** with matching style and abstractions.
4. **Verify** with the commands in §4 applicable to your diff.
5. **Report** using the output contract below.

## 6. Escalation (stop and ask a human)

- Ambiguous product/security tradeoff (RLS policies, auth bypass, data deletion).
- Need for production secrets, key rotation, or dashboard configuration you cannot perform locally.
- Migrations that may need downtime, backfill, or multi-phase deploy.
- CI failures you cannot reproduce locally after a reasonable attempt.

## 7. Output contract (final message)

Your final response must include:

1. **What changed** — files touched (paths), one sentence each.
2. **Why** — link to requirement or bug.
3. **Verification evidence** — exact commands run and pass/fail; if skipped, say why (and it must be justified).
4. **Risks / follow-ups** — migrations, env vars, manual Supabase SQL, or deploy ordering.

Do not claim tests passed without having run them or explaining why they were inapplicable.
