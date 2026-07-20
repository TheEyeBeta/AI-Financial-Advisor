# 10/10 Beta Readiness — master checklist and evidence register

**Owner:** TheEyeBeta · **Updated:** 2026-07-17 · **Target:** controlled, invite-only beta of up to 150 users.

**Reading rules.** "10/10" means: all material beta risks are fixed, tested,
monitored, recoverable or explicitly disabled; every critical journey has
objective evidence; production cannot receive a release with a known failed
mandatory check; and no readiness claim is made without evidence. It does
not mean zero theoretical risk. Every row below carries a status from:

`IMPLEMENTED` · `AUTOMATED TEST PASSED` · `MANUAL VERIFICATION REQUIRED` ·
`EXTERNAL ACCESS REQUIRED` · `NOT VERIFIED` · `BLOCKED`

No row is "complete" without a linked evidence source (test file, workflow,
runbook, migration, doc, or an explicitly named manual/external record).
Where a row says NOT VERIFIED, that is the claim.

---

## Phase 1 — Release discipline and exact-SHA enforcement

| Requirement | Status | Evidence |
| --- | --- | --- |
| Formal release policy (promotion flow, checks, SHA rules) | IMPLEMENTED | [`RELEASE_POLICY.md`](./RELEASE_POLICY.md) |
| Stable, documented mandatory check names | IMPLEMENTED | `RELEASE_POLICY.md` §2; `docs/ci/CI_GUIDELINES.md` §3.8 |
| Backend release identity (git SHA, APP_VERSION, build timestamp, expected Alembic revision, environment) in health metadata | AUTOMATED TEST PASSED | `backend/websearch_service/app/health_checks.py::release_info`; tests: `tests/test_health_checks.py` (3 new tests); exposed in `/health` + `/health/ready` |
| Frontend release SHA stamped into served HTML | AUTOMATED TEST PASSED (build-verified) | `vite.config.ts::releaseShaMetaTag`; verified in `dist/index.html` during this session's build |
| Release-verification smoke (frontend+backend SHA == expected) | IMPLEMENTED | `scripts/verify-release.mjs`; workflow `.github/workflows/release-verification.yml` |
| Deploy targets actually expose their SHA (Vercel system env, Railway var) | EXTERNAL ACCESS REQUIRED | `RELEASE_POLICY.md` §5 rows 3–4 |
| Failed mandatory check blocks merge/promotion, logs preserved | IMPLEMENTED (repo side) + EXTERNAL ACCESS REQUIRED (ruleset) | `RELEASE_POLICY.md` §4–5; ruleset checklist `CI_GUIDELINES.md` §3.8 |
| Branch ruleset applied on `main`/`staging` (PR required, 1 approval, dismiss stale, resolved threads, up-to-date, mandatory checks, no force-push/deletion, no admin bypass) | EXTERNAL ACCESS REQUIRED | exact instructions: `CI_GUIDELINES.md` §3.8 — unverifiable from the repo |
| Keyboard E2E failure root-caused and fixed | AUTOMATED TEST PASSED | Root cause: Radix restores focus only to a `DialogTrigger`; all app dialogs are controlled without one → focus dropped to `<body>` on close, app-wide (WCAG 2.4.3). Fix: `src/components/ui/dialog.tsx`. Regression: `src/components/ui/__tests__/dialog.test.tsx` (1 test) + `e2e/a11y.spec.ts` asserting all 8 required behaviours (reachable, visible focus, Enter **and** Space, focus entry, containment, Escape, restoration). Local runs: chromium + mobile-chromium PASS; firefox not installable in this sandbox — `NOT VERIFIED locally`, runs in CI `e2e.yml` on push |
| Doc drift: deleted `deploy.yml` still referenced | IMPLEMENTED (fixed) | `CI_GUIDELINES.md` §1/§3.7 updated to native-integration reality |

## Phase 2 — Critical user-journey proof

| Requirement | Status | Evidence |
| --- | --- | --- |
| Machine-readable journey matrix (name, priority, preconditions, steps, expected, data written, deps, coverage per layer, manual flag, status) | IMPLEMENTED | [`docs/tests/critical-journeys.json`](../tests/critical-journeys.json) — 60+ journeys across auth/onboarding/IRIS/trading/academy/account |
| Human-readable matrix | IMPLEMENTED | [`docs/tests/CRITICAL_JOURNEYS_MATRIX.md`](../tests/CRITICAL_JOURNEYS_MATRIX.md) (narrative audit, cross-linked) |
| "No complete without evidence" enforced mechanically | AUTOMATED TEST PASSED | `src/tests/critical-journeys-matrix.test.ts` — CI fails if any `AUTOMATED_TEST_PASSED` row cites a nonexistent evidence file (6 tests) |
| Three-layer architecture (unit / real-Postgres integration / E2E) | AUTOMATED TEST PASSED | Unit: 228 vitest + 1003 pytest. Integration: `test_trading_constraints_db.py` re-ran green against fresh Postgres 16 this session (12 tests incl. concurrent-oversell race); Supabase-backed integration tests run in `integration-tests.yml`. E2E: 24 passed chromium full suite this session |
| P0 journeys with automated passing tests | AUTOMATED TEST PASSED for 37 of 40 P0 rows | per-row citations in `critical-journeys.json` (68 journeys total); the 3 P0 exceptions carry validator-enforced explanatory notes: `auth-google-real-account` (MANUAL — real provider pass), `iris-refresh-reload` (NOT VERIFIED), `iris-backend-unavailable` (IMPLEMENTED, untested UI banner) |
| Known genuine gaps stated, not hidden | IMPLEMENTED | `BLOCKED`: IRIS retry-after-failure (duplicate-message risk — needs design decision); insufficient-cash rejection (deliberate auto-fund design — needs product decision). `NOT_VERIFIED`: refresh-reload, cancellation, back-navigation, profile update, token expiry, academy RLS, trading duplicate-request |
| Remaining manual production smoke tests identified | IMPLEMENTED | journeys with `manual_required: true` in the JSON + `RELEASE_CHECKLIST.md` post-deploy smoke |

## Phases 3–5 (completed in prior sessions — evidence pointers only)

| Area | Evidence | Status per its own doc |
| --- | --- | --- |
| Data recovery / backup / migration validation | `docs/DB_RECOVERY.md`, `docs/recovery/*` (isolated restore, backup verification checklist, RPO/RTO worksheet, evidence template) | Procedures documented; **restore rehearsal NOT VERIFIED** (no evidence record filed) |
| Monitoring / SLO | `docs/SLO.md` (explicitly "SPECIFICATION ONLY"), `docs/MONITORING_IMPLEMENTATION_PLAN.md` | Dashboards/alerts EXTERNAL ACCESS REQUIRED |
| Performance / load | `LOAD_TEST_RESULTS.md`, `load-tests.yml`, bundle budgets in CI, `e2e/performance.spec.ts` | Automated budgets in CI; load tests manual-trigger |

## Phase 6 — Security hardening and independent-review preparation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Threat model (STRIDE, all listed components) | IMPLEMENTED | [`docs/security/THREAT_MODEL.md`](../security/THREAT_MODEL.md) |
| Security test inventory mapped to CI evidence | IMPLEMENTED / AUTOMATED TEST PASSED per row | [`docs/security/SECURITY_TEST_INVENTORY.md`](../security/SECURITY_TEST_INVENTORY.md) — 18 categories; gaps G-2 (ai/academy RLS tests), G-3 (mass-assignment sweep), G-4 (fuzz corpus), G-5 (secret-scan canary) stated |
| Secrets controls inspection (hardcoded, .env, VITE keys, artifacts, URLs, logs, docs, history) | IMPLEMENTED | inventory §Secrets-control inspection; gitleaks gate `security.yml#secret-scan` + `SECRET_SCANNING.md` |
| Key-rotation runbook (Supabase SRK/JWT, OpenAI, Google, Redis/Valkey, Sentry, platform+GitHub tokens) | IMPLEMENTED; rotations MANUAL VERIFICATION REQUIRED (never rehearsed) | [`docs/security/KEY_ROTATION.md`](../security/KEY_ROTATION.md) |
| Independent-review handoff package (architecture, flows, RLS, admin, WS, limitations, accounts, RoE, reporting) | IMPLEMENTED | [`docs/security/SECURITY_REVIEW_PACKAGE.md`](../security/SECURITY_REVIEW_PACKAGE.md) |
| External penetration test | EXTERNAL ACCESS REQUIRED | not commissioned; package ready |
| No known critical/high security issue open | IMPLEMENTED (as of this audit) | top residual risks ranked in `THREAT_MODEL.md` §4 — none assessed critical/high *for a 150-user capped beta*; the global-AI-cap and unapplied-ruleset items are the two to watch |

## Phase 7 — AI reliability, cost and safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Per-user request/token quotas + concurrency + input/output caps, clear rejections | AUTOMATED TEST PASSED | [`docs/ai/AI_CONTROLS.md`](../ai/AI_CONTROLS.md) §1; `test_rate_limit*.py`, `integration/test_rate_limiting.py` |
| Global request/concurrency/spend ceilings | NOT IMPLEMENTED (gaps G-1a–d) | `AI_CONTROLS.md` §1 — compensating control: hard 150-account cap + provider-side budget alarm (**EXTERNAL ACCESS REQUIRED** to confirm the alarm) |
| Cost accounting (tokens, IDs, latency, failure class; no raw prompts in telemetry) | IMPLEMENTED (per-request $ estimate = gap G-7) | `AI_CONTROLS.md` §2; `TELEMETRY_PRIVACY.md` |
| Provider states + resilience (timeout/429/401/5xx/malformed/interruption/bounded retries/fallback) | AUTOMATED TEST PASSED (cancellation NOT VERIFIED) | `AI_CONTROLS.md` §3 with per-scenario test citations |
| Versioned eval dataset (50/25/20/20/20/20/10/10 = 175) + repeatable runner + machine-readable report | IMPLEMENTED; dataset integrity AUTOMATED TEST PASSED | `backend/websearch_service/evals/` (dataset v1, `run_evals.py`, README); `tests/test_eval_suite.py` (9 tests, passing) |
| Eval suite executed against live pipeline | NOT VERIFIED | requires backend + provider key; no report committed under `evals/reports/` — no quality claims made |
| User-facing financial safety (no guaranteed-advice framing, staleness indicated, no fabricated values, failure states) | IMPLEMENTED / PARTIALLY VERIFIED | `AI_CONTROLS.md` §5 (product copy + tested data-availability semantics; model-behaviour halves await the eval run) |

## Phase 8 — Accessibility and cross-device quality

| Requirement | Status | Evidence |
| --- | --- | --- |
| Automated axe checks on critical pages, failing on serious/critical | AUTOMATED TEST PASSED | `e2e/a11y.spec.ts` (+ per-journey scans); this session: 12 passed / 10 loud content-gated skips on chromium + mobile-chromium; gates listed in `docs/tests/BETA_SUPPORT_MATRIX.md` |
| Keyboard behaviour (tab order, no traps, visible focus, dialog entry/containment/escape/restoration, form submission) | AUTOMATED TEST PASSED | strengthened keyboard test (8 behaviours) + app-wide dialog focus-restoration fix (Phase 1 row); forms/menus beyond sign-in remain covered only by axe — deeper per-form keyboard specs are future work |
| Forms: labels, required, aria-describedby errors, announced states | IMPLEMENTED (axe-verified subset) | axe rulesets cover label/ARIA violations; explicit per-form assertions not yet written — honest partial |
| Manual screen-reader scripts (NVDA, VoiceOver, TalkBack, optional JAWS) | IMPLEMENTED (scripts); runs NOT VERIFIED | [`docs/tests/SCREEN_READER_SCRIPTS.md`](../tests/SCREEN_READER_SCRIPTS.md) — empty results log by design |
| Visual: contrast, 200% zoom, 320px, no horizontal scroll, reduced motion | AUTOMATED TEST PASSED (zoom/viewport/contrast) + MANUAL (reduced-motion, high-contrast) | `e2e/a11y.spec.ts` zoom tests; manual checklist in `BETA_SUPPORT_MATRIX.md` |
| Cross-browser matrix (chromium, firefox, mobile-chromium; WebKit) | AUTOMATED TEST PASSED (3 projects in CI); WebKit NOT VERIFIED | `playwright.config.ts` projects; WebKit project absent — documented as a pre-iOS-cohort requirement in `BETA_SUPPORT_MATRIX.md` |

## Phase 9 — Operational readiness and incident response

| Requirement | Status | Evidence |
| --- | --- | --- |
| Runbooks for all 20 required incident classes, each with the 11 required sections | IMPLEMENTED | [`docs/runbooks/`](../runbooks/README.md) — 20 runbooks + index |
| Runbooks rehearsed | NOT VERIFIED — every runbook carries `Rehearsed: NO` | rehearsal logging convention in `runbooks/README.md`; restore + rollback rehearsals are Cohort 1 entry conditions |
| Severity model + escalation + response targets | IMPLEMENTED | [`INCIDENT_SEVERITY.md`](./INCIDENT_SEVERITY.md) |
| Enforceable release checklist (SHA, checks, migrations, backup, rollback target, env changes, staging smoke, security review, monitoring, post-deploy smoke) | IMPLEMENTED | [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) — copied into every promotion PR |
| Rollback documentation (frontend, backend, DB forward-fix, migration limits, flag/provider/worker disablement) | IMPLEMENTED; non-production rollback drills NOT VERIFIED | [`ROLLBACK.md`](./ROLLBACK.md) + [`runbooks/production-rollback.md`](../runbooks/production-rollback.md); honest note: **no feature-flag system exists** |
| Ownership matrix | IMPLEMENTED (with deliberate `[UNASSIGNED]` backups) | [`OWNERSHIP.md`](./OWNERSHIP.md) — backup owner is a Cohort 1 entry condition |

## Phase 10 — Controlled staged launch

| Requirement | Status | Evidence |
| --- | --- | --- |
| Admission controls (invite-only, cap, pause, suspend, cohort assignment, admin visibility, abuse) | IMPLEMENTED (process) + EXTERNAL ACCESS REQUIRED (Supabase signup toggle rehearsal) | [`STAGED_LAUNCH.md`](./STAGED_LAUNCH.md) §1 — per-control status table; no in-app invite system, stated plainly |
| Cohort definitions (0: 5–10/48–72h; 1: 25/5–7d; 2: 75/5–7d; 3: 150) | IMPLEMENTED | `STAGED_LAUNCH.md` §2 |
| Objective entry/exit criteria + rollback triggers + decision owner | IMPLEMENTED | `STAGED_LAUNCH.md` §3–4 |
| Hard rules (no SEV-1/2, no integrity defect, no CI failure, no critical a11y defect, no uncontrolled cost, no expansion during incidents) | IMPLEMENTED | `STAGED_LAUNCH.md` §5 + repeated in the decision template's hard-rule check |
| Beta telemetry cohort report | IMPLEMENTED (template) | [`BETA_TELEMETRY_TEMPLATE.md`](./BETA_TELEMETRY_TEMPLATE.md) |
| Structured feedback mechanism with data minimization | IMPLEMENTED (schema); live form EXTERNAL ACCESS REQUIRED | [`BETA_FEEDBACK.md`](./BETA_FEEDBACK.md) |
| Launch decision record | IMPLEMENTED (template) | [`LAUNCH_DECISION_TEMPLATE.md`](./LAUNCH_DECISION_TEMPLATE.md) |
| Inviting users / communications / limit increases / paid AI load / cohort promotion / prod toggles | MANUAL VERIFICATION REQUIRED / EXTERNAL ACCESS REQUIRED — never automated | `STAGED_LAUNCH.md` §6 |

---

## Verification record (this session, 2026-07-16/17, local environment)

| Suite | Command | Result |
| --- | --- | --- |
| ESLint (zero warnings) | `npm run lint:ci` | PASS |
| TypeScript | `npm run type-check` | PASS |
| Frontend unit + coverage | `npm run test:coverage` | **228 passed, 0 failed** (27 files); lines 51.29% / branches 47.65% ≥ floors 45/40 |
| Frontend production build | `npm run build` (with `VITE_RELEASE_SHA`) | PASS; `release-sha` meta tag present in `dist/index.html` |
| Backend pytest + coverage | `pytest tests/` (Python 3.12 venv) | **1003 passed, 30 skipped, 0 failed**; coverage 70.38% ≥ 69% floor. Skips: 12 DB-gated + 18 Supabase-credential-gated |
| DB-gated tests, re-run against fresh Postgres 16 | `pytest tests/test_trading_constraints_db.py tests/integration` with local migrated DB | **12 passed** (incl. concurrent-oversell race); 18 remaining skips need Supabase test creds (run in `integration-tests.yml`) |
| Alembic | `alembic upgrade head` on fresh Postgres 16 | PASS (0001 → 0035 clean). `alembic check` not applicable by design (SQL-first migrations — documented in `ci.yml`) |
| OpenAPI drift | `export_openapi.py` + `git diff --exit-code` | NO DRIFT |
| E2E chromium (full) | `playwright test --project=chromium` | **24 passed, 8 loud skips, 0 failed** |
| E2E a11y (chromium + mobile-chromium) | `playwright test e2e/a11y.spec.ts` | **12 passed, 10 loud skips, 0 failed** — includes the 8-behaviour keyboard test |
| E2E firefox | — | NOT RUN locally (browser unavailable in sandbox; CI `e2e.yml` runs it on push) |

## Consolidated: external actions still required (humans with dashboard access)

1. Apply the GitHub branch rulesets (`CI_GUIDELINES.md` §3.8) — the single highest-leverage open item.
2. Verify Vercel system-env exposure + Railway SHA/APP_VERSION vars, then run `release-verification.yml` once against staging.
3. Configure/verify OpenAI (and Perplexity) budget alarms — compensating control for the missing global spend cap.
4. Confirm the Supabase signup toggle + account-linking setting; rehearse pause/unpause once.
5. Create the beta feedback form and link it.
6. Commission the independent security review (package is ready).
7. Verify `STAGING_URL` secret so the weekly ZAP DAST actually targets staging.

## Consolidated: manual tests still required

1. One staging pass each: email verification, expired reset link, real-Google sign-in, session-expiry UX.
2. Screen-reader scripts SR-1/SR-2 (before Cohort 0/1), SR-3 (before Cohort 2) — `SCREEN_READER_SCRIPTS.md`.
3. Restore rehearsal (`backup-restore.md` + recovery evidence template) and rollback drills on staging.
4. AI eval suite execution with committed report (`evals/README.md`).
5. Key-rotation first-execution logs (any one key end-to-end validates the runbook shape).

## Blockers preventing an unqualified 10/10 claim

- **B-1** Branch ruleset unapplied → "production cannot receive a red release" is documented, not yet technically enforced. (External, ~15 minutes.)
- **B-2** IRIS retry-after-failure design gap (duplicate-message risk on manual retype) — `BLOCKED` on a design decision; acceptable for beta only because failed sends are visibly surfaced.
- **B-3** No global AI spend ceiling — bounded by account cap + per-user quotas; provider budget alarm must be confirmed before Cohort 1.
- **B-4** Zero rehearsals (restore, rollback, rotation, runbooks) — procedures exist; evidence of execution does not. Cohort gates require the first ones.

With B-1 closed and the Cohort-0/1 entry conditions executed as gated above,
the beta meets the working definition of 10/10 for a 150-user, invite-only,
paper-trading product. Claims beyond that (real-money features, open signup,
scale) are explicitly out of scope of this document.
