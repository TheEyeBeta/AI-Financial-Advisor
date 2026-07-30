# Threat Model — Lens (AI Financial Advisor)

**Owner:** TheEyeBeta · **Date:** 2026-07-16 · **Methodology:** STRIDE per trust boundary
**Scope:** the deployed beta system (Vercel SPA, Railway FastAPI, Supabase, Valkey (Redis-protocol-compatible; see `deployment/DEPLOYMENT.md`), OpenAI/Tavily/Perplexity, TheEyeBetaDataAPI)
**Companions:** [`SECURITY_TEST_INVENTORY.md`](./SECURITY_TEST_INVENTORY.md) (control → test mapping),
[`SECURITY_REVIEW_PACKAGE.md`](./SECURITY_REVIEW_PACKAGE.md) (reviewer handoff),
[`docs/SECURITY_ANALYSIS.md`](../SECURITY_ANALYSIS.md) (2026-03 point-in-time audit, partially remediated since).

## 1. Assets

| Asset | Sensitivity | Store |
| --- | --- | --- |
| User identities + sessions (JWTs) | High | Supabase Auth |
| User profiles, goals, risk answers | High (personal + financial context) | `core.*` |
| Chat history (may contain personal finance details) | High | `ai.*` |
| Paper-trading history / portfolio state | Medium | `trading.*` |
| Academy progress | Low | `academy.*` |
| Audit log (privileged operations) | High (integrity-critical) | `core.audit_events` — durable, append-only, hash-chained (production/staging); `logs/audit.jsonl` local-dev fallback only — see `docs/security/AUDIT_TRAIL.md` |
| Provider API keys (OpenAI, Tavily, Perplexity, DataAPI) | Critical | Railway env only |
| Supabase service-role key + JWT secret | Critical | Railway env only |
| Release/deploy credentials (Vercel, Railway, GitHub) | Critical | platform dashboards, GH secrets |

## 2. Trust boundaries and actors

```text
[Browser SPA (untrusted)] --anon key + user JWT--> [Supabase (RLS enforced)]
[Browser SPA (untrusted)] --user JWT-------------> [FastAPI backend (Railway)]
[FastAPI] --service-role key (schema-qualified)---> [Supabase]
[FastAPI] --provider keys-------------------------> [OpenAI / Tavily / Perplexity]
[FastAPI] --credentials---------------------------> [TheEyeBetaDataAPI, Valkey]
[Scheduler/worker (single replica)] ---------------> [Supabase, providers]
[Browser] --single-use ticket---------------------> [FastAPI WebSockets]
[GitHub Actions] --secrets------------------------> [staging deploy, scans]
```

Actors: anonymous visitor, authenticated user, admin user, operator (dashboard
access), CI, external attacker, malicious authenticated user, compromised
provider response (prompt-injection vector).

## 3. STRIDE analysis by boundary

### B1 Browser → FastAPI

| Threat | Vector | Mitigations (evidence) | Residual risk |
| --- | --- | --- | --- |
| **S**poofing | Forged/absent JWT | JWT verified server-side (`app/services/auth.py`), never trusts client `user_id` on privileged paths; bypass flags rejected in production (`test_auth_service.py::test_validate_auth_configuration_rejects_bypass_in_production`) | Low |
| **T**ampering | Parameter tampering (mass assignment) | Pydantic models bound per route; length caps (`MAX_CHAT_MESSAGE_CONTENT_LENGTH`) | Medium — no dedicated mass-assignment test sweep (inventory G-3) |
| **R**epudiation | Disputed privileged ops | Audit events on lifecycle/admin ops (`test_audit.py`) | Low |
| **I**nfo disclosure | Provider error pass-through; verbose errors | Sanitized error responses (SEC-02 F2 remediation); Sentry redaction (`TELEMETRY_PRIVACY.md`) | Low-Med |
| **D**oS | LLM-relay abuse, request floods | Multi-tier per-user/IP rate limits + token budgets + concurrent cap (`app/services/rate_limit.py`, extensive tests); Valkey-shared in prod; **global** (cross-user) request/concurrency/spend cap implemented and tested — `app/services/ai_budget_guard.py`, `docs/ai/AI_CONTROLS.md` §1 (G-1 closed) | Low-Medium — enforcement depends on Valkey availability (fails closed by default on outage) |
| **E**levation | Onboarding/admin bypass | `ProtectedRoute` client-side + backend role checks (`test_admin_route_auth.py`); RLS as final layer | Low |

### B2 Browser → Supabase (direct)

| Threat | Vector | Mitigations | Residual risk |
| --- | --- | --- | --- |
| Spoofing | Stolen anon key | Anon key is public by design; RLS is the control | — |
| Tampering/Elevation | Cross-user reads/writes (IDOR/BOLA) | RLS on all six schemas; DB-level constraint tests run against real Postgres in CI (`test_trading_constraints_db.py`); schema-qualified clients | Medium — RLS test coverage is uneven per schema (academy: no direct test — journey `academy-unauthorized-access` is NOT_VERIFIED) |
| Info disclosure | Overly broad selects | RLS + column design | Medium — needs independent review |

### B3 FastAPI → Supabase (service role)

| Threat | Vector | Mitigations | Residual risk |
| --- | --- | --- | --- |
| Elevation | Service-role key bypasses RLS by design | Key never in frontend (`test_validate_auth_configuration_rejects_vite_srk_in_production`); backend derives `user_id` from verified JWT only | Low, **but** any backend RCE = full DB access; key rotation runbook: `KEY_ROTATION.md` |
| Tampering | SQL injection | Supabase client query builder (no string SQL on user paths); bandit in CI | Low |

### B4 WebSockets

| Threat | Vector | Mitigations (all tested in `test_ws_tickets.py`) | Residual risk |
| --- | --- | --- | --- |
| Spoofing/Replay | Ticket reuse, forged tickets | Single-use hashed tickets, unpredictable, endpoint-bound, TTL-clamped | Low |
| Info disclosure | JWT in URL | Rejected explicitly (`test_websocket_rejects_jwt_query_param`) | Low |
| CSRF-style | Cross-origin WS | Origin validation (`test_websocket_rejects_bad_origin`) | Low |

### B5 AI provider boundary

| Threat | Vector | Mitigations | Residual risk |
| --- | --- | --- | --- |
| Prompt injection (user or fetched content) | Instructions smuggled into chat/tools | Finance-scoped system prompt; tool fan-out caps (`MAX_STREAM_TOOL_CALLS`, wall-clock budget) | **Medium-High — no automated injection-resistance evaluation yet; eval suite added (`backend/websearch_service/evals/`), execution pending (NOT VERIFIED)** |
| Info disclosure | User data in prompts to provider | Only necessary context assembled; telemetry avoids raw prompt content (`TELEMETRY_PRIVACY.md`) | Medium — provider-side retention is contractual, out of repo control |
| DoS/cost | Unbounded generations | Token budgets per user; `OPENAI_MAX_TOKENS` cap; global daily/monthly USD spend cap (`app/services/ai_budget_guard.py`, `docs/ai/AI_CONTROLS.md` §1, G-1 closed) | Low-Medium (guard is Valkey-dependent; fails closed by default on outage) |
| Tampering | Malformed provider responses | Defensive parsing + retry-once on reasoning-budget exhaustion (`test_ai_proxy.py`) | Low |

### B6 CI/CD and supply chain

| Threat | Vector | Mitigations | Residual risk |
| --- | --- | --- | --- |
| Tampering | Malicious dependency | npm lockfile, hash-locked pip requirements, digest-pinned images, SHA-pinned actions (#206) | Low-Med |
| Info disclosure | Secrets in repo/history | gitleaks on every PR/push (`security.yml#secret-scan`, `SECRET_SCANNING.md`) | Low |
| Elevation | Deploy of red-check commit | Branch ruleset (documented; **EXTERNAL ACCESS REQUIRED** to apply — `RELEASE_POLICY.md` §5) | Medium until ruleset verified |

### B7 Scheduler / background workers

| Threat | Vector | Mitigations | Residual risk |
| --- | --- | --- | --- |
| DoS | Duplicate schedulers double-writing | `SCHEDULER_ENABLED` single-replica rule (`OPERATIONS.md`) | Medium — operational discipline, not technically enforced |
| Repudiation | Silent job failures | Admin job worker with observability (`test_admin_job_worker.py`, correlation IDs) | Low |

## 4. Top residual risks (ranked)

1. **Prompt-injection / scope-escape resistance is unevaluated** — eval suite now exists but has never been executed against the live pipeline (Phase 7, NOT VERIFIED).
2. **Global AI spend/concurrency cap depends on Valkey availability** — the guard (`docs/ai/AI_CONTROLS.md` §1, G-1 closed) bounds aggregate abuse, but it fails closed by default on a Valkey outage (503s, see `docs/runbooks/redis-unavailable.md`) unless `AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE` is deliberately set, which would remove the cap for the outage duration.
3. **Branch ruleset unapplied/unverified** — merge-over-red technically possible until the GitHub ruleset is confirmed (EXTERNAL ACCESS REQUIRED).
4. **RLS coverage uneven per schema** — direct RLS tests exist for trading; academy/meridian rely on policy review, not tests.
5. **Duplicate-email Google/password account behaviour undefined** — depends on Supabase dashboard setting (EXTERNAL ACCESS REQUIRED).

## 5. Review cadence

Re-validate this model at every phase gate of the staged launch
(`docs/readiness/STAGED_LAUNCH.md`) and after any change to auth, RLS,
WebSockets, or the AI proxy. Independent review: see
`SECURITY_REVIEW_PACKAGE.md` (penetration test = EXTERNAL ACCESS REQUIRED).
