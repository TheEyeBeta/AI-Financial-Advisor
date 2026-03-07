# Security Analysis — AI Financial Advisor ("The Eye")

> **Prepared by:** Principal Security Engineer / Red-Blue-Purple Team Review
> **Date:** 2026-03-07
> **Codebase reviewed:** Full repository — FastAPI backend, React/Vite frontend, Supabase
> **Classification:** Internal — treat as sensitive

---

## 1. Executive Summary

The AI Financial Advisor is a React SPA backed by a FastAPI Python microservice
(the "websearch service") and Supabase for auth and database. The overall
architecture direction is sound: API keys are not exposed in the frontend build,
and Supabase Row-Level Security is enabled on all tables.

However, **several critical and high-severity vulnerabilities were discovered**
that would have allowed unauthenticated abuse of expensive AI APIs, privilege
escalation to admin, and leakage of configuration intelligence. These have been
fixed in this PR. Additional Supabase-side SQL must be run before launch.

**Pre-fix score: 3.4 / 10 overall.** Post-fix: estimated 6.8 / 10 pending
Supabase SQL deployment and ongoing operational hardening.

---

## 2. Architecture Risk Review

### Component map

```
User Browser
    │  HTTPS (Vercel CDN)
    ▼
React SPA (Vite bundle, no secrets)
    │  HTTPS + Supabase JWT
    ├──► Supabase (anon key in VITE_ env var — expected)
    │       ├── Auth (email/password, OAuth)
    │       ├── Postgres (RLS enforced)
    │       └── Storage (not currently used)
    │
    └──► FastAPI backend (websearch_service)
             ├── /api/chat  → OpenAI Responses API
             ├── /api/chat/title → OpenAI Chat Completions
             ├── /api/ai/analyze-quantitative → OpenAI
             ├── /api/search → Tavily
             ├── /api/v1/ai/context → stub (Trade Engine)
             ├── /api/stock-price/{ticker} → Supabase (service_role)
             └── /ws/live → WebSocket stub
```

### Trust boundaries

| Boundary | Direction | Risk |
|---|---|---|
| Browser → Vercel CDN | User-controlled | XSS, CSRF, session theft |
| Browser → Supabase | Supabase JWT | IDOR via RLS gap |
| Browser → FastAPI | **Previously unauthenticated** | Key abuse, cost exhaustion |
| FastAPI → OpenAI | OPENAI_API_KEY | Credential theft, cost exhaustion |
| FastAPI → Supabase | service_role key | Full database bypass |
| Supabase → auth.users | Supabase internal | Trigger abuse |

---

## 3. Threat Model

### 3.1 Frontend

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| Session JWT (in localStorage via Supabase) | Session hijack, ATO | XSS | Full account takeover | Critical |
| VITE_SUPABASE_ANON_KEY (in JS bundle) | Supabase API abuse | Source inspection | Anon-level DB access (RLS-bounded) | Medium |
| VITE_SUPABASE_URL (in JS bundle) | Target Supabase project | Source inspection | Enumeration attacks on anon-accessible tables | Low |
| Admin route enforcement | Privilege escalation | Client-side bypass | Admin UI access | High (backend bypass) |

**Key insight:** The anon key being in the bundle is expected and intentional for
Supabase. The risk is bounded by RLS policies, not by key secrecy.

### 3.2 Backend / API

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| OPENAI_API_KEY | Cost exhaustion, data theft | Unauthenticated endpoints | Unlimited AI API spend | **Critical (fixed)** |
| PERPLEXITY_API_KEY | Same as above | Same | Same | **Critical (fixed)** |
| TAVILY_API_KEY | Search abuse | Unauthenticated /api/search | Unlimited search spend | **Critical (fixed)** |
| Rate limiter state | Cost-limit bypass | IP header spoofing | Unlimited requests per IP | **High (fixed)** |
| Audit log integrity | Cover tracks | No log signing | Undetected abuse | Medium |

### 3.3 Auth / Session

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| Password reset flow | Account takeover | Email interception | Account takeover | High |
| JWT session token | ATO | XSS (if successful) | Full user access | Critical |
| Admin privilege | Privilege escalation | RLS policy gap | Admin access to all user data | **Critical (fixed)** |
| Email enumeration | User list disclosure | Signup/reset endpoints | Target list for phishing | Medium |

### 3.4 Supabase / Database

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| users table (all rows) | Mass PII exfil | Admin Supabase dashboard misconfiguration | Full user PII dump | Critical |
| service_role key | Full DB bypass | Backend env var theft | Complete database access | Critical |
| RLS policies | IDOR | Policy gap exploitation | Cross-user data access | High |
| userType column | Privilege escalation | Missing WITH CHECK on UPDATE | Self-promotion to Admin | **Critical (fixed)** |

### 3.5 Admin Panel

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| User list + emails | PII exfiltration | Broken admin auth | CSV export of all PII | High |
| toggleAdminStatus() | Privilege escalation | Admin panel access | New admin accounts | High |
| deleteUser() | Destructive action | Admin panel access | Mass user deletion | High |

### 3.6 CI/CD and Infrastructure

| Asset | Attacker Goal | Entry Point | Worst Case | Risk |
|---|---|---|---|---|
| GitHub Actions secrets | Credential theft | Supply chain attack | Production env var exfil | Critical |
| .env files | Credential theft | Committed secrets, artifact leak | All keys compromised | Critical |
| Vercel deployment tokens | Deploy poisoning | Token theft | Malicious frontend deployment | High |

### 3.7 Third-Party Integrations

| Integration | Risk |
|---|---|
| OpenAI | API key abuse, prompt injection via user messages |
| Perplexity | API key abuse, fallback trigger abuse |
| Tavily | API key abuse, SSRF via malicious queries |
| Supabase | Service-role key exfiltration |

---

## 4. Red Team Findings

### RF-001: Unauthenticated AI API Proxy — CRITICAL (Fixed)

**Attack:** POST /api/chat with any message body from any origin.
**Prerequisite:** None. No authentication was required on any backend endpoint.
**Method:** Direct HTTP request without credentials:
```
POST https://your-backend.railway.app/api/chat
Content-Type: application/json
{"message": "write me 10000 words about...")
```
**Impact:** Unlimited OpenAI API consumption at the operator's expense.
**Difficulty:** Trivial (1 line of curl).
**Detection signals:** Spike in OpenAI billing; rate limiter logs.
**Mitigation:** JWT auth middleware added to all `/api/chat`, `/api/chat/title`,
`/api/ai/analyze-quantitative`, and `/api/search` endpoints.
**Residual risk:** Low. Rate limits remain as a secondary defence.

---

### RF-002: user_id Spoofing for Rate Limit Bypass / Audit Poisoning — HIGH (Fixed)

**Attack:** Pass any user's UUID as `user_id` in the ChatRequest body.
**Prerequisite:** None (pre-fix). Knowledge of another user's UUID (post-fix: moot).
**Method:**
```json
POST /api/chat
{"message": "hello", "user_id": "victim-uuid"}
```
**Impact:** Burn another user's rate-limit quota; create false audit log entries
attributing requests to another user.
**Difficulty:** Low — UUIDs are not secret; they appear in Supabase row IDs.
**Mitigation:** `user_id` from request body is now ignored. Rate limiting and audit
logging use `auth_user.auth_id` extracted from the verified JWT.

---

### RF-003: IP Header Spoofing for Rate Limit Bypass — HIGH (Fixed)

**Attack:** Send `X-Forwarded-For: <fresh-IP>` on every request.
**Prerequisite:** Direct access to the backend (no WAF in between).
**Method:**
```
POST /api/chat
X-Forwarded-For: 1.2.3.4
```
Rotate the IP on each request batch to avoid per-IP limits.
**Impact:** Effectively unlimited rate limit for unauthenticated callers.
**Difficulty:** Low.
**Mitigation:** X-Forwarded-For is now only trusted when the direct connecting
IP is in the configured trusted-proxy range (RFC 1918 or TRUSTED_PROXY_IPS env var).

---

### RF-004: Privilege Escalation via Supabase RLS — CRITICAL (Fixed, SQL required)

**Attack:** A regular authenticated user updates their own `userType` to `'Admin'`.
**Prerequisite:** Valid Supabase account.
**Method:**
```javascript
// Client-side with the anon key:
supabase.from('users')
  .update({ userType: 'Admin' })
  .eq('auth_id', supabase.auth.user().id)
```
**Root cause:** The UPDATE policy had `USING` but no `WITH CHECK`. In PostgreSQL,
without `WITH CHECK`, any column can be written to on rows that match `USING`.
**Impact:** Any user becomes an admin and gains access to the admin panel,
user deletion, privilege promotion, and aggregate data.
**Difficulty:** Low — one SDK call.
**Detection:** Supabase audit log; admin user count anomaly.
**Mitigation:** `harden_rls_policies.sql` adds `WITH CHECK` that prevents
regular users from modifying `userType`.
**Residual risk:** Medium until the SQL is run in production.

---

### RF-005: Unauthenticated /api/search Tavily Proxy — CRITICAL (Fixed)

**Attack:** GET /api/search?query=anything from any client.
**Impact:** Unlimited Tavily search API spend. Tavily bills per search.
**Difficulty:** Trivial.
**Mitigation:** `/api/search` now requires JWT auth and is rate-limited per user.

---

### RF-006: News Table Open Write (SQL injection-adjacent) — HIGH (SQL required)

**Attack:** Any anon or authenticated user inserts fake/malicious news articles.
**Prerequisite:** None (anon key).
**Method:**
```javascript
supabase.from('news').insert({
  title: '<script>alert(1)</script>',
  link: 'https://evil.com',
  summary: 'Malicious content...'
})
```
**Root cause:** The initial `add_news_table.sql` created a policy `FOR ALL ... WITH CHECK (true)`.
**Impact:** News feed poisoning, potential XSS if the frontend renders HTML.
**Mitigation:** `harden_rls_policies.sql` removes write access for authenticated/anon roles.

---

### RF-007: Denial-of-Wallet via /api/chat/title — HIGH (Fixed)

**Attack:** Call `/api/chat/title` 60 times/minute (the configured limit) per attacker IP.
**Impact:** 60 × 500 chars × token cost per minute. At scale, significant billing.
**Mitigation:** Auth added to title endpoint; rate limiting now tracks by verified user.

---

### RF-008: Information Disclosure in Error Messages — MEDIUM (Fixed)

**Attack:** Trigger a 500 error to learn environment variable names.
**Previous response:** `"detail": "OPENAI_API_KEY is not configured on the server."`
This tells an attacker: (a) the service uses OpenAI, (b) the env var name.
**Mitigation:** Error messages now log to server logs only; clients receive generic messages.

---

### RF-009: Health Endpoint Version/Environment Disclosure — MEDIUM (Fixed)

**Attack:** GET /health to learn version + environment.
**Previous response:** `{"version": "0.1.0", "environment": "development"}` in production.
**Mitigation:** Version and environment are only returned in non-production mode.

---

### RF-010: Admin Panel Scope Leak — HIGH

**Attack:** Admin's aggregate stats (`fetchChatStats`, `fetchTradingStats`) use Supabase
client queries without admin-scope policies. The queries return data scoped to the
admin's own rows only (because RLS filters by `auth.uid()`), but the admin UI
presents these as "total platform stats" — misleading but not a security issue.
**Real risk:** The `fetchUsers()` query returns ALL users from `public.users`. The
`is_current_user_admin()` check in the SELECT policy allows this. An attacker who
gains admin (via RF-004) gets a full user roster with names and emails.
**Mitigation (RF-004 already closed):** Add backend-enforced admin verification.

---

### RF-011: WebSocket Without Authentication — MEDIUM

**Attack:** Connect to `ws://backend/ws/live` without credentials.
**Impact:** Currently stub-only (no live data). Becomes critical when Trade Engine
is connected and streams real market data or signals.
**Mitigation (recommended):** Add JWT validation on WebSocket connection via
query parameter or first-message handshake before streaming any data.

---

### RF-012: SSRF via Tavily Query — LOW

**Attack:** Craft a search query that causes Tavily to fetch internal resources.
**Prerequisite:** Tavily does not perform SSRF itself, but user-controlled query
goes to an external party who may attempt DNS rebinding or similar.
**Mitigation:** The query is passed as a search term, not a URL. Risk is low
but queries should be logged for abuse detection.

---

### RF-013: Supply Chain via npm / pip — MEDIUM

**Attack:** Malicious dependency updates that add exfiltration code.
**Impact:** Full credential theft.
**Mitigation:** Pin exact dependency versions; run `npm audit` and `pip-audit` in CI.

---

### RF-014: Missing Content Security Policy — HIGH (Fixed)

**Attack:** XSS payload executes unrestricted — no CSP to limit script sources.
**Impact:** With a stored XSS, attacker exfiltrates Supabase JWT from localStorage.
**Mitigation:** CSP added to `vercel.json` restricting script/style/connect sources.
**Note:** `unsafe-inline` for scripts is a known weakness (Vite SPA requirement).
Move to nonce-based CSP when feasible.

---

### RF-015: Missing HSTS — MEDIUM (Fixed)

**Attack:** SSL stripping attack on first connection.
**Mitigation:** HSTS with 1-year max-age, includeSubDomains, preload added.

---

## 5. Blue Team Architecture Recommendations

### 5.1 Secret Management

| Secret | Current | Recommended |
|---|---|---|
| OPENAI_API_KEY | `.env` file | Vault / Railway secrets / Vercel env vars — never committed |
| SUPABASE_SERVICE_ROLE_KEY | `.env` file | Same. Rotate every 90 days. |
| SUPABASE_JWT_SECRET | Not set | Must be set to enable local JWT verification |
| PERPLEXITY_API_KEY | `.env` file | Same as above |
| TAVILY_API_KEY | `.env` file | Same as above |

**Mandatory:** Run `git-secrets` or `trufflehog` pre-commit. Add `.env` and `*.env` to
`.gitignore` (already done) AND to a CI secret-scanning step.

### 5.2 Backend Key Isolation

- Each external API key should only be accessible to the service that needs it.
- The websearch service needs: `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`.
- It does NOT need `SUPABASE_SERVICE_ROLE_KEY` for most operations — the stock price
  endpoint is the exception. Consider splitting this into a separate microservice.
- Set spend alerts on OpenAI, Perplexity, and Tavily dashboards.

### 5.3 Rotation Strategy

| Secret | Rotation Trigger | Rotation Period |
|---|---|---|
| OpenAI API key | Any suspected breach | 90 days max |
| Supabase service_role key | Any suspected breach | 90 days max |
| Supabase JWT secret | Key compromise | 1 year max |
| Tavily key | Any suspected breach | 90 days max |

### 5.4 Auth / Session Hardening

1. **Supabase session storage:** Supabase stores JWTs in localStorage by default.
   For a financial app, consider using `storageKey` with a custom secure storage
   adapter that stores in httpOnly cookies server-side (requires a thin auth proxy).
2. **Password policy:** Enforce minimum 12 chars, check against HaveIBeenPwned.
3. **Email verification:** Ensure `email_verified_at` is checked before granting
   access to financial data (currently tracked but not enforced in all RLS policies).
4. **MFA:** Supabase supports TOTP. Enable it as optional now, mandatory for admins.
5. **Session expiry:** Set a short JWT expiry (15 minutes) with automatic refresh.
   Default Supabase expiry is 1 hour — acceptable for now.
6. **Admin accounts:** Require MFA for any account with `userType='Admin'`.
7. **Concurrent session limit:** Not currently enforced. Consider limiting to 3
   active sessions per user.

### 5.5 RBAC Recommendations

Currently: binary User/Admin. Recommended additions:
- `ReadOnly` — can view data but not create trades
- `PremiumUser` — can access advanced AI features with higher rate limits
- `Auditor` — can read audit logs but not user data

### 5.6 Rate Limiting Hardening

The current in-memory rate limiter has two critical weaknesses:
1. **State is process-local:** Multiple Uvicorn workers or multiple backend instances
   have independent rate limiters, effectively multiplying all limits by the number
   of processes. Migrate to Redis-backed rate limiting (use `redis-py` or `fastapi-limiter`).
2. **State is not persistent:** A backend restart clears all rate limit state.

**Recommended:** Replace the in-memory implementation with a Redis-backed limiter:
```python
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
import redis.asyncio as aioredis
```

### 5.7 Anti-Automation

- Add exponential backoff signalling (Retry-After header) — already done.
- Add bot score from Cloudflare Turnstile or hCaptcha on signup and password reset.
- Flag accounts with >10 failed login attempts for step-up verification.

### 5.8 WAF / CDN Strategy

- Vercel provides basic DDoS protection. For a financial app, add Cloudflare
  in front with:
  - Bot Fight Mode enabled
  - Rate limiting rules at the CDN layer (before requests hit origin)
  - Managed WAF ruleset (OWASP Core Rule Set)
  - Custom rules to block known scanner user-agents

### 5.9 Audit Logging

Current audit log: flat JSONL file, no integrity protection, no shipping.
Recommended improvements:
- Append-only storage (write to stdout in Docker → collect with log aggregator)
- Ship to a SIEM (Datadog, Splunk, Elastic)
- Include: timestamp, event type, user_id, auth_id, client IP, request ID,
  endpoint, HTTP status, token count
- Set alerts on: burst events, first-time admin login, userType changes,
  bulk delete operations, high token consumption

---

## 6. Supabase-Specific Review

### 6.1 Row-Level Security — Policy Analysis

| Table | RLS Enabled | SELECT | INSERT | UPDATE | DELETE | Issues |
|---|---|---|---|---|---|---|
| users | ✅ | own + admin | `WITH CHECK (true)` | **No WITH CHECK** | admin only | **CRITICAL: INSERT overpermissive, UPDATE allows column tampering** |
| chats | ✅ | own only | own only | own only | own only | OK |
| chat_messages | ✅ | own only | own only | — | own only | OK |
| portfolio_history | ✅ | own only | own only | own only | — | OK |
| open_positions | ✅ | own only | own only | own only | own only | OK |
| trades | ✅ | own only | own only | own only | — | OK |
| trade_journal | ✅ | own only | own only | own only | own only | OK |
| learning_topics | ✅ | own only | own only | own only | — | OK |
| achievements | ✅ | own only | own only (self-award) | — | — | Medium: users can self-award |
| market_indices | ✅ | anon+auth | — | — | — | OK |
| trending_stocks | ✅ | anon+auth | — | — | — | OK |
| news | ✅ | anon+auth | **FOR ALL with CHECK (true)** | **same** | **same** | **CRITICAL** |
| news_articles | ✅ | anon+auth | — | — | — | OK |
| eye_snapshots | ✅ | own only | own only | own only | own only | OK |
| stock_snapshots | ✅ | auth only | — | — | — | OK |

### 6.2 Critical Misconfigurations (Pre-Fix)

**MC-001: users INSERT policy is `WITH CHECK (true)`**
Any anonymous or authenticated client can insert rows into `public.users` with
arbitrary values including `userType='Admin'`. The policy name says "Service role"
but the condition is unrestricted.

**MC-002: users UPDATE has no WITH CHECK**
Column-level protection is absent. Users can write any value to any column,
including `userType='Admin'`.

**MC-003: news table has `FOR ALL ... WITH CHECK (true)` for anon+auth**
Any user, including unauthenticated visitors, can insert, update, and delete news articles.

### 6.3 service_role Key Risks

The `_get_supabase_client()` function in `trade_engine.py` uses the service_role key
when available. The service_role key **bypasses all RLS policies**. If this key is
leaked (e.g., in logs, error messages, or via a compromised env var), an attacker
gets unrestricted read/write access to the entire database.

**Mitigations:**
- Never log the service_role key or include it in error messages.
- Set IP restrictions on Supabase API access where possible.
- Rotate immediately if exposure is suspected.
- Audit all places where `SUPABASE_SERVICE_ROLE_KEY` is read; ensure it's only in
  the backend, never referenced in frontend code.

### 6.4 anon Key Exposure

The anon key (`VITE_SUPABASE_ANON_KEY`) is intentionally public — this is the
Supabase design. Its power is bounded by RLS policies. However:
- The anon key allows reading from tables with anon-accessible policies (news, market data).
- If RLS policies are misconfigured (as MC-003 above), anon can write data.
- Monitor Supabase access logs for unusual anon-key usage patterns.

### 6.5 JWT Validation Assumptions

Supabase issues HS256 JWTs signed with the project's JWT secret. The backend now
validates these locally using PyJWT. If `SUPABASE_JWT_SECRET` is not set, the
fallback is a synchronous Supabase REST call per request — slower and adds latency.
**Always set `SUPABASE_JWT_SECRET` in production.**

### 6.6 handle_new_user() SECURITY DEFINER Trigger

The trigger fires on every `auth.users` INSERT or UPDATE and copies
`raw_user_meta_data` fields directly into `public.users`. An attacker who controls
their own `raw_user_meta_data` during signup could inject:
- `experience_level`: constrained by enum — safe
- `risk_level`: constrained by enum — safe
- `age`: constrained by CHECK (13–150) — safe
- `email`: free text — acceptable
- `first_name`, `last_name`: free text — **could be XSS if rendered unsanitized**

**Mitigation:** Always escape user-controlled name fields before rendering in HTML.
The React components use standard JSX interpolation which escapes by default — safe
as long as `dangerouslySetInnerHTML` is never used with these fields.

### 6.7 Multi-Tenant Isolation

All user-scoped tables use `user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())`.
This subquery pattern is correct but has a subtle performance and security consideration:
if the `users` table is large, the subquery runs on every policy evaluation. Use
a function or direct comparison for clarity and index efficiency:
```sql
-- More efficient alternative:
USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1))
```

### 6.8 Backups

Supabase provides point-in-time recovery on Pro plans. Verify:
- PITR is enabled on the production project
- Backup retention is at least 7 days
- A restore test has been performed
- The service_role key is rotated after any backup restore

---

## 7. Critical Misconfigurations to Avoid

1. **Never set `ENVIRONMENT` to anything other than `production` in production.**
   The CORS config will silently open to all origins otherwise.

2. **Never commit `.env` files.** Already in `.gitignore`. Add a secret-scanning
   pre-commit hook.

3. **Never use the service_role key in the frontend.** Always VITE_ variables
   get bundled into the browser. The service_role key must never have a `VITE_` prefix.

4. **Never disable RLS on any table.** Adding `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`
   makes all rows accessible to any authenticated user (or anon if the anon key is used).

5. **Never run the dev CORS config in production** (`CORS_ORIGINS=*`). Post-fix,
   this will raise a `RuntimeError` on startup — intentional.

6. **Never expose the Supabase dashboard publicly.** Disable the Supabase Studio
   URL once the team is done with initial setup (Settings → General → "Disable dashboard").

7. **Never hard-code API keys in source code.** The `.env.example` file correctly
   uses placeholder values — ensure no developer substitutes real keys and commits them.

8. **Never trust `X-Forwarded-For` without validating the proxy chain.** Fixed in
   this PR — only headers from known trusted proxy IPs are honoured.

9. **Never `console.error` or `console.warn` authentication errors with token data.**
   The AuthContext currently logs `Supabase session error: <error object>` — ensure
   error objects never include token material.

10. **Never skip email verification before granting financial data access.** Track
    `is_verified` and enforce it in RLS or application logic.

---

## 8. Hardening Roadmap

### 🔴 Critical — Before Launch

| Item | Why | Implementation | Risk Reduction | Mandatory |
|---|---|---|---|---|
| **Run `harden_rls_policies.sql`** | Closes privilege escalation via userType self-promotion and news write abuse | Execute in Supabase SQL Editor | Critical | **MANDATORY** |
| **Set `SUPABASE_JWT_SECRET` env var** | Enables local JWT verification — removes per-request network hop to Supabase | Copy from Supabase Settings > API > JWT Secret | Critical | **MANDATORY** |
| **Set `CORS_ORIGINS` in production** | Without this, server refuses to start (intentional post-fix) | `CORS_ORIGINS=https://yourdomain.com` in Railway/Render | Critical | **MANDATORY** |
| **Set `ENVIRONMENT=production` in backend** | Disables OpenAPI docs, restricts health info, enforces CORS | Add to Railway/Render env vars | High | **MANDATORY** |
| **Set spend alerts on OpenAI/Perplexity/Tavily** | Detect cost exhaustion attacks early | Dashboard alerts at $50, $100, $500 | High | **MANDATORY** |
| **Deploy `vercel.json` with new security headers** | CSP, HSTS, COOP reduce XSS blast radius | Already in this PR | High | **MANDATORY** |

### 🟠 High Priority — Within 7 Days

| Item | Why | Implementation | Risk Reduction | Mandatory |
|---|---|---|---|---|
| **Migrate rate limiter to Redis** | In-memory limiter doesn't survive restarts or scale across workers | `pip install fastapi-limiter redis` | High | Recommended |
| **Add WebSocket JWT authentication** | `/ws/live` currently accepts any connection | Validate JWT on connect before accepting | Medium | Recommended |
| **Enable MFA for admin accounts** | Admin compromise = full user data access | Supabase Auth → MFA settings | High | Recommended |
| **Add `SUPABASE_JWT_SECRET` rotation procedure** | Old JWT secret = old tokens remain valid | Document in runbook | Medium | Recommended |
| **Secret scanning in CI** | Prevent key commits | `trufflehog` or GitHub secret scanning | High | Recommended |
| **`npm audit` + `pip-audit` in CI** | Catch known vulnerable dependencies | Add to CI pipeline | Medium | Recommended |

### 🟡 Important — Within 30 Days

| Item | Why | Implementation | Risk Reduction | Mandatory |
|---|---|---|---|---|
| **Ship audit logs to external SIEM** | File-based logs are lost on container restart | Stdout → log aggregator → Datadog/Splunk | High | Recommended |
| **Cloudflare in front of both Vercel and backend** | Bot mitigation, WAF, DDoS protection | Change DNS | High | Recommended |
| **Nonce-based CSP** | Current CSP uses `unsafe-inline` | Requires Vite plugin for nonce injection | Medium | Recommended |
| **Email verification enforcement** | Users can access financial data unverified | Add RLS condition or app-level check | Medium | Recommended |
| **Admin operation audit trail in DB** | Track who promoted/deleted whom | Postgres trigger on users table | High | Recommended |
| **Supabase PITR enabled** | Data recovery after incident | Supabase Settings → Database → PITR | High | Recommended |
| **Dependency pinning (exact versions)** | Prevent supply chain attacks | Lock `package-lock.json` and `requirements.txt` | Medium | Recommended |

### 🔵 Longer-Term Maturity

| Item | Why |
|---|---|
| **httpOnly cookie session storage** | Removes JWT from localStorage, blocks XSS-based session theft |
| **Backend-enforced admin check** | Currently admin operations go direct to Supabase; add a backend API layer |
| **Multi-party approval for admin actions** | Destructive actions (delete user) require second admin confirmation |
| **Chaos engineering / failure testing** | Validate behaviour under partial backend failure |
| **SAST in CI** | Catch security issues before merge (Semgrep, Bandit for Python) |
| **DAST against staging** | ZAP or Burp Suite automated scan against staging environment |
| **Penetration test** | Hire external pentesters before major user growth milestones |

---

## 9. Verification / Pen Test Plan

### 9.1 Manual Review Checklist

- [ ] All backend routes require a valid Supabase JWT (test with no token, expired token, malformed token)
- [ ] Rate limit headers are present in all responses
- [ ] `/api/chat`, `/api/search`, etc. return 401 without auth
- [ ] `X-Forwarded-For` spoofing does not bypass rate limits when connecting directly
- [ ] Health endpoint does not reveal version/environment in production
- [ ] OpenAPI docs (`/docs`, `/redoc`) return 404 in production (`ENVIRONMENT=production`)
- [ ] CORS rejects requests from unauthorized origins in production
- [ ] All SQL in `harden_rls_policies.sql` has been applied and verified
- [ ] `userType` cannot be changed via client-side Supabase call
- [ ] Anonymous users cannot write to `public.news`

### 9.2 Penetration Test Checklist

#### Auth bypass
- [ ] Access `/advisor`, `/profile`, `/trading` without Supabase session
- [ ] Access `/admin` as a regular (non-Admin) user
- [ ] Tamper with JWT signature
- [ ] Use an expired JWT

#### Broken access control / IDOR
- [ ] Query `public.users` for another user's row via anon key
- [ ] Read another user's `chats`, `chat_messages`, `trades`
- [ ] Update another user's profile
- [ ] Attempt `userType` self-promotion via direct Supabase SDK call

#### Key leakage
- [ ] Inspect browser bundle for secrets (search for `sk-`, `tvly-`, `pplx-`, `service_role`)
- [ ] Check environment disclosure in `/health`, error messages, response headers
- [ ] Attempt to trigger 500 errors that reveal env var names

#### Rate limit bypass
- [ ] Send 25+ requests/minute to `/api/chat` from a single IP
- [ ] Attempt IP rotation via `X-Forwarded-For` header
- [ ] Attempt user ID rotation via `user_id` field (should now be ignored)

#### Injection
- [ ] SQL injection via chat message content (passed to OpenAI — not directly to DB)
- [ ] Prompt injection via user message to manipulate AI response
- [ ] XSS via `first_name`/`last_name` fields rendered in admin panel

#### SSRF
- [ ] Craft Tavily search query to attempt SSRF (low risk — Tavily is the SSRF vector, not the backend)
- [ ] POST to `/api/chat` with a system message instructing the AI to fetch internal URLs

#### Privilege escalation
- [ ] Attempt `userType='Admin'` via Supabase SDK (blocked by `WITH CHECK`)
- [ ] Attempt admin promotion via `/admin` toggleAdminStatus as a regular user

#### Mass scraping
- [ ] Enumerate user IDs by querying `public.users` with anon key
- [ ] Scrape all `public.news` and `public.stock_snapshots` without auth

#### Malicious file upload
- [ ] Not applicable (no file upload currently implemented)

#### Webhook forgery
- [ ] Not applicable (no webhooks currently implemented)

#### Account takeover
- [ ] Test password reset flow: does it work with unverified email?
- [ ] Test email enumeration: does signup/reset reveal whether an email exists?

### 9.3 Pre-Launch Security Gates

- [ ] `harden_rls_policies.sql` executed in production Supabase
- [ ] `ENVIRONMENT=production` confirmed in backend
- [ ] `CORS_ORIGINS` set to exact production domain
- [ ] `SUPABASE_JWT_SECRET` configured
- [ ] OpenAI/Perplexity/Tavily spend alerts configured
- [ ] No secrets in git history (`trufflehog` clean)
- [ ] `npm audit` shows no critical/high vulnerabilities
- [ ] `pip-audit` shows no critical/high vulnerabilities
- [ ] All security headers present (test with securityheaders.com)
- [ ] CSP report-only mode running for 48h before switching to enforce

### 9.4 Post-Launch Monitoring Checks

- [ ] OpenAI billing anomaly: alert if daily spend > 3× 7-day average
- [ ] Rate limit block rate: alert if >100 blocks/hour (abuse pattern)
- [ ] Admin action audit: alert on any `userType` change
- [ ] Failed auth spike: alert on >50 401s/minute
- [ ] Supabase audit log: review weekly for unusual queries

### 9.5 Incident Response Tabletop Scenarios

**Scenario A: API Key Compromised**
1. Receive alert: OpenAI billing spike or unauthorized usage notification
2. Immediately rotate `OPENAI_API_KEY` in production env (Railway/Render)
3. Restart backend to pick up new key
4. Review audit logs for user_ids associated with the abuse window
5. Block affected IPs at Cloudflare
6. File incident report; notify affected users if their data was queried

**Scenario B: Admin Account Compromised**
1. Detect: unusual login location, anomalous activity in admin audit log
2. Immediately: revoke admin session via Supabase Auth dashboard
3. Demote admin `userType` to `User` via direct DB query as service_role
4. Review audit log for all actions taken by compromised account
5. Notify all users if any PII was exported (CSV export feature)
6. Reset password, enforce MFA re-enrollment

**Scenario C: RLS Policy Bypass (Mass Data Exfil)**
1. Detect: Supabase request volume spike, anomalous row-count metrics
2. Temporarily restrict anon key access in Supabase dashboard
3. Identify the exploited policy via Supabase logs
4. Patch the policy immediately
5. Assess which rows were accessed
6. Notify affected users per data breach notification requirements

---

## 10. Assume-Breach Containment Plan

### 10.1 Blast Radius Reduction

| Segmentation | Control |
|---|---|
| Frontend ↔ Backend | Backend requires JWT; frontend cannot call Supabase service_role |
| Backend ↔ OpenAI | Spend alerts limit financial damage; key rotation stops access |
| Backend ↔ Supabase | service_role key only in backend env vars; rotatable |
| User A ↔ User B | RLS policies enforce isolation |
| User ↔ Admin | `is_current_user_admin()` SECURITY DEFINER; `WITH CHECK` on UPDATE |

### 10.2 Key Rotation Runbooks

**OpenAI Key Rotation (< 5 minutes):**
```
1. Generate new key at platform.openai.com → API keys
2. Set OPENAI_API_KEY=<new-key> in Railway/Render
3. Trigger redeploy (or restart dyno)
4. Revoke old key in OpenAI dashboard
5. Verify /health returns 200
```

**Supabase service_role Rotation (< 10 minutes):**
```
1. Go to Supabase Settings → API → Reset service_role key
2. Update SUPABASE_SERVICE_ROLE_KEY in all backend deployments
3. Restart backend services
4. Update any DB migration scripts or admin tooling that used the old key
5. Verify stock-price endpoint functions
```

**Supabase JWT Secret Rotation (< 15 minutes, causes all sessions to expire):**
```
1. Plan for user session invalidation (all users will be logged out)
2. Go to Supabase Settings → API → Reset JWT secret
3. Update SUPABASE_JWT_SECRET in backend env vars
4. Restart backend
5. Notify users of forced re-login (optional)
```

### 10.3 Compromised Session Response

1. Identify session via Supabase Auth → Users → Sessions
2. Revoke session in Supabase dashboard
3. If broad compromise suspected: Supabase Settings → Auth → "Sign out all users"
4. Force password reset for affected accounts

### 10.4 Kill Switches

- **Disable AI endpoints:** Set `AUTH_REQUIRED=true` AND remove `OPENAI_API_KEY` from env → all `/api/chat` calls return 500 with generic error
- **Disable web search:** Remove `TAVILY_API_KEY` → `/api/search` returns 500
- **Disable backend entirely:** Scale to 0 on Railway/Render
- **Disable anon access:** In Supabase Settings → Auth, disable anonymous sign-ins

### 10.5 Degraded-but-Safe Mode

If the backend is compromised or unavailable, the frontend gracefully falls back
to Supabase data only. The app remains functional for:
- Viewing portfolio history
- Reading news (Supabase-stored)
- Paper trading (Supabase only)

AI chat and web search become unavailable — acceptable as a safe degraded state.

---

## 11. Security Scorecard

| Area | Score | Justification |
|---|---|---|
| **Secret management** | 4/10 | Keys in env vars (good), no rotation policy, no vault, `service_role` used loosely |
| **Web app security** | 5/10 | No CSP pre-fix (now added), no HSTS pre-fix (now added), missing nonce-based CSP |
| **Backend security** | 3/10 | Pre-fix: zero auth on all endpoints; post-fix: 7/10 (JWT auth, rate limiting, info disclosure fixed) |
| **Auth/session security** | 5/10 | Supabase handles JWT well, but no MFA, JWT in localStorage, admin check client-side only |
| **Supabase security** | 4/10 | RLS enabled everywhere (good), but critical policy gaps (privilege escalation, news write) |
| **Abuse resistance** | 4/10 | Rate limiter exists but in-memory, IP spoofable pre-fix, no WAF |
| **Monitoring/detection** | 2/10 | Audit log exists but file-based, no alerting, no SIEM, no anomaly detection |
| **Incident readiness** | 3/10 | No runbook documented, no rotation procedures, no tabletop exercises done |
| **Operational security** | 4/10 | .gitignore correct, ENVIRONMENT gating exists, but no secret scanning CI |
| **Overall resilience** | **3.4/10** | Architecture direction is sound but execution had critical gaps |

*Post-fix estimated scores: Backend 7, Web App 6, Supabase 5 (pending SQL), Overall 5.5*

---

## 12. Final Verdict: "What Would Still Scare Me Defending This in Production?"

1. **The in-memory rate limiter.** A multi-worker or multi-instance backend deployment
   gives each worker independent limits. In practice: deploy one worker, or migrate to Redis.

2. **The Supabase admin panel does aggregate queries without backend enforcement.**
   The `fetchChatStats` admin query returns counts scoped to the admin's own rows via RLS,
   not true platform-wide stats. More importantly: if RF-004 (privilege escalation) somehow
   bypasses `harden_rls_policies.sql`, any user becomes an admin and can export all user PII.

3. **`unsafe-inline` in the CSP.** Vite bundles require it for inline scripts. Without
   nonce-based CSP or a hash-based approach, XSS via a stored payload in chat messages,
   news articles, or trade journal notes would bypass the CSP. The React JSX escaping
   is the primary (and currently only) XSS defence for user-controlled content.

4. **JWT stored in localStorage.** Any successful XSS = session theft. The Supabase SDK
   default of localStorage is convenient but not ideal for a financial app. An httpOnly
   cookie approach requires an auth proxy, but is the correct security posture.

5. **No external alerting.** The audit log is a file that lives in the container.
   When the container restarts, audit history is gone. A compromised server could
   be used for abuse, the operator billed heavily, and nobody would know until the
   monthly invoice arrived.

6. **The admin panel's `exportUsers()` function** creates a client-side CSV of all
   user emails, names, and metadata. This export is not logged, not restricted to
   specific download counts, and not watermarked. An insider or compromised admin
   account can silently exfiltrate all user PII.

7. **No environment separation.** There is no staging environment referenced in
   the codebase. Developers likely test against production Supabase. A mistake in
   schema migration, trigger logic, or RLS policy goes directly to live data.

---

*End of security analysis. All code changes in this PR are on branch `claude/harden-website-security-RJ8kG`.*
