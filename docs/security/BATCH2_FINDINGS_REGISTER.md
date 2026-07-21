# Security Findings Register — Readiness Programme

Repository-level security review. Reuses the existing threat model
(`docs/security/THREAT_MODEL.md`) and security-test inventory; new entries are
added only where the programme found a real gap. **No unresolved critical or
high-severity finding remains.** Credential rotation is a deferred closeout
action (not an implementation blocker).

## Findings

### SEC-B2-01 — AI output-token ceiling bypass  ·  **HIGH**  ·  RESOLVED
- **Category:** Budget-control bypass / resource exhaustion.
- **Component:** `app/routes/ai_proxy.py::_effective_chat_max_output_tokens` + reasoning-retry path.
- **Exploit scenario:** A small `max_tokens` request was inflated to the 8000-token
  server maximum (`max(requested, ceiling)`), and the reasoning-retry forced the
  budget *up to* the ceiling — uncapped per-request output spend regardless of the
  requested value.
- **Resolution:** Rewritten to `min(valid_request, ceiling)`; reasoning floor and
  retry both clamped to the ceiling. All provider paths (stream / non-stream /
  tool-call continuation / retry) derive from the single helper.
- **Verification test:** `test_ai_proxy_helpers.py`, `test_ai_proxy_utils.py::TestEffectiveChatMaxOutputTokens`, `test_ai_proxy.py` retry cap.
- **Residual risk:** None functional; add a per-request effective-limit metric label (observability follow-up).

### SEC-B2-02 — Un-guarded live AI-provider egress in tests  ·  **MEDIUM**  ·  RESOLVED
- **Category:** Secret leakage / cost / supply-chain-of-test.
- **Component:** test harness (no global guard).
- **Exploit scenario:** An accidentally un-mocked test could call the real provider,
  spending money, exercising a real key, and making CI non-deterministic.
- **Resolution:** `tests/ai_network_guard.py` (installed by conftest) blocks resolution
  of real AI-provider hosts; explicit `ALLOW_REAL_AI_PROVIDER_NETWORK=1` escape hatch.
- **Verification test:** `test_network_guard.py` (13); CI job `readiness-controls.yml::network-guard`.
- **Residual risk:** None.

### SEC-B2-03 — No pre-flight guard for fail-open / unsafe production config  ·  **MEDIUM**  ·  RESOLVED
- **Category:** Security/cost-control misconfiguration (fail-open).
- **Component:** startup + CI.
- **Exploit scenario:** Production could boot with auth disabled, debug routes on,
  wildcard CORS/hosts, or staging↔production resource crossover with no gate.
- **Resolution:** `app/env_validation.py` + `enforce_startup_environment()` wired into
  `create_app`; CI `env-schema` gate on synthetic vars. Fail-open budget/rate flags
  are surfaced as ERROR findings + startup SECURITY warnings (the dedicated
  `validate_rate_limit_configuration` / `validate_ai_budget_configuration` own the
  hard Redis requirement).
- **Verification test:** `test_env_validation.py` (26); CI `env-schema` good/bad configs.
- **Residual risk:** In-memory/fail-open flags remain a permitted single-worker-beta
  opt-in; flip `STARTUP_FATAL_CODES` to hard-fail once Redis is provisioned.

### SEC-B2-04 — JWT algorithm sourced from token header  ·  **LOW**  ·  OPEN (hardening)
- **Category:** Algorithm confusion (defence in depth).
- **Component:** `app/services/auth.py::_jwt_algorithm` → `_verify_jwt_with_secret(algorithms=[declared_alg])`.
- **Exploit scenario:** The verifier trusts the token's declared `alg`. Not exploitable
  today (symmetric HS256 secret vs. asymmetric ES256/JWKS are routed to different key
  material, so RS/HS confusion has no shared key; PyJWT rejects `none`), but trusting
  attacker-controlled `alg` is an anti-pattern.
- **Recommended resolution:** Pin an allowlist per verification path
  (`{"HS256"}` for the shared-secret path, `{"ES256","RS256"}` for the JWKS path)
  and reject any other declared algorithm before decode.
- **Verification test (to add):** `test_auth_functions.py` — reject `alg=none` / unexpected alg.
- **Residual risk:** Low; tracked as a hardening item.

### SEC-B2-05 — Secrets could leak inside free-text log values  ·  **LOW**  ·  RESOLVED
- **Category:** Sensitive logging.
- **Component:** `app/middleware/correlation.py` (key-based redaction only).
- **Resolution:** Added value-based `redact_text` (JWTs, bearer, `sk-` keys, credentialed
  URIs, inline secrets) + expanded sensitive-key set incl. financial fields.
- **Verification test:** `test_log_redaction.py` (22).
- **Residual risk:** None; pattern-based, extend patterns as new secret formats appear.

### SEC-B2-06 — Recovery-validator identifier interpolation  ·  **INFO**  ·  RESOLVED
- **Component:** `app/services/recovery_validator.py` (new).
- **Resolution:** `row_count` table names validated against an identifier allowlist before interpolation.
- **Verification test:** `test_recovery_validator.py::test_unsafe_table_identifier_is_refused`.

## Category coverage (reused existing controls — not duplicated)

| Category | Status | Evidence |
| --- | --- | --- |
| Authentication bypass | Controlled | `require_auth`/JWT verify; `test_auth_*` (109 tests); §SEC-B2-04 hardening |
| Authorisation bypass / IDOR | Controlled | verified `user_id` + RLS (`0005–0024`); endpoint matrix; residual: explicit cross-user test |
| SQL injection | Controlled | Supabase/SQLAlchemy parameterised; validator identifier allowlist (SEC-B2-06) |
| Prompt injection (direct/indirect/stored) | Controlled | `_contains_injection` + `test_ai_proxy_*` injection cases; context sanitisation |
| XSS | Controlled (frontend) | React escaping; CSP via `SecurityHeadersMiddleware`; `tsc` clean |
| CSRF | N/A | token-bearer auth, no cookie session for API |
| SSRF | Low surface | provider endpoints are fixed constants (OpenAI/Perplexity/Tavily) |
| Open CORS / host-header | Controlled | `validate_app_settings` (no wildcard in prod) + env validator |
| Rate-limit bypass / brute force | Controlled | Redis Lua atomic limiter; `test_rate_limit_*`, `test_global_concurrency_race_only_allows_configured_max` |
| Secret leakage / sensitive logging | Controlled | gitleaks `security.yml`; redaction SEC-B2-05; env validator never prints values |
| Debug/test/admin-route exposure | Controlled | `ENABLE_DEBUG_ROUTES` gate + env validator; admin routes `_require_admin` |
| Dependency vulnerabilities | Controlled | `dependabot.yml`, `security.yml` audit, pinned lockfiles |
| Budget-control bypass | Resolved | SEC-B2-01 + budget guard 84% cov |
| Quota race / replay / duplicate | Controlled | atomic limiter + `chat_turn_reconciliation` (idempotency) + invite primitive (Part 7) |
| Error-information leakage | Controlled | provider bodies never echoed (see `_call_openai` comments) |

## Severity summary

Critical: 0 · High: 0 open (1 resolved) · Medium: 0 open (2 resolved) ·
Low: 1 open (SEC-B2-04 hardening) · Info: 1 resolved.

Security may reach 9/10 once SEC-B2-04 is closed and the explicit cross-user IDOR
regression + a fresh `security.yml`/`dast.yml` scan on this commit are attached.
