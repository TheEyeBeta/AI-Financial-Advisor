# Clean-CI Evidence & Staging Handoff — Batch 3 close-out

**Tested revision (commit to deploy):** `0cc7c877785d8ff5abc370c392f0c4b72b08f24f`
**Branch:** `readiness/batch-1-3-execution` · **Parent:** `5bad7e9`
**Commit contents:** 71 files (64 new + 7 modified); EOL-agnostic diff `+5416 / −20`
(only real changes — no CRLF/EOL noise). Never report the pre-commit working-tree
state as the tested revision; the tested revision is `0cc7c87`.

> This document is a **handoff artifact** and is intentionally NOT part of the
> tested commit `0cc7c87` (so CI/staging run exactly what was verified).

---

## 1. Push + trigger clean CI  (USER ACTION — BLOCKED in sandbox)

The private remote (`git@github-theeyebeta-private:TheEyeBeta/AI-Financial-Advisor.git`)
is not reachable from this environment (push exit 128, SSH connection closed — no deploy
key). Run from a machine with push access:

```bash
git push -u origin readiness/batch-1-3-execution
# Open a PR to main (or staging); GitHub Actions runs the workflows below on the
# committed SHA 0cc7c87 with a fresh Linux `npm ci` / pip install (no host node_modules).
```

CI workflows that will execute (already in the repo): `ci.yml` (frontend quality+build,
backend tests+coverage, Alembic migration validation, Docker build), `lint.yml`,
`e2e.yml` (Playwright), `integration-tests.yml` (real Postgres), `security.yml`
(secret scan + audit), `dast.yml`, and the **new** `readiness-controls.yml`
(env-schema, evidence-schema, AI-provider network-guard).

## 2. Clean-CI evidence table

Status: **EXECUTED-CLEAN-LINUX** = run in this sandbox on Ubuntu 22.04 / Py 3.10.12
against the committed tree; **PENDING-CI** = will run on GitHub Actions after push.

| Check | Result | Status |
| --- | --- | --- |
| Commit SHA | `0cc7c877785d8ff5abc370c392f0c4b72b08f24f` | fixed |
| Branch | `readiness/batch-1-3-execution` | fixed |
| CI run identifier | (assigned by GitHub Actions on push) | PENDING-CI |
| Backend test count | 1247 passed / 41 skipped / 0 failed | EXECUTED-CLEAN-LINUX |
| Backend coverage | 76% global (auth 93%, budget 84%) | EXECUTED-CLEAN-LINUX |
| Backend migration validation | 36 migrations → head `0036` (real Postgres) | EXECUTED-CLEAN-LINUX |
| env-schema gate | safe=exit0 / unsafe=exit1 | EXECUTED-CLEAN-LINUX |
| evidence-schema gate | 19/19 digests verified | EXECUTED-CLEAN-LINUX |
| AI network-guard gate | blocks real provider host | EXECUTED-CLEAN-LINUX |
| Focused suites (8) | 342 passed (incl. `ai.chats` recovery fix) | EXECUTED-CLEAN-LINUX |
| Frontend type-check | `tsc --noEmit` exit 0 | EXECUTED-CLEAN-LINUX |
| Frontend `npm ci` | fresh Linux install | PENDING-CI |
| Frontend unit/component tests + coverage | vitest | PENDING-CI |
| ESLint | `lint:ci` | PENDING-CI |
| Production build | `vite build` | PENDING-CI |
| Accessibility automation | axe/e2e | PENDING-CI |
| Playwright e2e | `e2e.yml` | PENDING-CI |
| Secret scan | gitleaks (`security.yml`) | PENDING-CI |
| Security/DAST | `dast.yml` | PENDING-CI |

**Skipped/blocked checks:** frontend runtime (vitest/build/e2e/a11y) and secret/DAST
scans are PENDING-CI — they need the Linux runner's fresh `npm ci` and the CI secret
context, neither available in this sandbox (host `node_modules` is Windows-native).

## 3. Staging deployment handoff

### 3.1 Commit to deploy
`0cc7c877785d8ff5abc370c392f0c4b72b08f24f` (only after clean CI is green).

### 3.2 Required staging environment variables (names only — never commit values)
**Mandatory (startup fails without these / with unsafe values):**
`ENVIRONMENT` (=`staging`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`,
`CORS_ORIGINS` (exact staging frontend origin), `TRUSTED_HOSTS` (exact staging
backend host), `AUTH_REQUIRED` (=`true`), `ENABLE_DEBUG_ROUTES` (=`false`),
`REDIS_URL` **or** `RATE_LIMIT_REDIS_URL`, `APP_VERSION` (=deployed commit SHA),
`OPENAI_MAX_TOKENS` (server ceiling, e.g. `8000`).

**Recommended:** `OPENAI_CHAT_MODEL`, `OPENAI_CLASSIFIER_MODEL`, `OPENAI_TITLE_MODEL`,
`OPENAI_QUANT_MODEL`, `INSTANT_MODEL`, `BALANCED_MODEL`, `DEEP_MODEL`,
`AI_MODEL_PRICING_JSON`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `TAVILY_API_KEY`,
`PERPLEXITY_API_KEY`, `WEB_CONCURRENCY`.

**Cross-environment guard (recommended):** `PRODUCTION_RESOURCE_DENYLIST`
(comma-separated production project refs) so the validator rejects prod-in-staging.

**Must be false/unset in staging (validator flags as ERROR):**
`AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE`, `AI_BUDGET_ALLOW_IN_MEMORY`,
`ALLOW_IN_MEMORY_RATE_LIMIT` — staging must use a real shared Redis.

### 3.3 Sanitised validation command (run BEFORE deploy; never prints values)
```bash
# In the staging runtime, with staging env loaded:
cd backend/websearch_service && python -m app.env_validation --json
# Exit 0 required. Emits only variable NAME + present/safe + environment class.
```
Produce the sanitised config evidence report (variable name · present/missing ·
safe/unsafe · environment · redacted resource identity) from this output.

### 3.4 Deployment order
1. **Validate** staging env (§3.3) → must exit 0.
2. **Database:** `alembic -c alembic.ini upgrade head` against the staging DB
   (verify head = `0036_core_audit_events`).
3. **Backend:** deploy `0cc7c87`; confirm boot (`enforce_startup_environment` passes).
4. **Frontend:** deploy the built SPA pointed at the staging backend origin.
5. **Scheduler:** enable **only after** backend health + Redis are green (its prereqs).

### 3.5 Health-check commands
```bash
curl -fsS https://<staging-backend>/health        | jq .        # status ok + services + release
curl -fsS https://<staging-backend>/health/live    | jq .status  # "alive"
```

### 3.6 Readiness-check commands
```bash
curl -fsS https://<staging-backend>/health/ready | jq '{status, degraded, services}'
# Expect status "ready"; "degraded":true only if an optional provider is absent.
# Confirm release.commit_sha == 0cc7c877785d8ff5abc370c392f0c4b72b08f24f
```

### 3.7 Rollback target
The **currently-deployed known-good staging SHA** (record it immediately before
this deploy: `git -C <deploy> rev-parse HEAD`). Rollback = redeploy that SHA + its
matching frontend build. **Schema caveat:** Alembic migrations are forward-only and
additive; `0cc7c87`'s schema is backward-compatible with `5bad7e9`, so a code
rollback needs no down-migration. Do not run a destructive down-migration as part of
a rollback without a tested down-path.

### 3.8 Authentication test-account prerequisites (Phase-4 staging proof)
- One **confirmed** staging-only email/password account in the **staging** Supabase
  project (email_confirmed_at set), non-admin — for sign-in + cross-user IDOR checks.
- A second non-admin account — to prove cross-user resource access is rejected.
- One **admin** account (Admin `userType`) — for admin-route authorization checks.
- A **production** JWT (from the prod Supabase project) to confirm staging rejects it
  (issuer mismatch). Store only issuer / redacted-sub / role / expiry / HTTP status —
  never raw JWTs.

### 3.9 Staging-run evidence directory
`docs/evidence/readiness/` — file staging records as work packages
`WP-STAGING-{AUTH,OBSERVABILITY,ALERTS,LOAD,RECOVERY,DAST}-<UTC>` via
`scripts/evidence_recorder.py` (tamper-evident JSON+MD; `verify_file` gate in CI).

## 4. Explicitly not done (per instructions)
- **No credential rotation** (deferred to final closeout).
- **No paid AI evaluations** and **no live-provider calls** (gated on staging auth/
  budget/observability being verified first).
- **No production deployment.**

## 5. Stop point
A clean-CI-verified commit (`0cc7c87`, pending the user-run GitHub Actions pass) and
this staging handoff. Next action: push the branch, confirm CI green, then execute the
staging sequence in §3 and record `WP-STAGING-*` evidence.
