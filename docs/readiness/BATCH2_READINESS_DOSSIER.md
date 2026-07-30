# Batch 2 Production-Readiness Dossier — TheEye / AI-Financial-Advisor

**Date:** 2026-07-21 · **Branch:** `main` · **Base commit:** `5bad7e9`
**Scope:** Verify Batch 1, make its controls enforceable, and extend readiness
across provider stub, observability, auth, security, invites, recovery, load,
and coverage — with generated, tamper-evident evidence.

> Scoring bar (unchanged): 9/10 requires implemented controls + tested critical
> path + tested failure behaviour + generated evidence + only minor documented
> limitations + no open critical/high. Scores below 9 list the exact remaining
> work. No score is awarded for documentation alone.

---

## 1. Verified Batch 1 diff

Inspected the real git diff (EOL-agnostic; the working tree's 577 "modified"
files are pre-existing Windows CRLF noise, not this work). Batch 1 = **5 tracked
files (+139/−20)** + 5 new files. Every claim verified:

- **Token ceiling** (`ai_proxy.py::_effective_chat_max_output_tokens`): now
  `min(valid_request, ceiling)` with safe default for missing/zero/negative;
  reasoning floor `min(MIN_REASONING, ceiling)`; **single call site (line 2343)**
  feeds streaming (2827), tool-call continuation (3005), non-streaming (3110).
- **Retry calc** (line ~3138): `min(max(payload, RETRY_MIN), ceiling)` — was
  `max(..., OPENAI_MAX_TOKENS)`; ceiling stays authoritative on the recovery path.
- **Streaming/non-streaming/tool-call parity:** proven — all derive from the one
  helper; the `.get(...,300)` fallbacks read an already-capped payload.
- **Network guard** + escape hatch: blocks AI-provider host resolution; disabled
  only by explicit truthy `ALLOW_REAL_AI_PROVIDER_NETWORK`.
- **Env validator**, **evidence recorder schema**, **5 artifacts**, **digests**:
  all present and verified (`verify_file` → True ×5).
- **1170 passed** reproduced this session (`pytest -o addopts='' -q`).

Anti-tamper checks: no hidden regression (the 3 corrected tests encoded the old
bug — documented), no unrelated refactor, no test-only behaviour in runtime, no
unsafe bypass, no secrets in evidence (grep clean), no override path, no
independent streaming/tool-call token logic.

## 2. Corrections made to Batch 1
**None required** — Batch 1 verified correct and complete. Batch 2 only *extends*
it (staging strictness, startup enforcement, CI gates).

## 3. Files changed during Batch 2

Modified (tracked): `app/main.py` (+6, wire startup enforcer),
`app/middleware/correlation.py` (+61, value-based redaction).
Modified (Batch-1 new file): `app/env_validation.py` (staging-strict + startup enforcer).

New: `app/services/recovery_validator.py`, `app/services/invite_redemption.py`,
`tests/fake_ai_provider.py`, `tests/test_fake_ai_provider.py`,
`tests/test_log_redaction.py`, `tests/test_recovery_validator.py`,
`tests/test_invite_redemption.py`, `.github/workflows/readiness-controls.yml`,
`docs/observability/{ALERTS,METRICS}.md`,
`docs/security/{ENDPOINT_AUTH_MATRIX,GOOGLE_AUTH_CHECKLIST,BATCH2_FINDINGS_REGISTER}.md`,
`docs/recovery/STAGING_RESTORE_REHEARSAL.md`, this dossier, +10 evidence artifacts.

## 4. Tests added (Batch 2)

| File | Tests | Proves |
| --- | --- | --- |
| `test_fake_ai_provider.py` | 25 | 23 provider scenarios + 8 invariants |
| `test_log_redaction.py` | 22 | value + key redaction, financial fields |
| `test_recovery_validator.py` | 13 | recovery checks + unsafe-identifier refusal |
| `test_invite_redemption.py` | 11 | invite lifecycle + 50/200-thread anti-oversubscription |
| `test_env_validation.py` (extended) | +9 | staging strict + startup enforcer |

## 5. Exact commands executed
```bash
python -m pytest -o addopts="" -q -p no:cacheprovider            # full suite
python -m pytest tests/test_fake_ai_provider.py                  # 25
python -m pytest tests/test_log_redaction.py tests/test_correlation_middleware.py  # 24
python -m pytest tests/test_recovery_validator.py                # 13
python -m pytest tests/test_invite_redemption.py                 # 11
python -m pytest tests/test_env_validation.py tests/test_main.py # 46
python -m app.env_validation --json                              # good=0 / unsafe=1
npx tsc --noEmit                                                 # frontend type-check: exit 0
node --check tests/load/*.js                                     # 10/10 syntax ok
COVERAGE_FILE=/tmp/covA pytest --cov=app.env_validation --cov=app.services.recovery_validator \
  --cov=app.services.invite_redemption --cov=app.middleware.correlation ...
COVERAGE_FILE=/tmp/covB pytest --cov=app.services.auth --cov=app.services.ai_budget_guard ...
```

## 6. Backend test result
**1247 passed, 41 skipped, 0 failed** (34.6s) — +77 vs Batch 1 (1170), zero regressions.

## 7. Frontend test result
`tsc --noEmit` **PASS** (exit 0) — whole app type-checks on this commit.
`vitest` / `vite build` / `eslint` / `playwright`: **blocked in sandbox** — the
committed `node_modules` contains Windows-native binaries (`@swc/core-win32`,
`@esbuild/win32`, vitest's `rolldown`) unusable on Linux. Run after `npm ci` on
Linux (CI `ci.yml` frontend job + `e2e.yml` already do this). ESLint exceeds the
45s sandbox window; runs in CI `lint.yml`.

## 8. Coverage result (critical modules; writable `/tmp` data file)
auth **93%** · ai_budget_guard **84%** · env_validation **91%** ·
correlation **91%** · invite_redemption **97%** · recovery_validator **84%**.
Global `--cov` exceeds the 45s window; CI enforces `--cov-fail-under=69` (`pytest.ini`).
Uncovered are mostly defensive except-branches; no uncovered *critical behavioural* path found in auth/budget.

## 9. Security findings
See `docs/security/BATCH2_FINDINGS_REGISTER.md`. Summary: Critical **0** · High
**0 open** (1 resolved: SEC-B2-01 token-ceiling) · Medium **0 open** (2 resolved:
network guard, config pre-flight) · Low **1 open** (SEC-B2-04 JWT alg-pinning,
not exploitable) · Info 1 resolved. Existing controls (RLS, gitleaks, DAST,
prompt-injection, atomic rate-limit) verified, not duplicated.

## 10. Authentication endpoint matrix
`docs/security/ENDPOINT_AUTH_MATRIX.md`. No missing-auth endpoint found across
34 `require_auth`, 25 admin, 3 `optional_auth`, 1 service-role cron. Rejection
scenarios (missing/malformed/expired/bad-sig/wrong-issuer/env-cross/role/service-role/ES256-JWKS)
covered by 109 existing auth tests; auth module 93% covered.

## 11. Observability coverage matrix
`docs/observability/METRICS.md` (per-signal EMITTED/DERIVED/GAP/EXTERNAL) +
`docs/observability/ALERTS.md` (12 alerts w/ thresholds, recovery conditions,
queries, setup). Redaction now EMITTED **+ TESTED**. Top gaps: first-token
latency, per-dependency latency, active-request/scheduler gauges (additive log fields).

## 12. Invite and quota results
Usage caps (per-user rate limits, global concurrency, global AI budget, token
caps) IMPLEMENTED + TESTED, incl. `test_global_concurrency_race_only_allows_configured_max`
(atomic, no oversubscription). Invite **code/token** system is **not yet in the
schema**; Batch 2 adds the race-safe `invite_redemption` primitive (single-use,
expiry, revocation, email-binding, audit) proven under 50/200-thread concurrency
(exactly one winner). Remaining: DB migration `0032` + routes + RLS to wire it in.

## 13. Accessibility results
Existing infra (`e2e/a11y.spec.ts` — 8 keyboard-dialog behaviours, prior
dialog-focus fix). Not executed in sandbox (Playwright/native binaries blocked).
Run after Linux `npm ci`; the nine critical-workflow axe passes + manual
screen-reader pass remain (documented in §20).

## 14. Recovery-validator results
`app/services/recovery_validator.py` — non-destructive checks for migration head,
schemas, tables, extensions, functions, triggers, indexes, row-count sanity,
auth-profile provisioning, connectivity, backup metadata/freshness; unsafe
identifiers refused. **13 tests pass, 84% cov.** Staging rehearsal procedure +
evidence template: `docs/recovery/STAGING_RESTORE_REHEARSAL.md`. Live rehearsal
(needs a staging DB) remains.

## 15. Load-test results
k6 not installed and no backend in sandbox → not executed. **10/10 load scripts
pass `node --check`**; profiles a–d define p95/p99/error-rate thresholds (real
assertions). Deterministic stub (Part 3) makes a mocked soak safe. Remaining:
named smoke/spike/stress/endurance profiles + staged execution.

## 16. CI enforcement changes
New `.github/workflows/readiness-controls.yml`: **env-schema** (safe synthetic
config exit 0 / unsafe exit 1), **evidence-schema** (digest verify), **network-guard
active**. Verified locally (0 / 1 / verified / blocked). Migration validation
(`ci.yml` line 140), full pytest incl. token-ceiling/guard/validator tests
(`ci.yml` Backend Tests), and secret scanning (`security.yml`) already gate.

## 17. Evidence artifact index
`docs/evidence/readiness/` — **15** tamper-evident records (5 Batch 1 + 10 Batch 2):
`WP-B2-{SUITE,STARTUP,PROVIDER,REDACTION,AUTH,RECOVERY,INVITE,FRONTEND,COVERAGE,LOAD}`.
Verify: `python -c "from scripts.evidence_recorder import verify_file; ..."` → all True.

## 18. Updated category scores

| # | Category | Batch1 | **Batch2** | Note |
| --- | --- | --- | --- | --- |
| 1 | Functional correctness | 8 | **8** | tsc clean; backend 1247 green; FE unit/e2e need Linux CI |
| 2 | Reliability & fault tolerance | 7 | **8** | deterministic stub proves timeout/rate-limit/partial-stream/cancellation/retry-bound |
| 3 | Security | 8 | **8** | 0 open crit/high; SEC-B2-04 low + fresh scan pending |
| 4 | Auth & authz | 8 | **8** | matrix + 93% cov; cross-user IDOR + JWKS-rotation tests pending |
| 5 | Performance & scalability | 6 | **6** | scripts valid + thresholds; execution needs staging |
| 6 | Observability & alerting | 7 | **8** | redaction tested; alerts+metrics complete; latency gauges pending |
| 7 | DB integrity & recovery | 6 | **7** | recovery validator + tests + rehearsal proc; live restore pending |
| 8 | AI safety & cost control | 8 | **8** | stub + guard + ceiling + fail-open detection; effective-limit metric pending |
| 9 | Accessibility & frontend | 7 | **7** | tsc clean; axe/SR runs pending (native-binary blocked) |
| 10 | Deployment & release | 8 | **8** | startup enforcer + CI env/evidence gates; branch ruleset EXTERNAL |
| 11 | Operational readiness | 7 | **7** | alerts + rehearsal proc; on-call wiring EXTERNAL |
| 12 | Testing & evidence quality | 8 | **9** | 1247 tests, 15 tamper-evident artifacts, CI evidence gate, critical-module cov |
| 13 | Invites & usage caps | 6 | **7** | caps tested + atomic invite primitive proven; DB invite schema pending |
| 14 | Documentation & maintainability | 8 | **8** | matrices, registers, runbooks added; `.gitattributes` EOL pending |

## 19. Categories still below 9/10 — exact remaining work
- **1 →9:** `npm ci` (Linux) → `vitest run --coverage`, `vite build`, `e2e.yml` green on this commit.
- **2 →9:** run `tests/load/failure-injection/` with assertions against staging.
- **3 →9:** close SEC-B2-04 (pin JWT `algorithms` allowlist + reject-`none` test); fresh `security.yml`+`dast.yml`+gitleaks on this commit at 0 crit/high.
- **4 →9:** add cross-user IDOR regression + disabled-user 403 + JWKS-rotation tests.
- **5 →9:** run k6 smoke/normal/busy/burst + mocked soak (deterministic stub) with pass/fail thresholds in staging.
- **6 →9:** emit `ai_first_token_ms` + per-dependency latency; attach dashboard config.
- **7 →9:** execute the staging restore rehearsal; file `WP-RECOVERY-REHEARSAL` evidence.
- **8 →9:** add effective-output-limit metric; mocked budget-saturation soak proving fail-closed.
- **9 →9:** axe + keyboard/SR runs across the 9 workflows + manual SR pass.
- **10 →9:** apply branch ruleset (EXTERNAL); confirm deploy-target SHA exposure.
- **11 →9:** wire alert routing/on-call (EXTERNAL) + one incident rehearsal.
- **13 →9:** migration `0032` invites table + routes + RLS wiring the primitive; concurrency test at the DB layer.
- **14 →9:** commit `.gitattributes` (LF) to clear the 577-file EOL drift.

## 20. External staging actions
Stand up staging (auth + deploy verify); provision shared Redis; apply GitHub
branch ruleset; confirm Vercel/Railway SHA exposure; provision Sentry/Datadog
dashboards + alert routing.

## 21. Paid tests still deferred
Small GPT-4o-mini structural eval → full cheap structural eval → one
production-model eval under a hard app budget → small capped live-provider
validation (`ALLOW_REAL_AI_PROVIDER_NETWORK=1` only for that run). Full 175-item
paid eval and live-provider soak remain deferred.

## 22. Credential-rotation closeout status
**Deferred** (unchanged). Checklist in Batch 1 dossier §23: Supabase SRK/JWT,
OpenAI, Perplexity/Tavily, Redis, Sentry DSN, platform+GitHub tokens; re-run env
validator + suite post-rotation; verify no staging↔prod crossover.

## 23. Recommended next execution command
```bash
# 1) Enforce the new gates locally + in CI
python -m app.env_validation --json && \
cd backend/websearch_service && python -m pytest        # CI-parity coverage gate
# 2) On Linux CI (native binaries present): full frontend proof
npm ci && npm run type-check && npm run test:coverage && npm run build && npm run test:e2e
# 3) In staging (mocked provider, real DB+Redis): asserted load + restore rehearsal
scripts/run-load-test.sh profile-b       # keep ALLOW_REAL_AI_PROVIDER_NETWORK unset
```

## 24. One-line status
Batch 1 verified clean and now enforced (startup + 3 CI gates); Batch 2 added a
deterministic provider stub, value-based log redaction, a recovery validator, an
atomic invite primitive, an auth endpoint matrix, alert definitions, and a
security register — **1247 backend tests green, 15 verified evidence artifacts,
zero open critical/high**. Remaining 9/10 gaps are execution-in-staging and
Linux-CI runs, each with an exact command above.
