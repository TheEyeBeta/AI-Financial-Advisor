# Observability Coverage Matrix — TheEye backend

Maps each required telemetry signal to its source and current status.
Status: **EMITTED** (in code today) · **DERIVED** (from structured logs via a
log-to-metric rule) · **GAP** (needs instrumentation) · **EXTERNAL** (provider
dashboard/config).

| Signal | Source | Status |
| --- | --- | --- |
| Request count | `app.request` `http_request` events | DERIVED |
| Error count | `http_request_error` + 5xx `status_code` | DERIVED |
| p50/p95/p99 request latency | `duration_ms` on `http_request` | DERIVED |
| Database latency & errors | Supabase calls; `/health` `services.database` | PARTIAL (health EMITTED; per-call latency GAP) |
| Redis latency & errors | `rate_limit_redis` warnings; `/health/ready` | PARTIAL (status EMITTED; latency GAP) |
| Authentication failures | `app/services/auth.py` rejection logs | EMITTED (log) → DERIVED metric |
| Authorisation failures | admin/role guards (403 paths) | DERIVED (403 `status_code`) |
| AI provider requests / errors | `ai_proxy` call sites + audit_log | EMITTED (audit) → DERIVED |
| First-token latency | streaming path timing | GAP (add span/log at first chunk) |
| Full-response latency | `duration_ms` for `/api/chat` | DERIVED |
| Input / output / reasoning tokens | provider `usage` in `ai_proxy` | EMITTED (audit_log fields) |
| Estimated AI cost | `ai_pricing` + `ai_budget_guard` | EMITTED |
| Reconciled AI cost | `ai_cost_reconciliation` | EMITTED |
| Budget reservations / rejections | `ai_budget_guard` | EMITTED |
| Rate-limit rejections | `rate_limit` 429 responses | EMITTED (headers + log) |
| Retry counts | `chat_reasoning_retry` audit event | EMITTED |
| Active AI requests | concurrency guard | PARTIAL (guard exists; gauge GAP) |
| Scheduler lag / heartbeat | `scheduler_config` / `run_scheduler` | PARTIAL (add heartbeat metric) |
| Background-job failures | `admin_job_worker` / `job_logger` | EMITTED (log) → DERIVED |
| Queue depth | `admin_jobs` table | DERIVED (query) |
| Application version / commit SHA / environment | `health_checks.release_info()` in `/health` | EMITTED |
| Correlation / request IDs | `CorrelationIdMiddleware` (`X-Request-ID`) | EMITTED |
| Trace propagation | Sentry `traces_sample_rate` | EXTERNAL (Sentry) |
| Structured logs | `log_event` JSON when `STRUCTURED_LOGS=1`/prod | EMITTED |
| Error categorisation | exception type in `http_request_error` | EMITTED |
| Log redaction | `redact_mapping` / `redact_text` (tested) | EMITTED + TESTED |
| Health / readiness / dependency status / degraded-mode | `/health`, `/health/live`, `/health/ready` | EMITTED |

## Gaps to close for a fully-instrumented 9/10

1. **First-token latency** — record a timestamp at the first streamed chunk and
   emit `ai_first_token_ms` (log field + metric). Highest-value gap.
2. **Per-dependency latency** (DB, Redis, AI) — wrap calls with a timing helper
   emitting `*_latency_ms`; today only up/down status is exposed.
3. **Gauges** — active-AI-requests and scheduler-lag as point-in-time gauges.

All three are additive log fields consumed by the AL-02/05/09 alerts in
`ALERTS.md`; none block the existing signals, which are already emitted or
directly derivable from the structured request log.
