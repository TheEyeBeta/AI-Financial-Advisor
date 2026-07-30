# Production-Readiness Dossier — TheEye / AI-Financial-Advisor

**Prepared by:** Principal production-readiness engineering pass (autonomous session)
**Date:** 2026-07-21 · **Commit at session start:** `5bad7e9` (`main`)
**Scope of this session:** independent baseline verification + implementation of the
highest-severity / highest-dependency work, with generated evidence.

> **Reading rule (inherited from the repo's own readiness doctrine):** no category is
> scored 9/10 without *implemented controls + automated tests of the critical path +
> tested failure behaviour + generated evidence + only minor, documented limitations +
> no open critical/high issue*. Where that bar is not yet met **this session**, the
> category is scored below 9 and the exact remaining work is listed. Scores are **not**
> awarded for intent, architecture, or documentation alone.

---

## 1. Executive summary

TheEye is a mature codebase with substantial pre-existing readiness infrastructure
(12 CI workflows, k6 load profiles including a soak and failure-injection harness, a
STRIDE threat model, Alembic migration history to `0031`, structured observability,
Redis-backed rate limiting and AI budget guard, and an honest prior "10/10" readiness
register that already flags its own NOT-VERIFIED / EXTERNAL gaps).

Independent verification this session did **not** rubber-stamp that prior claim. Running
the backend suite from a clean dependency install surfaced a **real, shippable
cost-control defect** that the prior register did not catch: the AI **output-token limit
was implemented as a floor, not a ceiling** — a 400-token request was silently inflated
to the 8000-token server maximum, and the reasoning-retry path forced the budget *up to*
the ceiling. This is a direct AI-cost-control and correctness failure. It is now fixed,
with boundary regression tests.

Two genuinely missing controls were also implemented and tested: a **test-environment
AI-provider network guard** (fails any test that tries to reach a real provider) and a
**standalone environment/config validator** that catches fail-open cost/rate controls,
disabled auth, exposed debug routes, and cross-environment resource contamination.
Finally, a **unified evidence recorder** now emits tamper-evident JSON + Markdown
evidence, and real evidence artifacts were generated for the work completed.

**Net test result:** backend suite **1170 passed / 41 skipped / 0 failed** (was 1140
before this session's additions), zero regressions.

This session advanced the highest-impact categories (AI safety & cost control especially)
and produced reproducible evidence. It did **not**, and could not in one pass, bring all
14 categories to a fully-evidenced 9/10 — load/soak, recovery rehearsal, full security
scan, and frontend a11y runs require a live environment or exceed the sandbox execution
window. Those are scoped with exact next commands in §20–24.

---

## 2. Repository architecture discovered

| Layer | Detail |
| --- | --- |
| Frontend | Vite + React + TypeScript, Tailwind, shadcn/ui, TanStack Query, React Router (`src/`) |
| Backend | FastAPI service `backend/websearch_service` — AI proxy (`app/routes/ai_proxy.py`, ~3100 lines), search, trade engine, admin, stock ranking; scheduled jobs in `app/main.py` |
| AI providers | OpenAI Responses API (chat + classifier), Perplexity fallback; budget guard + cost reconciliation services |
| Database | Supabase Postgres, six schemas (`core/ai/trading/market/academy/meridian`); **Alembic is the sole migration authority** (`alembic/versions/0001..0031`) |
| Cache / limits | Redis (`RATE_LIMIT_REDIS_URL`/`REDIS_URL`) for rate limiting and AI budget; in-memory fallbacks gated by flags |
| Observability | `app/observability.py`, correlation-ID middleware, structured logging, `/health` + `/health/ready` with release identity |
| CI/CD | 12 GitHub Actions workflows: `ci, lint, e2e, integration-tests, security, dast, load-tests, docker-build, deploy-staging, promote-to-prod, release-verification, staging-seed` |
| Load | k6 profiles `profile-a..d` (normal/busy/burst/soak) + `failure-injection/` + safety/reporting libs under `tests/load/` |
| Governance | `AGENTS.md` (constitution), nested `AGENTS.md`, `skills/*/SKILL.md` playbooks, `docs/readiness/*`, `docs/security/*` |

---

## 3. Baseline scores (session start, independently assessed)

| # | Category | Baseline |
| --- | --- | --- |
| 1 | Functional correctness | 7 |
| 2 | Reliability & fault tolerance | 6 |
| 3 | Security | 7 |
| 4 | Authentication & authorisation | 7 |
| 5 | Performance & scalability | 6 |
| 6 | Observability & alerting | 7 |
| 7 | Database integrity & recovery | 6 |
| 8 | AI safety & cost control | **5** (output-token ceiling defect present) |
| 9 | Accessibility & frontend quality | 7 |
| 10 | Deployment & release engineering | 7 |
| 11 | Operational readiness | 7 |
| 12 | Testing & evidence quality | 7 |
| 13 | User access, invitations & usage caps | 6 |
| 14 | Documentation & maintainability | 8 |

Baseline is informed by repository inspection **and** the first full backend run
(`1123 passed / 15 failed` under the sandbox proxy — 13 environment artifacts, 2
bug-encoding tests, see §8), not by the prior register alone.

---

## 4. Work completed this session

1. **Phase 2 — AI output-token ceiling fix (highest severity).** `_effective_chat_max_output_tokens`
   rewritten to `min(valid_request, ceiling)` with safe default for missing/zero/negative,
   reasoning-floor clamped to the ceiling, and the non-streaming reasoning-retry path capped
   at the ceiling (previously `max(..., OPENAI_MAX_TOKENS)`). Single helper feeds both
   streaming and non-streaming paths.
2. **Phase 3 — AI-provider network guard.** New `tests/ai_network_guard.py`, installed by
   `conftest.py`, fails any test that resolves a real AI-provider host; explicit
   `ALLOW_REAL_AI_PROVIDER_NETWORK=1` escape hatch for the sanctioned capped live test.
3. **Phase 12 — environment/config validator.** New `app/env_validation.py` + CLI:
   flags missing/placeholder config, disabled auth, exposed debug routes, wildcard
   CORS/hosts, **fail-open cost/rate flags**, missing Redis, invalid token ceiling, and
   cross-environment resource contamination — never printing secret values.
4. **Phase 13 — evidence recorder.** New `scripts/evidence_recorder.py` emits
   tamper-evident (SHA-256) JSON + Markdown; five evidence artifacts generated under
   `docs/evidence/readiness/`.
5. **Corrected bug-encoding tests.** Three tests asserted the old floor behaviour; updated
   to assert the correct ceiling semantics (documented, not weakened).

---

## 5. Files changed

**Production code**
- `backend/websearch_service/app/routes/ai_proxy.py` — ceiling-correct token resolver + capped retry + `DEFAULT_CHAT_MAX_OUTPUT_TOKENS`.
- `backend/websearch_service/app/env_validation.py` — **new** standalone validator + CLI.

**Tests / test infra**
- `backend/websearch_service/tests/ai_network_guard.py` — **new** guard.
- `backend/websearch_service/tests/conftest.py` — installs the guard.
- `backend/websearch_service/tests/test_network_guard.py` — **new** (13 tests).
- `backend/websearch_service/tests/test_env_validation.py` — **new** (17 tests).
- `backend/websearch_service/tests/test_ai_proxy_helpers.py` — corrected + boundary tests.
- `backend/websearch_service/tests/test_ai_proxy_utils.py` — corrected ceiling-invariant tests.
- `backend/websearch_service/tests/test_ai_proxy.py` — corrected retry assertions.

**Evidence tooling / artifacts**
- `scripts/evidence_recorder.py` + `scripts/__tests__/test_evidence_recorder.py` — **new** (5 tests).
- `docs/evidence/readiness/WP-*.json` + `.md` — **new**, five verified records.
- `docs/readiness/PRODUCTION_READINESS_DOSSIER.md` — this document.

Real content change (EOL-agnostic) in the four backend source/test files: **+128 / −20 lines**.
(The working tree shows 577 files "modified" — this is pre-existing CRLF/EOL noise from a
Windows checkout, equal +/- per file; it is **not** from this session. See §20.)

---

## 6. Tests created

| Area | File | Count |
| --- | --- | --- |
| Token-ceiling boundaries | `test_ai_proxy_helpers.py` (added block) | 6 cases + parametrised boundaries |
| Ceiling invariants | `test_ai_proxy_utils.py::TestEffectiveChatMaxOutputTokens` | 3 |
| Retry cap | `test_ai_proxy.py` (corrected) | 1 |
| Network guard | `test_network_guard.py` | 13 |
| Env validator | `test_env_validation.py` | 17 |
| Evidence recorder | `scripts/__tests__/test_evidence_recorder.py` | 5 |

---

## 7. Exact commands executed

```bash
# Dependency install (sandbox Python 3.10; repo .venv is Windows-only)
pip install --break-system-packages --no-deps --prefer-binary -r <pins from requirements.txt/-dev.txt>
pip install --break-system-packages PyJWT==2.10.1 backports-asyncio-runner coverage socksio

# Phase 2 targeted
python -m pytest tests/test_ai_proxy_helpers.py -o addopts="" -q          # 82 passed
python -m pytest tests/test_ai_proxy.py tests/test_ai_proxy_utils.py \
                tests/test_ai_proxy_helpers.py -o addopts="" -q            # 230 passed

# New controls
python -m pytest tests/test_network_guard.py tests/test_ai_proxy.py -o addopts="" -q   # 37 passed
python -m pytest tests/test_env_validation.py -o addopts="" -q            # 17 passed
python -m app.env_validation --json                                        # CLI, exit 0
python -m pytest scripts/__tests__/test_evidence_recorder.py -q            # 5 passed  (repo root)

# Authoritative full suite (backend/websearch_service)
python -m pytest -o addopts="" -q -p no:cacheprovider                      # 1170 passed / 41 skipped / 0 failed
```

---

## 8. Test results

- **First full run (mixed sandbox env):** `1123 passed, 15 failed, 41 skipped` in 37.9s.
  Classified: **13 failures = sandbox SOCKS-proxy artifacts** (httpx requires `socksio`
  when `ALL_PROXY=socks5h://` is set — an environment issue, resolved by installing
  `socksio` / neutralising the proxy; not a code defect). **2 failures = bug-encoding
  token tests** corrected under WP-02.
- **After proxy neutralisation, unmodified-scope run:** `1140 passed / 41 skipped / 0 failed`.
- **Authoritative final run (post-change, guard active, socksio present):**
  **`1170 passed / 41 skipped / 0 failed`** in 36.2s — **+30 tests, zero regressions.**
- Full `--cov` run exceeds the 45s sandbox window; CI enforces `--cov-fail-under=69`
  (`pytest.ini`).

---

## 9. Load-test results

Not executed this session (k6 profiles require a running backend + Redis + DB, and the
soak profile runs for hours). The infrastructure exists: `tests/load/profile-a..d`,
`failure-injection/`, `lib/safety.js`, `lib/reporting.js`, `scripts/run-load-test.sh`,
`.github/workflows/load-tests.yml`, and `LOAD_TEST_RESULTS.md`. The new **network guard**
now makes a **mocked** soak safe (no live-provider spend) once pointed at a
staging-equivalent stack. Exact next command in §24.

---

## 10. Security findings and resolutions

| Severity | Finding | Status |
| --- | --- | --- |
| **High** | AI output-token limit was a floor, not a ceiling → cost-control bypass / unbounded per-request output budget | **Resolved** (WP-02, tested) |
| Medium | No test guard against live AI-provider egress → risk of accidental spend/key exposure/flaky CI | **Resolved** (WP-03, tested) |
| Medium | No pre-flight guard against fail-open cost/rate flags, disabled auth, or prod/staging resource mix in config | **Resolved** (WP-12 validator, tested) — wiring into startup/CI is the remaining step |
| Informational | 577-file CRLF/EOL-dirty working tree (missing enforced `.gitattributes` normalisation) | Documented (§20) |

No new critical/high issue was discovered beyond the token-ceiling defect. A full
`security.yml` / `dast.yml` / gitleaks run was **not** executed this session. **Credential
rotation is deliberately deferred** to closeout (§23) per instructions — treated as a
closeout action, not a blocker.

---

## 11. Accessibility results

Not re-run this session (no frontend changes made). Existing coverage: `e2e/a11y.spec.ts`
asserting the 8 keyboard-dialog behaviours, the prior dialog-focus fix
(`src/components/ui/dialog.tsx`), and `e2e.yml`. Reaching an evidenced 9/10 requires a
fresh axe/Playwright run across the nine critical workflows + manual screen-reader pass
(§20).

---

## 12. Recovery-readiness results

Not exercised this session (no disposable Postgres in-sandbox; production restore is
forbidden). Existing: `docs/DB_RECOVERY.md`, `docs/recovery/*`, cascade-delete migration
`0024`, orphan-cleanup service + tests. **Restore rehearsal remains NOT VERIFIED** (the
prior register says the same). A non-destructive recovery validator (schema/table/row
/extension/trigger/index/migration-head checks) is specified but not yet built (§20).

---

## 13. Observability coverage

Present and verified to import/run: correlation-ID middleware, structured logging,
`/health` + `/health/ready` with release identity (git SHA / version), AI budget + cost
reconciliation counters. Not independently re-verified this session: log-redaction unit
tests and external dashboards/alerts (EXTERNAL — Sentry/Datadog). The new validator
reduces one observability risk by refusing fail-open budget config in production.

---

## 14. Authentication & authorisation coverage

Existing suite (passing in the 1170): Supabase JWT verification with issuer/expiry checks,
admin-route protection (`test_admin_route_auth.py`, `test_admin_auth.py`), service-role
isolation, cross-user prevention, public-endpoint auth + rate-limit tests. Google auth
remains intentionally disabled pending password-auth verification (documented). The env
validator now fails production if `AUTH_REQUIRED` is off.

---

## 15. AI cost-control coverage

Strongest improvement this session. **(a)** Output-token ceiling enforced on both
streaming and non-streaming paths incl. retry (WP-02). **(b)** Env validator flags
`AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE`, `AI_BUDGET_ALLOW_IN_MEMORY`,
`ALLOW_IN_MEMORY_RATE_LIMIT` as production errors (WP-12). **(c)** Network guard prevents
runaway/accidental live spend in automated tests (WP-03). Existing budget guard + cost
reconciliation services remain in place. Remaining: a per-request effective-limit metric
label and a mocked budget-saturation soak.

---

## 16. Invite & quota coverage

Not deeply verified this session. Present in code: rate-limit service (Redis + in-memory),
`user_account_lifecycle`, admin jobs, `chat_turn_requests` reconciliation. Reaching 9/10
requires explicit tests for atomic quota consumption under concurrency (no oversubscription
on the last unit) and invite lifecycle (expiry/revocation/usage-limit/email-binding) — §20.

---

## 17. CI/CD coverage

12 workflows already exist (§2). This session adds two artifacts that should become CI
gates: an **env-schema validation** job (`python -m app.env_validation`) and confirmation
that the **AI-provider network guard** is active in the backend test job. Evidence-schema
validation can reuse `scripts/evidence_recorder.verify_file`. These are specified, not yet
wired into workflow YAML (§20).

---

## 18. Evidence artifact index

All under `docs/evidence/readiness/` (JSON + Markdown, each with a verified SHA-256 digest):

| Run ID prefix | Work package | Result | Key metric |
| --- | --- | --- | --- |
| `WP-BASELINE-*` | Full backend suite | pass | 1170 passed / 41 skipped / 0 failed |
| `WP-02-*` | Output-token ceiling | pass | 230 ai_proxy tests |
| `WP-03-*` | Network guard | pass | 13 tests |
| `WP-12-*` | Env validator | pass | 17 tests |
| `WP-13-*` | Evidence recorder | pass | 5 tests |

Verify any record: `python -c "from scripts.evidence_recorder import verify_file; print(verify_file('<path>.json'))"`.

---

## 19. Final category scores

| # | Category | Baseline | Final | Justification / evidence |
| --- | --- | --- | --- | --- |
| 1 | Functional correctness | 7 | **8** | 1170 backend tests green; Phase 2 correctness bug fixed. <9: frontend vitest/e2e not re-run this session. |
| 2 | Reliability & fault tolerance | 6 | **7** | Retry path corrected; fail-open flags now caught. <9: failure-injection not re-executed. |
| 3 | Security | 7 | **8** | High-sev cost bug closed; validator catches unsafe prod config. <9: full security/DAST scan not run; rotation deferred. |
| 4 | Auth & authz | 7 | **8** | Auth/admin tests pass; validator fails prod on disabled auth. <9: Google-auth path + live staging auth pending. |
| 5 | Performance & scalability | 6 | **6** | Unchanged; guard enables safe mocked soak. <9: load/soak not run here. |
| 6 | Observability & alerting | 7 | **7** | Verified present. <9: redaction tests + external dashboards not re-verified. |
| 7 | DB integrity & recovery | 6 | **6** | Unchanged. <9: migration apply + restore rehearsal not run (no disposable PG). |
| 8 | **AI safety & cost control** | 5 | **8** | Ceiling fix + fail-open detection + network guard, all tested. <9: effective-limit metric + budget-saturation soak. |
| 9 | Accessibility & frontend | 7 | **7** | Unchanged (no FE changes). <9: axe/SR runs across 9 workflows pending. |
| 10 | Deployment & release | 7 | **8** | Validator adds a concrete pre-flight gate. <9: branch ruleset + env-schema CI job (EXTERNAL/pending). |
| 11 | Operational readiness | 7 | **7** | Unchanged; strong existing runbooks. <9: on-call/alert wiring EXTERNAL. |
| 12 | Testing & evidence quality | 7 | **8** | +30 tests, tamper-evident evidence system. <9: evidence-schema CI gate + coverage ratchet. |
| 13 | Invites & usage caps | 6 | **6** | Unchanged. <9: concurrency/oversubscription + invite-lifecycle tests. |
| 14 | Documentation & maintainability | 8 | **8** | This dossier + evidence added; strong docs. <9: `.gitattributes` EOL normalisation. |

No category is claimed at 9/10 this session — see §20 for exactly what each needs.

---

## 20. Categories still below 9/10 — exact work required

- **1 Functional correctness → 9:** run `npm run test:coverage`, `npm run type-check`,
  `npm run build`, and `e2e.yml` green on this commit; attach as evidence.
- **2 Reliability → 9:** execute `tests/load/failure-injection/` (DB/Redis/provider
  timeouts, rate-limit, malformed/partial streams) with assertions; record.
- **3 Security → 9:** run `security.yml` + `dast.yml` + gitleaks on this commit; triage to
  zero open critical/high; then schedule rotation at closeout.
- **4 Auth → 9:** stand up staging, verify password-auth end-to-end + provider-outage
  behaviour; keep Google disabled until then.
- **5 Performance → 9:** run k6 `profile-a/b/c` and the mocked soak (`profile-d`) against a
  staging-equivalent stack with pass/fail thresholds (p95/p99, error rate, memory growth).
- **6 Observability → 9:** add + run log-redaction unit tests; capture dashboard/alert
  config (EXTERNAL) as evidence.
- **7 DB & recovery → 9:** `alembic upgrade head` + `alembic check` on a disposable
  Postgres; build the non-destructive recovery validator; file a staging restore-rehearsal
  record.
- **8 AI cost control → 9:** add an effective-output-limit telemetry label; run a mocked
  budget-saturation soak proving the circuit breaker fails **closed**.
- **9 Accessibility → 9:** axe + Playwright keyboard/SR runs across sign-in/out, dashboard,
  AI conversation, research result, error, loading, invite, usage-cap; document manual SR pass.
- **10 Deployment → 9:** wire `app.env_validation` as a CI `env-schema` job + startup gate;
  apply the branch ruleset (EXTERNAL); confirm SHA exposure on deploy targets.
- **11 Operational → 9:** connect alert routing/on-call (EXTERNAL) and rehearse one incident
  against the runbooks.
- **12 Testing/evidence → 9:** add an evidence-schema CI check (`verify_file`) and ratchet
  `--cov-fail-under` upward as new tests land.
- **13 Invites/quotas → 9:** add concurrency tests proving no oversubscription of the last
  quota/invite unit + atomic consumption + invite expiry/revocation/email-binding.
- **14 Docs → 9:** commit a `.gitattributes` enforcing LF to clear the 577-file EOL drift.

---

## 21. External manual actions remaining

1. Apply GitHub branch ruleset on `main`/`staging` (PR + approval + mandatory checks, no
   force-push/bypass).
2. Confirm deploy targets expose commit SHA (Vercel system env, Railway/Render var).
3. Provision/verify Sentry (or Datadog) dashboards + alert thresholds.
4. Stand up staging for auth + deploy verification.
5. Provision a shared Redis for the staging soak.

## 22. Paid tests remaining

- Small GPT-4o-mini structural eval → full cheap structural eval → **one** production-model
  eval under a hard app-level budget → small capped live-provider validation (set
  `ALLOW_REAL_AI_PROVIDER_NETWORK=1` only for that run). **Do not** run the full paid
  175-item eval or a live-provider soak yet.

## 23. Deferred credential-rotation checklist (closeout only — do not rotate yet)

- [ ] Supabase service-role key + JWT secret
- [ ] OpenAI API key
- [ ] Perplexity / Tavily keys
- [ ] Redis/Valkey credential
- [ ] Sentry DSN
- [ ] Platform + GitHub tokens
- [ ] Re-run env validator + full suite post-rotation; confirm no staging↔prod credential crossover.

## 24. Recommended next command

Wire the validator into CI and re-confirm the suite on this commit, then move to staging:

```bash
# 1) Gate config in CI + locally (never prints secrets)
python -m app.env_validation --json

# 2) Re-run the authoritative backend suite with coverage (CI parity)
cd backend/websearch_service && python -m pytest        # honours pytest.ini --cov-fail-under=69

# 3) Then, against a staging-equivalent stack (mocked provider, real DB+Redis):
scripts/run-load-test.sh profile-d      # mocked soak; keep ALLOW_REAL_AI_PROVIDER_NETWORK unset
```
