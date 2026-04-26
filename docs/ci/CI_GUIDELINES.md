# CI / CD Guidelines — How to keep every pipeline green

This document is the operating manual for the GitHub Actions pipelines under
`.github/workflows/`. Read it before opening a PR; run the listed commands
locally so CI never sees a regression first.

The guarantees in this file should match `AGENTS.md` §4. If they ever drift,
treat that as a bug — open a PR to reconcile, do not silently lower a gate.

---

## 1. Pipeline inventory

| Workflow file                       | Trigger                          | What it gates                                                                                  |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ci.yml`                            | push/PR to `main`/`develop`/`staging` | Frontend lint + type + tests + build, OpenAPI drift, backend tests + Alembic, Docker build smoke |
| `lint.yml`                          | push/PR (any branch)             | ESLint zero-warnings, `tsc --noEmit`, lint-disable budget                                      |
| `e2e.yml`                           | push/PR to `main`/`develop`      | Playwright Chromium smoke suite against a mocked Vite dev server                               |
| `security.yml`                      | push/PR (any branch)             | `npm audit` (prod), `pip-audit` (backend), `bandit` static security scan                       |
| `docker-build.yml`                  | PR touching backend/Dockerfile   | Docker image builds (backend + frontend) and `docker compose config` validation                |
| `integration-tests.yml`             | push to `main`/`staging`         | Backend integration tests against the test Supabase project                                    |
| `deploy-staging.yml`                | push/PR to `staging`             | Railway staging deploy + full Playwright suite against the live staging URL                    |
| `deploy.yml`                        | push to `main` / tags            | Build & push GHCR images, Vercel prod deploy, Railway prod deploy                              |
| `promote-to-prod.yml`               | manual                           | Opens a `staging → main` promotion PR                                                          |
| `dast.yml`                          | weekly cron + manual             | OWASP ZAP baseline scan against staging                                                        |
| `load-tests.yml`                    | manual                           | k6 chat / search / paper-trading load tests                                                    |

---

## 2. Local pre-flight (run from repo root)

Run these before pushing. They mirror `ci.yml` exactly.

```bash
# Frontend
npm ci --ignore-scripts
npm run lint:ci          # = lint.yml + ci.yml frontend job
npm run type-check       # = lint.yml + ci.yml frontend job
npm run test:coverage    # = ci.yml frontend job (enforces vitest thresholds)
npm run build            # = ci.yml frontend job

# OpenAPI drift (only required if FastAPI routes/models/metadata changed)
python backend/websearch_service/export_openapi.py
npm run generate:api-types
git diff --exit-code docs/openapi.json src/lib/generated/

# Backend
cd backend/websearch_service
pip install -r requirements.txt
pytest tests/ -v          # pytest.ini supplies coverage + threshold

# Alembic (only required if migrations changed)
export ALEMBIC_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/advisor_ci
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

Convenience: `npm run validate` runs lint + type-check + test (without
coverage). Use it for quick local iteration; use `npm run test:coverage`
to actually match CI.

---

## 3. Per-pipeline rules

### 3.1 Frontend quality (`ci.yml#frontend`, `lint.yml`)

- **ESLint must be zero-warning.** Do not introduce `eslint-disable` to silence
  warnings; fix the cause. The repo-wide budget is **10 disables** (enforced in
  `lint.yml`); when you must add one, document why on the same line.
- **`tsc --noEmit` must pass.** No `// @ts-ignore` without a comment explaining
  the constraint and a follow-up.
- **Coverage thresholds** (in `vite.config.ts`) are a *baseline floor*, set
  just below current actual coverage so any regression fails CI. Current floor:
  - `lines: 45`, `branches: 40`
  - **Ratchet up** (don't down) when you add tests. Open a small PR that bumps
    the threshold to the new floor.
- **Build** must succeed with the production env (`VITE_*` vars from secrets).
  Do not introduce code that references secrets at build time but is not
  declared as a `VITE_*` build arg in both `ci.yml` and `deploy.yml`.

### 3.2 OpenAPI drift (`ci.yml#frontend`)

If you touch FastAPI routes, Pydantic models, or any OpenAPI-relevant metadata:

1. Regenerate: `python backend/websearch_service/export_openapi.py`
2. Regenerate types: `npm run generate:api-types`
3. Commit both `docs/openapi.json` and `src/lib/generated/api-types.ts` in the
   same PR as the backend change.

CI fails fast with a clear error message if either file is stale. Never
"fix" this by reverting the regenerated artifacts.

### 3.3 Backend tests (`ci.yml#backend`)

- All tests live under `backend/websearch_service/tests/` and run against a
  CI-managed Postgres 16 service (`advisor_ci` database).
- `pytest.ini` is the **single source of truth** for coverage. Do not pass
  `--cov-fail-under` from the workflow (CI parity is preserved by reading the
  ini file). Current threshold: **`74%`** branch coverage of `app/`.
- When new code drops coverage below the threshold, add tests; do not lower
  the threshold without explicit human approval.
- Alembic must `upgrade head` cleanly and `alembic check` must report no
  pending autogen diff.

### 3.4 Security scans (`security.yml`)

Three jobs:

1. **`node-audit`** — `npm audit fix --package-lock-only --omit=dev --omit=optional`
   then `npm audit --omit=dev --omit=optional --audit-level=high`. The auto-fix
   step rewrites `package-lock.json` in CI but does not commit. To eliminate
   audit noise in PRs, run the same command locally and commit the lockfile
   when transitive vulns are patched upstream.
2. **`python-audit`** — `pip-audit -r backend/websearch_service/requirements.txt`.
   When a CVE is reported, prefer **bumping the pinned version** in
   `requirements.txt`. If no fix is available upstream, document the
   acceptance in this file with an expiry date and add it to `--ignore-vuln`.
3. **`python-bandit`** — `bandit -r backend/websearch_service/app -ll`
   (medium+ severity fails the job). For unavoidable findings (e.g.
   admin-only SQL string assembly that downstream re-validates), use
   `# nosec BXXX` on the offending line with a one-line justification.
   Do **not** add bandit-wide skips.

### 3.5 Docker (`docker-build.yml`, `ci.yml#docker-build`)

- Runs only when `backend/**` or any `deployment/Dockerfile*` changes.
- The frontend image needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  build args — placeholders are fine for the smoke build.
- `docker compose -f deployment/docker-compose.yml config` must succeed; this
  catches YAML and env-variable typos before deploy.

### 3.6 E2E (`e2e.yml`, `deploy-staging.yml#e2e`)

- `e2e.yml` runs on every PR. It boots Vite via `playwright.config.ts`'s
  `webServer` block; backend calls are mocked at the browser layer
  (`e2e/utils/mock-supabase.ts`). No external services required.
- `deploy-staging.yml#e2e` runs the **same suite** against the deployed
  staging URL after a successful Railway deploy, then comments the result
  on the PR.
- New tests must work in both modes. Use `process.env.PLAYWRIGHT_BASE_URL`
  to detect the staging mode if you need to skip mock-only assertions.
- **TODO (stabilisation):** the mocked-Supabase suite is currently flagged
  `continue-on-error: true` in `e2e.yml` while the timing on CI runners is
  triaged. The job still uploads the playwright HTML report as an artifact;
  download it to debug. Remove `continue-on-error` once the suite is
  reliably green on a clean run.

### 3.7 Deploy (`deploy.yml`, `deploy-staging.yml`)

- **Never** push directly to `main`. Use the `promote-to-prod` workflow to
  open a `staging → main` PR; merge after CI green and review.
- `deploy.yml` requires the following secrets — keep them in sync with
  `deployment/DEPLOYMENT.md`:
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  - `RAILWAY_TOKEN`
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
    `VITE_PYTHON_API_URL`, `VITE_WEBSEARCH_API_URL`
- `deploy-staging.yml` additionally needs `STAGING_FRONTEND_URL`,
  `STAGING_BACKEND_URL`, and `RAILWAY_STAGING_SERVICE`.

---

## 4. When CI fails — triage in this order

1. **Read the failing step's logs**, not the summary. Most failures point to a
   single line of code or config.
2. **Reproduce locally** with the exact command from the workflow file (see
   §2). If you cannot reproduce locally:
   - Check the OS / Node / Python versions match (`NODE_VERSION: '20'`,
     `PYTHON_VERSION: '3.12'` in `ci.yml`).
   - Check whether the failing step depends on a secret or service the
     workflow provides (Postgres service container, Supabase test project).
3. **Fix the root cause.** Forbidden shortcuts:
   - Lowering coverage thresholds without human approval.
   - Adding `--max-warnings <N>` to silence ESLint or removing
     `--exit-code` from the OpenAPI drift check.
   - Disabling, skipping, or adding `if: false` to a security job.
   - Committing regenerated artifacts (`docs/openapi.json`,
     `src/lib/generated/`) without their source change.
   - Bypassing the backend Alembic check by editing migrations after they
     have been deployed.
4. **If the failure is a flake** (network, transient registry error, OSV
   timeout): re-run the job once. If it flakes a second time, treat it as a
   real bug and open an issue.

---

## 5. Adding a new check / workflow

When adding a new workflow:

1. Place it in `.github/workflows/` with a `concurrency` group keyed by
   `github.ref` so duplicate runs are cancelled.
2. Use pinned major versions for actions
   (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`,
   `docker/build-push-action@v5`).
3. Cache `npm` and `pip` (see existing workflows for the pattern).
4. Add an entry to §1 of this file.
5. Add the local-equivalent command to §2 if it's PR-blocking.

---

## 6. Coverage ratchet — process for raising the floor

The `lines`/`branches` and `--cov-fail-under` thresholds are intentionally
set to *current actual coverage minus a small buffer*. To raise them:

1. Add the new tests in a focused PR.
2. Run `npm run test:coverage` and `pytest tests/ -v` locally; note the new
   coverage numbers.
3. In a **separate, single-purpose PR**, bump:
   - `vite.config.ts` → `coverage.thresholds.{lines,branches}`
   - `backend/websearch_service/pytest.ini` → `--cov-fail-under=<n>`
4. Mention in the PR description what the new floor is and which area
   improved (so the next ratchet PR knows what to target).

Never ratchet the floor *down* without an explicit, time-boxed exception
recorded in this file.

---

## 7. Active gates summary (quick reference)

| Gate                  | Tool                          | Threshold / mode               |
| --------------------- | ----------------------------- | ------------------------------ |
| Frontend lint         | ESLint                        | `--max-warnings 0`             |
| Frontend types        | `tsc --noEmit`                | zero errors                    |
| Frontend tests        | Vitest                        | all pass                       |
| Frontend coverage     | Vitest v8 provider            | lines ≥ 45, branches ≥ 40       |
| Frontend build        | `vite build`                  | succeeds                        |
| OpenAPI drift         | `git diff --exit-code`        | no diff after regenerate       |
| Backend tests         | pytest                        | all pass                       |
| Backend coverage      | pytest-cov                    | branch coverage ≥ 74%          |
| Alembic               | `alembic upgrade head` + `check` | clean head, no autogen diff |
| Node audit            | `npm audit`                   | no high+ in prod deps          |
| Python deps           | `pip-audit`                   | no known vulns                 |
| Python static         | `bandit -ll`                  | no medium+ findings            |
| Frontend e2e          | Playwright (chromium)         | all pass (mocked + staging)    |
| Docker build          | `docker buildx`               | both images build              |

If a gate is missing from this table, it isn't actually enforced — file an
issue rather than relying on it.
