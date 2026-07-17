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
| Global requests/minute (cross-user) | **NOT IMPLEMENTED — gap G-1a** | Only per-user/IP dimensions exist |
| Global concurrent generations | **NOT IMPLEMENTED — gap G-1b** | — |
| Maximum daily AI expenditure (global) | **NOT IMPLEMENTED — gap G-1c** | Per-user daily token caps bound per-account cost (≈500 requests × token caps), but aggregate spend across the 150-user beta is bounded only by `users × per-user caps`. Provider-side hard budget (OpenAI project budget limit) is the compensating control — **EXTERNAL ACCESS REQUIRED** to confirm it is set. |
| Maximum monthly AI expenditure (global) | **NOT IMPLEMENTED — gap G-1d** | Same compensating control as G-1c |

**Rejection behaviour:** limit hits return explicit 429s with reset headers
(`X-RateLimit-*`) and human-readable messages — tested. Oversize input is a
422, not a truncation.

**Beta risk assessment for G-1:** with the hard 150-account cap
(`docs/readiness/STAGED_LAUNCH.md`) the worst-case daily aggregate is capped
and calculable (150 × 800k tokens/day). Set the provider-side budget alarm
**before Cohort 1** and treat implementing a global limiter as a condition
for any post-beta expansion.

## 2. Cost accounting

| Requirement | Status | Evidence |
| --- | --- | --- |
| Provider, model, result state, failure class per request | **IMPLEMENTED** | Audit events (`audit_log`) on fallbacks/failures with reasons; correlation IDs middleware |
| Input/output tokens per request | **IMPLEMENTED** | Provider `usage` captured per turn (streaming + non-streaming paths in `ai_proxy.py`); token usage recorded in rate-limiter state |
| Estimated cost per request | **NOT IMPLEMENTED** | Tokens are recorded; a $/token mapping table and per-request cost field are not — gap **G-7** |
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
| Quotas and spending controls enforced | Per-user: yes (tested). Global: **no** (G-1, compensating provider budget = EXTERNAL ACCESS REQUIRED) |
| Provider failure explicit and recoverable | Yes (tested paths above); cancellation UX unverified |
| AI usage traceable by request and release | Yes — correlation IDs + release SHA in `/health` + Sentry release tagging |
| Evaluation suite runnable and versioned | Yes (v1, CI-validated dataset); **never executed — NOT VERIFIED** |
| Prompt/model changes require evaluation evidence | Process documented (release checklist); not yet technically enforced |
