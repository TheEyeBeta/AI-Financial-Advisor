# Lens (AI Financial Advisor) — Operational Guide

**Owner:** TheEyeBeta · **Last verified:** 2026-07-13 (issues #204–#214) · **Review cadence:** every release (see checklist below)

This is the **canonical operational document**. Older readiness/test write-ups
(`docs/PRODUCTION_READINESS_REVIEW.md`, `docs/tests/TEST_SUMMARY.md`) are
archived historical audits — where they conflict with this document, this
document wins.

## Architecture (verified against code)

- **Frontend:** Vite + React + TypeScript SPA (`src/`), deployed on Vercel
  (`vercel.json`: security headers incl. enforced CSP, SPA rewrites).
- **Backend:** FastAPI service `backend/websearch_service` (AI proxy, search,
  news, trade-engine endpoints, admin), deployed on Railway from its
  `Dockerfile` (non-root, digest-pinned base, container healthcheck).
- **Database/Auth:** Supabase Postgres with six schemas (`core`, `ai`,
  `trading`, `market`, `academy`, `meridian`), RLS everywhere, JWT-verified
  backend auth (`app/services/auth.py`).
- **Migrations:** Alembic (`backend/websearch_service/alembic/`) is the single
  schema authority; `sql/` is reference-only. Backup/restore/roll-forward:
  `docs/DB_RECOVERY.md`.
- **Market data:** TheEyeBetaDataAPI (external substrate) with Supabase
  snapshot fallback; endpoints return explicit availability metadata, never
  silent stubs.

## Environments and required services

| Concern | Local dev | Production |
|---|---|---|
| Frontend env | `.env` from `.env.example` | Vercel project env vars |
| Backend env | `backend/websearch_service/.env.example` | Railway env vars — startup **fails fast** if required vars are missing/placeholder (`app/config.py`) |
| Required in prod | — | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`, `CORS_ORIGINS`, `TRUSTED_HOSTS`, `ENVIRONMENT=production` |
| Optional / feature-gated | Tavily, Perplexity, DataAPI creds, Redis/Valkey, Sentry DSNs, PostHog | same; Valkey (Redis-compatible, `REDIS_URL`) strongly recommended (shared rate limits + WebSocket tickets) — see `deployment/DEPLOYMENT.md` |

## Worker / scheduler topology

- Web workers: uvicorn, `WORKERS` env (default 1).
- Schedulers (intelligence 6h, ranking 01:00 UTC, memory 15m) run **only**
  where `SCHEDULER_ENABLED=true` — exactly one replica (or the dedicated
  `run_scheduler.py` process). The admin job worker runs in the scheduler
  process.
- With >1 web worker/replica, rate limiting and WebSocket tickets require a
  shared store, and the service will fail to start without one
  (`validate_rate_limit_configuration()` raises `FATAL` rather than
  degrading) — configure `REDIS_URL` (pointed at a Valkey instance; see
  `deployment/DEPLOYMENT.md`) in production.

## Health, monitoring, telemetry

- `/health/live` — liveness (no external calls). `/health/ready` — readiness:
  config validation, Supabase ping, **schema revision match** (deployed
  Alembic head vs `public.alembic_version`; mismatch = not ready), rate-limit
  backend, **global AI budget guard backend** (`ai_budget_guard` component;
  see `docs/ai/AI_CONTROLS.md` §1), startup completion; search-provider
  status is informational.
- Global AI spend/capacity: `GET /api/admin/ai-budget/status` (admin/service-role
  JWT) — circuit-breaker state, daily/monthly spend vs budget, request/token
  counters, concurrency. Admin-authorized time-bounded override:
  `POST`/`DELETE /api/admin/ai-budget/override` (audited, disabled by default).
  See `docs/runbooks/cost-spike.md` and `docs/runbooks/redis-unavailable.md`.
- Frontend Sentry: privacy-hardened (no default PII, redaction, sampling
  policy) — `docs/security/TELEMETRY_PRIVACY.md`. Backend Sentry via
  `SENTRY_DSN`, release tagged from `APP_VERSION`.
- Release identification: set `VITE_RELEASE_SHA` (or expose Vercel system env)
  and `APP_VERSION` (backend) to the deployed git SHA.

## Security controls (implemented and CI-enforced)

- CSP without `unsafe-inline` scripts + headers regression test; gitleaks
  secret scanning on every PR/push (`docs/security/SECRET_SCANNING.md`).
- WebSocket auth via single-use tickets; JWTs never in URLs (#205).
- Dependency reproducibility: npm lockfile + hash-locked pip requirements +
  digest-pinned images + SHA-pinned actions; Dependabot update PRs (#206).
- DB-level invariants: positive quantities/prices, oversell protection
  triggers (#207); RLS validated in DB-level tests run by CI.

## Quality gates (all blocking in CI)

| Gate | Where |
|---|---|
| ESLint (0 warnings), tsc, vitest (coverage floors in `vite.config.ts`), build | `ci.yml` frontend |
| OpenAPI drift | `ci.yml` frontend |
| Bundle-size budgets | `ci.yml` frontend (`npm run test:bundle-budget`) |
| pytest (coverage floor in `pytest.ini`) + Alembic fresh migrate ×2 + DB constraint tests | `ci.yml` backend |
| Container build + prod-config fail-fast smoke + `/health/live` smoke | `ci.yml` docker-build |
| Playwright: desktop Chromium (full), mobile Chromium + Firefox (critical suite), axe a11y | `e2e.yml`; matrix in `docs/tests/BETA_SUPPORT_MATRIX.md` |
| npm audit / pip-audit on committed locks, lock freshness, bandit, gitleaks | `security.yml` |

Evidence = the checks on each PR/commit in GitHub Actions; no percentages are
claimed in docs that CI does not enforce.

## Implemented / partial / disabled (honest status)

- **Implemented:** email+password and Google auth, onboarding, IRIS chat with
  idempotent transactional turns, paper trading via trade journal, Academy,
  news (cursor-paginated), admin panel with durable jobs, readiness probes,
  rate limiting (Valkey/Redis-compatible, or single-worker local mode).
- **Partial:** live Trade Engine data (depends on external DataAPI
  availability — UI shows explicit degraded/unavailable states);
  authed-page performance/a11y automation (signed-out surfaces automated;
  authed pages run in journey mocks and skip when mocks render skeletons);
  WebKit/iOS coverage is manual (`BETA_SUPPORT_MATRIX.md`).
- **Planned / not present:** billing/monetization, WebSocket live price
  streaming (endpoint is an authenticated stub), multi-region.
- **Load tests:** scaffolding exists (`tests/load/`); no benchmark numbers are
  claimed until a staging run populates `LOAD_TEST_RESULTS.md`.

## Deploy / rollback

- Frontend: Vercel GitHub integration on `main`. Rollback = redeploy previous
  Vercel deployment.
- Backend: Railway GitHub integration (Dockerfile). Rollback = redeploy
  previous image **only if** no forward-only migration shipped in between —
  otherwise roll forward (`docs/DB_RECOVERY.md`).
- Migrations run via Alembic against the Supabase database **before** the new
  backend serves traffic; readiness blocks a mismatched instance.

## Release checklist

- [ ] CI green on the exact release SHA (all gates above).
- [ ] New migrations verified on a disposable Postgres (fresh + re-run) and
      backup taken per `docs/DB_RECOVERY.md`.
- [ ] Env template diffs applied to Railway/Vercel (compare `.env.example`s).
- [ ] Manual acceptance pass from `docs/tests/BETA_SUPPORT_MATRIX.md`
      (keyboard, zoom, iOS spot-check) for UI-affecting releases.
- [ ] **Docs review:** this file's claims still match the code; update
      "Last verified" date. Archive anything superseded.
- [ ] Post-deploy: `/health/ready` is `ready`, `schema_revision.status: ok`,
      release SHA visible in Sentry events.

## Known beta limitations

- Single-region (Vercel default + one Railway region).
- Live market data depends on one upstream provider; degraded states are
  explicit but there is no secondary live provider.
- In-process news cache (per worker) — acceptable at beta scale.
- Per-user AI quota (rate limiter) plus a **global** cross-tenant AI
  request/token/concurrency limiter and an internal USD spend circuit
  breaker (`docs/ai/AI_CONTROLS.md` §1); no UI dashboard yet beyond the
  read-only admin status endpoint — a frontend admin page for it is a
  follow-up, not yet built.

## Reliability program status (SLOs, dashboards, load tests, DR)

Honest status as of 2026-07-16 (reviewed separately from this document's
`Last verified` header above, which tracks issues #204–#214 specifically) —
no claims here are backed by a live run unless a results doc is linked.

- **Critical-journey test matrix:** `docs/tests/CRITICAL_JOURNEYS_MATRIX.md` —
  first-pass audit of test coverage against the required journey list;
  several gaps remain open (see that file).
- **SLOs (availability, latency, error-rate targets):** not yet formally
  defined against a chosen observability stack. Sentry is wired
  (frontend + backend, `SENTRY_DSN`); there is no metrics/dashboard stack
  (Grafana, Datadog, etc.) configured yet. Defining SLOs against dashboards
  that don't exist would be an unverifiable claim — this needs a human
  decision on tooling before the dashboards/alerts checklist can be built.
- **Load testing:** scaffolding exists in `tests/load/` (k6 scripts for chat,
  paper trading, search). No run against a dedicated staging environment has
  been executed or recorded; no `LOAD_TEST_RESULTS.md` exists. Running Test
  profiles A–E requires a dedicated staging Railway/Supabase/Valkey stack —
  out of scope for an agent session without those credentials.
- **Recovery drill:** `docs/DB_RECOVERY.md` documents a *rehearsed-on-disposable-Postgres*
  forward-recovery procedure (fresh install, idempotent re-run, downgrade/upgrade
  round-trip, RLS validation). It has **not** been exercised against a real
  production backup restored into an isolated Supabase project — that is a
  human-run exercise requiring production backup access and a throwaway
  Supabase project, per `AGENTS.md` §3 (production platform changes are a
  forbidden zone for agents without human-run steps).

None of the above should be marked done in release checklists until a dated,
linked results document exists for each.
