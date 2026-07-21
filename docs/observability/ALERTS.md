# Alert Definitions — TheEye backend

Concrete, actionable alert definitions with thresholds, recovery conditions, and
setup steps. Dashboard/alert *creation* is a manual (EXTERNAL) action in the
provider console; these definitions are complete and copy-pastable. Signals come
from structured request logs (`app.request` — `http_request` / `http_request_error`
events with `status_code` + `duration_ms`), the health/readiness endpoints, the
AI budget guard, and rate-limit counters. Query syntax is shown in a generic
metric form; equivalent log-based queries are noted where the metric is derived
from structured logs.

> Redaction note: all log fields pass through `redact_mapping` / `redact_text`
> (see `app/middleware/correlation.py`), so alert queries never surface secrets.

| ID | Alert | Condition (fires) | Window | Severity | Recovery (resolves) |
| --- | --- | --- | --- | --- | --- |
| AL-01 | Elevated 5xx rate | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.02` | 5m, 2 breaches | P1 | ratio < 0.005 for 10m |
| AL-02 | Elevated p95 latency | `histogram_quantile(0.95, http_request_duration_ms) > 1500` | 10m | P2 | p95 < 800ms for 15m |
| AL-03 | Database outage | readiness `services.database != "ok"` OR DB error events `> 5/min` | 3m | P1 | database "ok" for 5m |
| AL-04 | Redis outage | readiness `services.redis != "ok"` OR budget/rate-limit "redis unavailable" log `> 3/min` | 3m | P1 | redis "ok" for 5m |
| AL-05 | AI provider outage | `sum(rate(ai_provider_errors_total[5m])) / sum(rate(ai_provider_requests_total[5m])) > 0.25` | 5m | P2 | error ratio < 0.05 for 10m |
| AL-06 | AI cost threshold | `ai_cost_usd_daily > 0.8 * AI_DAILY_BUDGET_USD` | 5m | P3 | below 0.7× for 30m |
| AL-07 | Budget circuit-breaker activated | any `ai_budget_rejected_total` increase OR "budget circuit open" log | 1m | P2 | no rejections for 15m |
| AL-08 | Auth failure spike | `sum(rate(auth_failures_total[5m])) > 20` OR > 5× 1h-baseline | 5m | P2 (possible attack) | < 2× baseline for 15m |
| AL-09 | Scheduler failure | no `scheduler_heartbeat` in 2× interval OR `scheduler_job_failed_total` increase | 10m | P2 | heartbeat resumes + 1 clean run |
| AL-10 | Queue backlog | `background_job_queue_depth > 100` OR oldest job age > 15m | 10m | P3 | depth < 20 for 15m |
| AL-11 | Background-job failure | `sum(increase(background_job_failed_total[15m])) > 3` | 15m | P3 | no new failures for 30m |
| AL-12 | Failed readiness check | `/health/ready` non-200 OR `status != "ready"` from ≥1 instance | 3m | P1 | "ready" from all instances for 5m |

## Threshold rationale (150-user capped beta)

- 5xx budget of 2% and p95 of 1.5s reflect an interactive advisory workload where
  the AI call dominates latency; first-token latency (AL-adjacent) is tracked
  separately in METRICS.md and should page only when p95 first-token > 6s.
- Auth-failure spike (AL-08) doubles as a brute-force / credential-stuffing
  signal; pair with the rate-limit rejection metric.
- AI cost (AL-06/07) is the money-safety pair: warn at 80% of the daily budget,
  page when the circuit breaker actually rejects (fail-closed is the correct
  behaviour — see `AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE`, which the env validator
  flags in production).

## Setup steps (manual / EXTERNAL)

1. **Sentry** (errors + traces): `SENTRY_DSN` is already wired
   (`app/observability.py`). Create alert rules for AL-01 (issue rate) and AL-05
   (AI provider exceptions) using the `http_request_error` / provider-exception
   fingerprints. `send_default_pii=False` is set; keep it.
2. **Metrics backend** (Datadog/Grafana/Cloud provider): ship the structured
   `app.request` JSON logs (enable `STRUCTURED_LOGS=1`) to the log pipeline and
   derive `http_requests_total` / `http_request_duration_ms` via a log-to-metric
   rule keyed on `event="http_request"`, `status_code`, `duration_ms`.
3. **Synthetic check**: poll `/health/ready` every 60s from the provider's
   uptime monitor → AL-12.
4. **Routing**: P1 → page on-call (see `docs/readiness/OWNERSHIP.md`); P2 →
   Slack + on-call during business hours; P3 → ticket.
5. **Silences**: attach a maintenance-window silence to AL-03/04/12 during
   planned migrations (see `docs/readiness/RELEASE_CHECKLIST.md`).

## Recovery conditions

Every alert above lists an explicit auto-resolve condition so alerts do not flap;
each P1 additionally requires a human ack per `docs/readiness/INCIDENT_SEVERITY.md`.
