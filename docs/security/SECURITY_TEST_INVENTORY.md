# Security Test Inventory — control → automated evidence

**Owner:** TheEyeBeta · **Date:** 2026-07-16
Maps each Phase 6 security-test category to the automated tests that exist in
CI today, with gaps stated plainly. All cited backend tests run in `ci.yml`
(`backend` job) or `integration-tests.yml`; frontend tests run in `ci.yml`
(`frontend` job). None of this is intrusive against production.

| # | Category | Automated evidence | Status |
| --- | --- | --- | --- |
| 1 | Authentication bypass | `test_auth_service.py` (bypass flags rejected in prod, token extraction hardening), `test_public_endpoint_auth_rate_limit.py`, `integration/test_auth.py` | AUTOMATED TEST PASSED |
| 2 | Onboarding bypass | `src/components/auth/__tests__/ProtectedRoute.test.tsx` (client gate) + backend JWT enforcement tests | AUTOMATED TEST PASSED (client+API layers; RLS layer see #3) |
| 3 | IDOR / BOLA (cross-user chat & portfolio access) | `test_trading_constraints_db.py` (DB-level, real Postgres); chat paths derive user from verified JWT (`test_ai_proxy.py`) | PARTIAL — trading RLS tested directly; `ai.*`/`academy.*` RLS lacks direct cross-user read tests (**gap G-2**) |
| 4 | Admin privilege escalation | `test_admin_auth.py`, `test_admin_route_auth.py`, `test_admin_routes.py`, `test_meridian_refresh_all_auth.py` | AUTOMATED TEST PASSED |
| 5 | Mass assignment | Pydantic request models constrain fields per route | NOT VERIFIED — no dedicated negative-field test sweep (**gap G-3**) |
| 6 | Invalid / expired / wrong-audience JWT | `test_auth_service.py` (HS256 verify, REST fallback, malformed/missing bearer), `test_auth_functions.py` | AUTOMATED TEST PASSED (audience/issuer-specific negative cases folded into verify tests; extend if reviewer flags) |
| 7 | Open redirects | `src/lib/__tests__/auth-redirect.test.ts`, `src/lib/__tests__/url.test.ts` | AUTOMATED TEST PASSED |
| 8 | OAuth state/callback errors | `src/lib/__tests__/auth-callback.test.ts`, `src/pages/__tests__/AuthCallback.test.tsx` | AUTOMATED TEST PASSED |
| 9 | WebSocket ticket reuse / expiry / origin | `test_ws_tickets.py` (single-use, hashed, unpredictable, TTL, wrong-endpoint burn, bad-origin reject, JWT-in-URL reject) | AUTOMATED TEST PASSED |
| 10 | Rate-limit enforcement | `test_rate_limit.py`, `test_rate_limit_production.py`, `test_rate_limit_redis*.py`, `test_rate_limit_service.py`, `integration/test_rate_limiting.py` | AUTOMATED TEST PASSED |
| 11 | Malformed inputs / injection payloads | Pydantic validation + bandit static scan (`security.yml`); DB constraints (`test_trading_constraints_db.py`) | PARTIAL — no fuzz/negative-payload suite on chat/search endpoints (**gap G-4**) |
| 12 | Unsafe HTML rendering | Single `dangerouslySetInnerHTML` in repo (`src/components/ui/chart.tsx`, static CSS only, no user content); chat renders via markdown component | IMPLEMENTED — add a lint guard if surface grows |
| 13 | Sensitive values in logs | `TELEMETRY_PRIVACY.md` policy; `src/lib/__tests__/telemetry.test.ts`; audit log excludes secrets | AUTOMATED TEST PASSED (frontend policy) / IMPLEMENTED (backend log review manual) |
| 14 | CSP regressions | `src/tests/security-headers.test.ts` (no inline/eval scripts, no wildcard connect, frame/plugin blocks, base-uri, form-action) against `vercel.json` + `index.html` | AUTOMATED TEST PASSED |
| 15 | Security-header regressions | same file (clickjacking + MIME hardening) | AUTOMATED TEST PASSED |
| 16 | Secret scanning | gitleaks in `security.yml#secret-scan` (`.gitleaks.toml`), fails the build on findings; history scanned per `SECRET_SCANNING.md` | AUTOMATED TEST PASSED |
| 17 | Dependency vulnerabilities | `node-audit`, `python-audit` (pip-audit), `python-bandit` — all blocking | AUTOMATED TEST PASSED |
| 18 | DAST baseline | `dast.yml` — weekly OWASP ZAP baseline against staging, `fail_action: true` | AUTOMATED (staging-only; needs `STAGING_URL` secret verified — EXTERNAL ACCESS REQUIRED) |

## Gaps (tracked, honest)

- **G-1 Global AI abuse ceiling** — per-user/IP limits only; no aggregate cap. See `docs/ai/AI_CONTROLS.md`.
- **G-2 Direct RLS cross-user tests for `ai.*` and `academy.*`** — write DB-level tests in the style of `test_trading_constraints_db.py`.
- **G-3 Mass-assignment sweep** — negative tests posting unexpected fields to each mutating endpoint.
- **G-4 Injection/fuzz corpus for chat + search inputs** — deterministic malformed-payload suite (the AI-side prompt-injection corpus now lives in `backend/websearch_service/evals/`, execution pending).
- **G-5 Secret-scan "fails correctly" proof** — gitleaks blocks on findings; a canary test (deliberately-planted dummy secret on a branch) has not been run. MANUAL VERIFICATION REQUIRED.

## Secrets-control inspection (Phase 6 checklist, 2026-07-16)

- Hardcoded credentials: none found (gitleaks + manual grep of `src/`, `backend/`).
- `.env` leakage: `.gitignore` covers `.env*`; `.env.example` contains placeholders only.
- Service-role keys in frontend: prohibited and **tested** (`test_validate_auth_configuration_rejects_vite_srk_in_production`).
- Tokens in test artifacts: Playwright artifacts gitignored (`test-results/`, `playwright-report/`).
- Tokens in callback URLs: WS rejects JWT query params (tested); OAuth uses PKCE `?code=` exchange, tokens not logged.
- Secrets in docs: none found; `SECRET_SCANNING.md` governs.
- Git history: gitleaks history scan per `SECRET_SCANNING.md` (last full-history run predates this doc — re-run and log per release).
