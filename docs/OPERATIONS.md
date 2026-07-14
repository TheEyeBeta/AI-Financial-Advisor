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
| Optional / feature-gated | Tavily, Perplexity, DataAPI creds, Redis, Sentry DSNs, PostHog | same; Redis strongly recommended (shared rate limits + WebSocket tickets) |

## Worker / scheduler topology

- Web workers: uvicorn, `WORKERS` env (default 1).
- Schedulers (intelligence 6h, ranking 01:00 UTC, memory 15m) run **only**
  where `SCHEDULER_ENABLED=true` — exactly one replica (or the dedicated
  `run_scheduler.py` process). The admin job worker runs in the scheduler
  process.
- With >1 web worker/replica and no Redis, rate limiting and WebSocket
  tickets fall back to process-local state — configure `REDIS_URL` in
  production.

## Health, monitoring, telemetry

- `/health/live` — liveness (no external calls). `/health/ready` — readiness:
  config validation, Supabase ping, **schema revision match** (deployed
  Alembic head vs `public.alembic_version`; mismatch = not ready), rate-limit
  backend, startup completion; search-provider status is informational.
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
  rate limiting (Redis or single-worker local mode).
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
- No billing/quota beyond rate limits; per-user AI quota is a launch
  threshold tracked in #216.
