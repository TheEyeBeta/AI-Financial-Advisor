> **Historical document.** This describes PR #258 (`readiness/batch-1-3-execution`,
> merged as `76633b8`), not any later PR. Migration head, SEC-B2-04 status, and
> test counts below reflect that PR's state at the time, not current `main`.
> Kept as a handoff/evidence record per the readiness programme's convention
> of preserving point-in-time execution snapshots — see
> `docs/security/BATCH2_FINDINGS_REGISTER.md` and
> `docs/readiness/10-of-10-beta-readiness.md` for current status.

# Readiness (Batch 1–3): AI cost-control fix, test isolation, env validation, observability, invite concurrency, recovery, evidence + CI gates

**Branch:** `readiness/batch-1-3-execution` → **base:** `main` (or `staging`)
**Tested commit:** `0cc7c877785d8ff5abc370c392f0c4b72b08f24f` (parent `5bad7e9`)
**Size:** 71 files, real diff **+5416 / −20** (EOL-agnostic — no CRLF noise; review with
`git diff --ignore-space-at-eol`).

## What this PR does
Production-readiness hardening with tests, executed evidence, and CI gates. No behavioural
change to product features beyond the cost-control fix.

- **AI output-token ceiling fix (High-severity cost-control bug).** `ai_proxy._effective_chat_max_output_tokens`
  was `max(requested, ceiling)` — a small request was inflated to the 8000-token server max, and the
  reasoning-retry forced budget *up to* the ceiling. Now `min(valid_request, ceiling)`; reasoning floor and
  retry clamped; one helper feeds streaming, tool-call continuation, non-streaming and retry.
- **Test AI-provider isolation.** `tests/ai_network_guard.py` (installed by conftest) fails any test that
  resolves a real AI-provider host; explicit `ALLOW_REAL_AI_PROVIDER_NETWORK` escape hatch.
- **Environment validation + startup gate.** `app/env_validation.py` + `enforce_startup_environment`
  (staging/prod strict: auth, debug routes, wildcard CORS/hosts, fail-open cost/rate flags, cross-env
  resource contamination, token ceiling). Never prints secret values. Wired into `create_app`.
- **Deterministic AI provider stub.** `tests/fake_ai_provider.py` — 23 scenarios + invariant tests
  (offline, bounded retries, capped output, cancellation cleanup, partial-stream integrity, quota rollback,
  usage reconciliation, concurrency).
- **Observability redaction.** Value-based `redact_text` (JWTs, bearer tokens, API keys, credentialed URIs,
  inline secrets, financial fields) + tests; `docs/observability/{ALERTS,METRICS}.md`.
- **Invite concurrency control.** `app/services/invite_redemption.py` atomic single-use/N-use redemption
  (expiry, revocation, email-binding, audit), proven under 50/200-thread concurrency (exactly one winner).
- **Recovery validator.** `app/services/recovery_validator.py` — non-destructive checks; executed on a real
  Postgres (36 migrations → head `0036`); corrected the chat table name to `ai.chats`.
- **Evidence framework + CI gates.** `scripts/evidence_recorder.py` (tamper-evident JSON+MD) + 19 verified
  artifacts under `docs/evidence/readiness/`; `.github/workflows/readiness-controls.yml`
  (env-schema, evidence-schema, network-guard).

## Verification (executed, clean Linux — Ubuntu 22.04 / Python 3.10.12)
- Backend suite **1247 passed / 41 skipped / 0 failed**; global coverage **76%** (auth 93%, budget 84%).
- **36 Alembic migrations apply clean** on a real Postgres (head `0036`); recovery validator `ok`.
- CI gates: env-schema safe=exit0 / unsafe=exit1; evidence-schema 19/19 verified; network-guard blocks.
- Frontend `tsc --noEmit` clean. (vitest/build/e2e/a11y run on the CI Linux runner — the committed host
  `node_modules` is Windows-native.)

## Not included / follow-ups
- No credential rotation; no paid AI evaluation; no live-provider call; no production deploy.
- Frontend unit/build/e2e/a11y and secret/DAST scans run in CI (this branch triggers them).
- Staging execution (auth proof, live alerts, load/soak, backup-restore rehearsal) tracked in
  `docs/readiness/STAGING_HANDOFF.md`.
- Open Low finding SEC-B2-04 (pin JWT algorithm allowlist) — see `docs/security/BATCH2_FINDINGS_REGISTER.md`.

## Review notes
- The 7 modified tracked files carry unavoidable CRLF→LF churn from a Windows checkout; use
  `git show --ignore-space-at-eol` to see the real (small) diffs (`ai_proxy.py` +58/−9, `correlation.py` +61,
  `main.py` +6).
- Full context: `docs/readiness/{PRODUCTION_READINESS_DOSSIER,BATCH2_READINESS_DOSSIER,BATCH3_EXECUTION_DOSSIER}.md`.

## Test plan
- [x] Backend suite green on clean Linux (1247/0)
- [x] Migrations apply from clean + recovery validator ok (real Postgres)
- [x] Focused suites (token-ceiling, guard, env, provider, redaction, invite, recovery, evidence) green
- [ ] CI green on this SHA (frontend vitest/build/e2e/a11y + secret/DAST) — runs on push
