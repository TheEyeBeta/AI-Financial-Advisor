# Batch 3 Execution Dossier — TheEye / AI-Financial-Advisor

**Date:** 2026-07-21 · **Tested base commit:** `5bad7e9` (`main`) + pinned Batch 1/2/3
working-tree changes (manifest `f9771405…`, see `docs/evidence/readiness/BATCH3_FREEZE.json`).

Batch 3 = **clean-environment and (attempted) staging execution**. The objective was
to convert 8/10 categories into *executed-evidence* 9/10. The honest outcome: this
sandbox is a genuine clean Linux environment (so backend + migrations + recovery +
a load smoke were really executed), but it has **no staging infrastructure**, so
staging deploy/auth/observability/DAST, the paid AI evaluations, live-provider
calls, and credential rotation could **not** be executed. Those are labelled
BLOCKED with exact requirements — not rounded up.

## Status legend
IMPLEMENTED · AUTOMATED-TESTED · **EXECUTED-CLEAN-LINUX** · EXECUTED-STAGING ·
MANUALLY-VERIFIED · NOT-EXECUTED · **BLOCKED** (external infra/authorization/payment).

---

## 1. Exact tested commit
Base `5bad7e946653d44e41482637df05f2b0a1a5d076` (`main`) + uncommitted Batch 1/2/3
changes pinned by a sha256 file-manifest (`f9771405296b7007…`, 21 source/test/workflow
files) in `docs/evidence/readiness/BATCH3_FREEZE.json`. Working tree: 576 tracked-modified
(pre-existing Windows CRLF noise) + 53 untracked (this programme's files + 19 evidence
artifacts). No `.env` tracked; on-disk `.env` is gitignored. Secret scan clean (only the
deliberate fake fixtures in `test_log_redaction.py` match). 19/19 evidence digests verify.

## 2. Clean Linux backend results — **EXECUTED-CLEAN-LINUX**
- **OS** Ubuntu 22.04.5 LTS (Linux 6.8 x86_64) · **Python** 3.10.12 · **pytest** 9.1.1.
- **Install:** system Python + pip from the committed lockfile pins (NOT the Windows `.venv`).
- **Full suite:** `python -m pytest -o addopts="" -q` → **1247 passed, 41 skipped, 0 failed, exit 0**, ~37s.
- **CI control gates (exit codes captured):** env-schema safe=**0** / unsafe=**1**; evidence-schema **verified 15→now 19**; network-guard **blocked** (exit 0); evidence-recorder self-test **5 passed**.
- **Type-check:** `alembic`/pytest import clean. Migration validation executed — see §10.
- Evidence: `WP-B3-CLEAN-BACKEND-*`.

## 3. Clean Linux frontend results — **EXECUTED (type-check) / BLOCKED (bundler+e2e)**
- **`npx tsc --noEmit` → exit 0** (whole TypeScript app type-checks on Linux). EXECUTED-CLEAN-LINUX.
- **`vitest` / `vite build` / `eslint` / `playwright` → BLOCKED**, root cause *proven* (not assumed):
  the committed `node_modules` carries Windows + partial-arch native binaries
  (`@swc/core-win32-x64-msvc`, `@esbuild/win32-x64`; `vitest/…/@rolldown` ships only
  `binding-linux-ppc64/-s390x`, **no `linux-x64-gnu`**). A non-destructive Linux-native
  overlay was attempted; a full `npm ci` is required and **exceeds the sandbox's 45s
  non-backgroundable per-command limit**. These run green in **CI** (`ci.yml` frontend job:
  `npm ci`→lint→type-check→`test:coverage`→build; `e2e.yml`: Playwright) on Linux runners.
- Evidence: `WP-B3-FRONTEND-*`.

## 4. Backend and frontend coverage — **EXECUTED (backend) / CI (frontend)**
- **Global backend coverage 76%** (7531 stmts, 1833 missed) — executed in two `--cov-append`
  chunks; above the CI floor of 69% (`pytest.ini`). Critical modules: auth **93%**,
  ai_budget_guard **84%**, env_validation **91%**, correlation **91%**, invite_redemption **97%**,
  recovery_validator **84%**.
- Frontend coverage: BLOCKED here; runs via `vitest run --coverage` in CI.

## 5. Staging deployment identity — **BLOCKED**
No staging infrastructure (Vercel/Railway/Supabase staging) is reachable from this
environment and no deploy credentials are present. The env validator is ready to gate a
staging config (`python -m app.env_validation`), and the sanitised config-evidence format
is specified. Requires: a provisioned staging stack + human-run deploy of commit `5bad7e9`.

## 6. Authentication evidence — **AUTOMATED-TESTED / staging BLOCKED**
Clean-CI: 109 auth tests pass (missing/malformed/expired/bad-sig/wrong-issuer/env-cross/
role/service-role/ES256-JWKS); auth module 93% covered; endpoint matrix shows no missing-auth
route. **Staging Phase-4 proof NOT-EXECUTED** (real browser sign-in, prod-JWT-rejected-by-staging,
logout, CORS/host rejection against a live deployment). Per the stated rule, **auth stays 8/10**
until that staging proof exists.

## 7. Observability evidence — **IMPLEMENTED+TESTED / live BLOCKED**
Redaction executed+tested (22 tests); alerts (12) with thresholds/queries/recovery and the
metrics coverage matrix are complete. **No live alert-trigger events** (Phase 5 needs staging
traffic + Sentry/Datadog). Per the rule "a written alert definition without a triggered event
is not 9/10 evidence," **observability stays 8/10**.

## 8. Alert-trigger evidence — **NOT-EXECUTED (BLOCKED)**
Requires staging + a metrics/alerting backend to deliberately trigger the nine safe incidents
and record trigger→detect→notify→recover timings.

## 9. Load and soak results — **EXECUTED (local smoke) / staging soak BLOCKED**
- **Local in-process load smoke EXECUTED** against the real ASGI app (full middleware stack)
  via httpx ASGITransport with warm-up + measured phases:
  smoke (n=200,c=10) p95 **20ms**, normal (n=1000,c=25) p95 **66ms**, busy (n=2000,c=50) p95 **109ms**,
  **0% error rate** throughout, ~550 rps. All PASS predefined p95 thresholds. First run FAILed
  (per-request INFO logging + cold-start inflated p95); diagnosed → silenced driver logging +
  added warm-up → PASS. Both runs preserved. Evidence: `WP-B3-LOAD-SMOKE-*`.
- **Spike/stress/endurance/4-hour soak → BLOCKED**: need a real staging backend + Redis + k6
  + the deterministic provider wired server-side + hours of runtime. k6 profiles a–d are
  syntax-valid with p95/p99/error thresholds; execution is staged.

## 10. Recovery-rehearsal results — **EXECUTED-CLEAN-LINUX (migrations+validator) / backup-restore BLOCKED**
On a disposable userspace Postgres (`pgserver`, non-root), emulating the Supabase baseline
(anon/authenticated/service_role roles + `pgcrypto`/`uuid-ossp` shims mapping to core
`sha256`/`gen_random_uuid`):
- **`alembic upgrade head` → rc 0 — all 36 migrations applied clean from an empty DB**, reaching
  head **`0036_core_audit_events`**.
- **Recovery validator EXECUTED against the live schema → `ok: True` (7 ok / 0 fail / 3 skip)**:
  connectivity, migration-head, six schemas, `pgcrypto`, no orphaned auth users, backup-freshness.
- **Real defect found + corrected by execution:** the chat table is `ai.chats`, not the
  `ai.chat_sessions` guessed in Batch 2 — `recovery_validator.DEFAULT_REQUIRED_TABLES` corrected
  and re-verified (13 tests green).
- `alembic check` rc 255 is an **autogenerate artifact** of raw-SQL (`op.execute`) migrations
  (public-schema tables reported as "new operations") — **not** schema drift; the upgrade applied
  cleanly and reached head.
- **NOT executed:** restore from an actual backup dump + app read/write + auth after restore +
  RTO/RPO timing → needs a staging/disposable recovery project with a real backup. Procedure +
  evidence template ready (`docs/recovery/STAGING_RESTORE_REHEARSAL.md`).
- Evidence: `WP-B3-MIGRATE-RECOVERY-*`.

## 11. Accessibility results — **BLOCKED**
axe/keyboard/screen-reader runs need the frontend running in a browser (blocked with the bundler,
§3). Existing `e2e/a11y.spec.ts` runs in `e2e.yml`. NOT-EXECUTED here.

## 12. Security results — **AUTOMATED-TESTED / staging DAST BLOCKED**
0 open critical/high (register: 1 High + 2 Medium resolved; 1 Low open — JWT alg-pinning, not
exploitable). Prompt-injection/CORS/rate-limit/secret-scan controls tested. **Staging DAST
(`dast.yml`) + a fresh gitleaks/`security.yml` run on this commit → NOT-EXECUTED here** (CI/staging).

## 13. Cheap AI structural-evaluation result — **NOT-EXECUTED (correctly gated)**
Phase 10 is explicitly gated on staging auth/budget/observability being verified — they are not.
Not run (also avoids spend). Requires staging + the dedicated cheap-eval key + hard budget.

## 14. Production-model evaluation result — **NOT-EXECUTED (correctly gated + paid)**
Gated on the cheap eval passing; requires a dedicated evaluation key, hard daily cap, and
authorization. Not run.

## 15. Live-provider sample result — **NOT-EXECUTED (correctly gated + paid)**
The network guard's escape hatch (`ALLOW_REAL_AI_PROVIDER_NETWORK=1`) exists for exactly this
capped 50-request/5-concurrent sample, but it is gated on the prior phases and requires
authorization + a staging key. Not run. **No live-provider call was made.**

## 16. Credential-rotation evidence — **DEFERRED (unchanged)**
Per the governing rule, rotation happens only after the environment-execution work. No active
compromise found. Not rotated. Checklist stands (Batch 1 §23).

## 17. Complete evidence index
`docs/evidence/readiness/` — **19 tamper-evident records** (all digests verify):
Batch 1 (5): `WP-{BASELINE,02,03,12,13}`. Batch 2 (10): `WP-B2-{SUITE,STARTUP,PROVIDER,REDACTION,
AUTH,RECOVERY,INVITE,FRONTEND,COVERAGE,LOAD}`. Batch 3 (4): `WP-B3-{MIGRATE-RECOVERY,CLEAN-BACKEND,
FRONTEND,LOAD-SMOKE}` + `BATCH3_FREEZE.json`. Verify: `python -c "from scripts.evidence_recorder import verify_file; ..."`.

## 18. Final score for every category (executed-evidence only)

| # | Category | Prev | **Final** | Basis / why not higher |
| --- | --- | --- | --- | --- |
| 1 | Functional correctness | 8 | **8** | backend 1247 + tsc EXECUTED clean; frontend unit/e2e CI-gated (not executed here) |
| 2 | Reliability & fault tolerance | 8 | **8** | load smoke 0%-error EXECUTED; failure-injection + soak need staging |
| 3 | Security | 8 | **8** | 0 open crit/high (tested); staging DAST + fresh scan NOT-EXECUTED |
| 4 | Auth & authz | 8 | **8** | 93% cov + matrix; **staging auth proof NOT-EXECUTED** (explicit 9/10 gate) |
| 5 | Performance & scalability | 7 | **7** | local smoke EXECUTED w/ thresholds; staging load/spike/stress/soak BLOCKED |
| 6 | Observability & alerting | 8 | **8** | redaction tested + alerts defined; **no live alert-trigger events** |
| 7 | DB integrity & recovery | 8 | **8** | migrations rc0 + recovery validator EXECUTED on real PG; backup-restore rehearsal NOT-EXECUTED |
| 8 | AI safety & cost control | 8 | **8** | ceiling/guard/stub tested; cheap+prod evals + live sample NOT-EXECUTED (gated) |
| 9 | Accessibility & frontend | 7 | **7** | tsc clean; axe/SR runs BLOCKED (bundler) |
| 10 | Deployment & release | 8 | **8** | CI gates EXECUTED (exit codes); staging deploy + branch ruleset external |
| 11 | Operational readiness | 7 | **7** | alerts+runbooks; no incident rehearsal executed |
| 12 | **Testing & evidence quality** | 8 | **9** | 1247 tests + 76% cov + CI gates all **EXECUTED-CLEAN-LINUX**; 19 tamper-evident artifacts; no external dependency for the core claim |
| 13 | Invites & usage caps | 7 | **7** | atomic primitive concurrency EXECUTED; DB invite schema not built |
| 14 | Documentation & maintainability | 8 | **8** | complete; `.gitattributes` EOL fix outstanding |

**Only one category (Testing & evidence quality → 9)** is raised, because it is the only one
whose 9/10 bar can be met with evidence executable in this environment. Every other 8 is held
at 8 precisely because its remaining work is staging/CI-external — not rounded up.

## 19. Remaining risks
- No staging execution yet for auth, observability alerts, load/soak, DAST — the largest bloc.
- Frontend runtime (unit/e2e/a11y/build) unproven outside CI in this session.
- Backup-restore rehearsal (vs. migrate-from-clean) still pending.
- `pgcrypto`/`uuid-ossp` were shimmed to core functions for the userspace rehearsal; a real
  Supabase target provides them natively (no behavioural difference for the tested objects).
- Low: JWT algorithm-pinning hardening (SEC-B2-04) open.

## 20. Beta-launch recommendation
**Do not open the invite-only beta yet.** The executed evidence (clean-Linux backend 1247/0,
76% coverage, real migrations + recovery, 0%-error load smoke, 0 open critical/high) supports a
**tightly-controlled internal alpha**. The public capped beta requires the staging bloc to be
executed first, in this order: (1) deploy `5bad7e9` to staging + env-validator gate; (2) Phase-4
staging auth proof; (3) Phase-5 live alert-trigger evidence; (4) mocked staging load + 4h soak;
(5) backup-restore rehearsal; (6) cheap→prod eval + capped live sample; (7) credential rotation.

## 21. Rollback recommendation
Ship behind the existing release policy (`RELEASE_POLICY.md`) with health/readiness gating and
`verify-release.mjs` SHA checks. Rollback = redeploy the previous known-good SHA. **Caveat:**
Alembic migrations are forward-only additive; a code rollback does **not** auto-revert schema —
keep the new schema backward-compatible with the prior release (it is, for `5bad7e9`), and treat
any destructive migration as a separate, gated change with a tested down-path.

## 22. Exact unresolved blockers
1. **No staging environment** (deploy + Supabase + Redis + OpenAI staging project) — blocks Phases 3,4,5,6-soak,9,12.
2. **Sandbox 45s non-backgroundable command limit** — blocks Linux `npm ci` (frontend unit/build/e2e) and long-running processes; resolved by CI Linux runners.
3. **Authorization + payment** for AI evaluations (Phases 10,11) and the live-provider sample (Phase 12).
4. **Backup artifact + disposable recovery project** for the restore-from-backup rehearsal (Phase 7 remainder).
5. Credential rotation (Phase 13) — intentionally deferred to closeout.

---

### One-line status
Everything executable in a clean Linux environment was **actually executed** — 1247 backend
tests (0 fail), 76% coverage, all 36 migrations from clean + recovery validator on real Postgres
(which found and fixed a real schema-name bug), CI gates with real exit codes, and a 0%-error
load smoke. **Testing & evidence quality reaches an executed 9/10.** All remaining 8→9 conversions
are gated on staging/CI infrastructure that does not exist in this session and were **not** rounded up.
