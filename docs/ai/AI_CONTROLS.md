# AI Reliability, Cost and Safety Controls — status

**Owner:** TheEyeBeta · **Date:** 2026-07-16 (Phase 7)
**Sources of truth:** `backend/websearch_service/app/services/rate_limit.py`
(+ `rate_limit_redis.py`), `app/routes/ai_proxy.py`, `docs/RATE_LIMITING.md`,
eval suite in `backend/websearch_service/evals/`.

Statuses use the readiness vocabulary; nothing below is claimed beyond its
evidence.

## 1. Quotas

| Control | Status | Evidence / gap |
| --- | --- | --- |
| Per-user requests/minute·hour·day | **IMPLEMENTED + AUTOMATED TEST PASSED** | `/api/chat`: 20/min, 150/h, 500/day (per-endpoint configs in `rate_limit.py`); `test_rate_limit*.py`, `integration/test_rate_limiting.py` |
| Per-user token budgets (min/hour/day) | **IMPLEMENTED + AUTOMATED TEST PASSED** | `/api/chat`: 40k/min, 150k/h, 800k/day estimated+actual tokens; same tests |
| Concurrent generations per user | **IMPLEMENTED** (cap = 5 concurrent requests/user, not 1 active generation) | `max_concurrent_requests` in `rate_limit.py` + frontend single-send guard in `Advisor.tsx` (`isSendingRef`). The strict "one active generation per user" rule is only frontend-enforced; server allows up to 5. Gap **G-6** if 1 is required. |
| Maximum user-input length | **IMPLEMENTED** | Pydantic `max_length=50000` (`MAX_CHAT_MESSAGE_CONTENT_LENGTH`); oversize requests are rejected with 422, never silently truncated |
| Maximum output-token budget | **IMPLEMENTED** | `OPENAI_MAX_TOKENS` (default 8000, env-configurable); bounded retry for reasoning-budget exhaustion (`test_ai_proxy.py`) |
| Conversation-history window | **IMPLEMENTED** | Bounded, paginated history retrieval (#212); context assembly caps in `ai_proxy.py` |
| Global requests/minute·day (cross-user) | **IMPLEMENTED + AUTOMATED TEST PASSED — G-1a closed** | `app/services/ai_budget_guard.py` (Valkey-atomic, `AI_BUDGET_GLOBAL_REQUESTS_PER_MINUTE`/`_PER_DAY`); `test_ai_budget_guard.py`, `test_ai_budget_guard_integration.py` |
| Global concurrent generations (+ per-provider/per-model) | **IMPLEMENTED + AUTOMATED TEST PASSED — G-1b closed** | Same module; `AI_BUDGET_GLOBAL_MAX_CONCURRENT`/`_PROVIDER_MAX_CONCURRENT`/`_MODEL_MAX_CONCURRENT`; concurrency-race test in `test_ai_budget_guard.py` |
| Maximum daily AI expenditure (global) | **IMPLEMENTED + AUTOMATED TEST PASSED — G-1c closed** | Internal cost reservation/reconciliation against `AI_BUDGET_DAILY_USD` (default $50 beta); daily-boundary test |
| Maximum monthly AI expenditure (global) | **IMPLEMENTED + AUTOMATED TEST PASSED — G-1d closed** | `AI_BUDGET_MONTHLY_USD` (default $1000 beta); monthly-boundary test |

**Rejection behaviour:** limit hits return explicit 429s (rate/concurrency
pressure) or 503s (hard-stop/restricted spend states) with a safe reason
code, circuit-breaker state, and `retry_after`/`Retry-After` guidance —
tested (`test_ai_budget_guard_integration.py`). Oversize input is a 422, not
a truncation. Per-user 429s (`X-RateLimit-*`) are unchanged.

**G-1 status (2026-07-18):** closed by the global AI budget guard. Design:
Valkey-atomic (Redis-protocol-compatible; see `deployment/DEPLOYMENT.md`)
reserve→reconcile→release lifecycle (no race-based overspend),
a `normal`/`warning`/`restricted`/`hard_stop`/`manual_override` circuit
breaker driven purely by our own recorded spend (never a provider-side
signal — OpenAI budget alerts are soft/advisory), and a disabled-by-default,
time-bounded, audited admin override. Read-only status:
`GET /api/admin/ai-budget/status`. Scheduled, non-fatal drift check against
the OpenAI Costs API: `POST /api/admin/ai-budget/reconcile-costs`
(`app/services/ai_cost_reconciliation.py`) — observability only, never
gates the local hard stop. Beta defaults live in `.env.example`
(`AI_BUDGET_*`), not hard-coded. Production still requires Redis/Valkey at
startup (`validate_ai_budget_configuration`) unless explicitly opted into
an in-memory or fail-open single-worker beta mode.

## 2. Cost accounting

| Requirement | Status | Evidence |
| --- | --- | --- |
| Provider, model, result state, failure class per request | **IMPLEMENTED** | Audit events (`audit_log`) on fallbacks/failures with reasons; correlation IDs middleware |
| Input/output tokens per request | **IMPLEMENTED** | Provider `usage` captured per turn (streaming + non-streaming paths in `ai_proxy.py`); token usage recorded in rate-limiter state |
| Estimated cost per request | **IMPLEMENTED — gap G-7 closed** | Versioned $/token pricing table (`app/services/ai_pricing.py`, `PRICING_VERSION`); every AI-proxy call reserves an estimated cost and reconciles it to actual usage via the budget guard. Not yet surfaced as a **per-request** field in general telemetry — only aggregated into the daily/monthly spend totals exposed at `/api/admin/ai-budget/status`. |
| User/request/conversation IDs, latency | **IMPLEMENTED** | Correlation-ID middleware (`test_correlation_middleware.py`), request logging with duration, chat_turn_requests rows |
| No raw private prompt content in general telemetry | **IMPLEMENTED + TESTED** | `docs/security/TELEMETRY_PRIVACY.md`, `src/lib/__tests__/telemetry.test.ts`; Sentry `sendDefaultPii: false` |

## 3. Provider states and resilience

Explicit states used by the backend and surfaced to operators:
`available` / `degraded` / `rate_limited` / `unavailable` / `misconfigured`
map onto: `/health` (`openai: ok|error` = misconfigured check),
`/health/ready` (`degraded` flag, search-provider status), and per-request
fallback audit events (`openai_fallback_perplexity` with reasons
`network_error`, `rate_limit_429`, `service_unavailable_503`,
`quota_exceeded_402`). User-facing failure copy is generic and safe;
operator diagnostics carry the failure class.

| Scenario | Automated evidence |
| --- | --- |
| Timeout | `test_chat_turn_reconciliation.py` (turn reconciliation), `test_ai_proxy.py` |
| 429 / rate limit | fallback path + `test_rate_limit*.py` |
| 401 / misconfiguration | `/health` OpenAI key placeholder detection (`test_main.py`), config fail-fast (`test_config.py`) |
| 5xx provider failure | fallback audit path (`service_unavailable_503`) |
| Malformed provider response | defensive parsing + reasoning-budget retry detection (`test_ai_proxy.py`) |
| Stream interruption | reconciliation (`test_chat_turn_reconciliation.py`); browser-side rendering untested (journey `iris-stream-interruption`) |
| Retryable vs non-retryable | bounded single retry only for reasoning-budget exhaustion; fallback for network/429/5xx/402 — no unbounded retries; idempotency keys prevent duplicate charging (`test_ai_proxy_helpers.py`) |
| Cancellation | **NOT VERIFIED** (journey `iris-user-cancellation`) |
| Fallback provider / no fallback | OpenAI → Perplexity fallback (ADR-004) with audit; when no fallback available the turn fails explicitly |

## 4. Evaluation suite

Versioned dataset + runner: `backend/websearch_service/evals/`
(`dataset/v1/eval-dataset.jsonl`, `run_evals.py`, `README.md`). Composition
meets the Phase 7 floor: 50 education, 25 stock-research, 20 unsupported-
current-data, 20 adversarial, 20 high-risk, 20 scope-escape, 10 prompt-
injection, 10 personal-data-extraction (175 total). Dataset integrity is
CI-enforced by `tests/test_eval_suite.py`.

Scoring: automated heuristics per category (refusal correctness, disclaimer
presence, uncertainty language, injection-canary leakage, scope adherence,
latency; token usage when the target reports it) plus `needs_review` flags
where only a human/LLM judge can score factual correctness, citation
alignment and hallucination rate.

**Execution status: NOT VERIFIED.** The suite has never been run against the
live pipeline (requires a running backend + provider key — run
`python -m evals.run_evals --target http://localhost:7000 --out report.json`).
No quality claims are made until a run report is committed under
`evals/reports/`. Major prompt/model changes must attach a fresh report
(enforce via review checklist in `docs/readiness/RELEASE_CHECKLIST.md`).

## 5. User-facing financial safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Output not represented as guaranteed advice | **IMPLEMENTED** | Product copy: "Educational analysis only. Not personalised investment advice." (Landing, advisor surfaces); system prompt scopes to education/analysis |
| Education / analysis / user-decision distinction | **IMPLEMENTED** | System-prompt framing in `ai_proxy.py`; eval categories `high_risk` + `adversarial` assert the boundary once executed |
| Stale/unavailable data indicated | **IMPLEMENTED + TESTED** | Trade-engine endpoints return explicit availability metadata, never silent stubs (`test_trade_engine.py`); snapshot pricing ADR-007 |
| No fabricated market values | **PARTIALLY VERIFIED** | Backend never invents prices (data endpoints fail explicit); the *model* fabricating values is exactly what eval category `stale_data` measures — pending first eval run |
| Uncertainty language | **NOT VERIFIED** | Eval categories `research`/`stale_data` score this; pending run |
| Emergency/provider-failure states | **IMPLEMENTED** | Explicit failure copy + fallback chain + `/health/ready` degraded reporting |

## 6. Phase 7 exit-criteria scorecard

| Criterion | Verdict |
| --- | --- |
| Quotas and spending controls enforced | Per-user: yes (tested). Global: **yes** (tested) — G-1 closed by the AI budget guard; see §1. |
| Provider failure explicit and recoverable | Yes (tested paths above); cancellation UX unverified |
| AI usage traceable by request and release | Yes — correlation IDs + release SHA in `/health` + Sentry release tagging |
| Evaluation suite runnable and versioned | Yes (v1, CI-validated dataset); **never executed — NOT VERIFIED** |
| Prompt/model changes require evaluation evidence | Process documented (release checklist); not yet technically enforced |
