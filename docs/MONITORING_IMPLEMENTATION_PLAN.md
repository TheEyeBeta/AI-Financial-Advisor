# Monitoring implementation plan

**Owner:** TheEyeBeta · **Status:** planning document — inventories what
telemetry the codebase already emits versus what requires external tooling
this repo does not currently configure. Nothing in the "Required dashboards"
or "Required alerts" sections of the readiness spec is implemented. Do not
cite this document as evidence that dashboards or alerts exist.

## 1. What already exists in the repo (verified by reading the code)

| Telemetry | Where | What it gives you | What it doesn't give you |
|---|---|---|---|
| Structured per-request logs | `app/middleware/correlation.py` — `CorrelationIdMiddleware`, `log_event("http_request", ...)` / `log_event("http_request_error", ...)` | JSON (in production/`STRUCTURED_LOGS=true`) log line per request: `method`, `path`, `status_code`, `duration_ms`, `correlation_id`, `environment`, `release` | Not aggregated anywhere — no percentile calculation, no dashboard, no alerting. It's stdout/stderr log lines only; whatever ingests Railway's log output (or doesn't) determines whether this data survives at all. |
| Backend exception tracking | `app/observability.py` — Sentry, gated on `SENTRY_DSN` | Exception capture, release tagging (`APP_VERSION`), PII scrubbing (`send_default_pii=False`, header redaction) | `SENTRY_DSN` is optional/unset by default per `docs/OPERATIONS.md`'s env table — unverified whether it's actually set in the staging or production environment. Even if set, Sentry issue tracking is not the same as an unhandled-5xx-*rate* dashboard (SLO 6) — that requires either Sentry's own rate alerting configured, or deriving it from the structured logs. |
| Frontend error tracking | Referenced in `docs/OPERATIONS.md` ("Frontend Sentry: privacy-hardened") and `docs/security/TELEMETRY_PRIVACY.md` | Same caveats as backend Sentry — presence not verified in this pass. |
| Frontend product analytics | `src/services/analytics.ts` — PostHog, gated on a PostHog key env var, no-op fallback when unset | Funnel/retention/conversion events (`AnalyticsEvents.*` calls scattered through `src/pages/*`, e.g. `chatSent`, `chatResponseFailed`, `tradeExecuted`) | Product analytics, not infra/reliability monitoring — wrong tool for latency/error-rate dashboards even if configured. |
| Readiness/liveness probes | `app/health_checks.py` — `/health/live`, `/health/ready` (config validation, Supabase ping, schema-revision match, rate-limit backend, startup completion) | A point-in-time health signal any external monitor or Railway's own healthcheck can poll | Railway's internal use of this only gates its own deploys — it is not a recorded, queryable uptime history unless something external polls and stores the result (SLO 1). |
| AI chat turn status | `ai.chat_turn_requests` table (migration `0030_chat_turn_requests`), reconciliation sweep in `app/services/chat_turn_reconciliation.py` | Durable, queryable record of every chat turn's outcome (`pending`/`processing`/`completed`/`failed`+`failure_code`) — exactly the data SLO 4 needs | Nothing currently runs a scheduled query against this table to produce a live rate; it's only read by the reconciliation sweep and admin dashboard/debug paths. |
| Audit log | `app/services/audit.py` — JSONL file (`AI_AUDIT_LOG_PATH`, default `logs/audit.jsonl`), now called from `suspend_user_account`, `restore_user_account`, `execute_delete_request` (added this cycle) | A durable record of destructive account actions with actor/target/reason, independent of general app logs | It's a local file on the running instance's filesystem — on Railway's ephemeral containers this does **not** survive a redeploy or restart unless shipped somewhere durable. This is a real gap: right now the audit trail is only as durable as the container it was written on. |
| Job run logging | `app/services/job_logger.py` — `log_job_run`, writes a summary row per background job execution | Scheduler/job success-failure history | Not surfaced on any dashboard; would need a query against wherever `log_job_run` persists to. |
| Rate limiting | `app/services/rate_limit.py`, `app/services/rate_limit_redis.py` | Enforces limits; 429 responses are visible in the structured request logs like any other status code | No dedicated "rate-limit events" panel — would need to filter the request-log stream by `status_code == 429`. |

## 2. What requires external configuration (not present in this repo)

These cannot be built by editing application code alone — each needs a
decision about which external tool to use, then configuration in that
tool's control plane (which is out of an agent's reach per this repo's
`AGENTS.md` §3 — production platform dashboards are a forbidden zone
without human-run steps).

1. **A dashboard/metrics tool.** Nothing in this repo integrates with
   Grafana, Datadog, Prometheus, or any other metrics backend. The
   structured JSON logs (`log_event`) are the raw material a log-based
   metrics pipeline (e.g. shipping Railway logs to a log platform that can
   compute percentiles/rates from them) would consume — but no such pipeline
   is configured. **Decision needed:** pick a tool before any dashboard in
   `docs/SLO.md` can be built.
2. **An external synthetic uptime monitor** for SLO 1 (monthly
   availability) — something outside Railway polling `/health/ready` on a
   fixed interval and keeping its own uptime history.
3. **A log aggregation/shipping destination** for the structured request
   logs to land somewhere queryable and durable (today they're Railway's
   ephemeral log output).
4. **Time-to-first-token instrumentation** (SLO 5) — this is a code change,
   not just a config change: `app/routes/ai_proxy.py` needs to timestamp and
   log the moment the first SSE chunk is flushed, separate from total
   request duration. Not implemented in this pass because it touches the
   hot streaming path and deserves its own focused change + test, not a
   drive-by edit alongside this documentation work.
5. **Durable audit log storage.** `app/services/audit.py` writes to a local
   file that does not survive an ephemeral container restart. Needs either
   a persistent volume, or redirecting `AUDIT_LOG_PATH` at a durable
   destination (e.g. shipping to the same log platform as #3, or writing to
   a dedicated Supabase table instead of a local file).
6. **Alert routing** (PagerDuty/Slack/email/etc.) for every alert threshold
   defined in `docs/SLO.md` — no alert-routing integration exists in this
   repo today.
7. **A scheduled backup-freshness check** for SLO 9 (RPO) — today "confirm
   the latest daily backup is recent" is a manual step in
   `docs/DB_RECOVERY.md`; automating it needs either a scheduled job hitting
   Supabase's management API or a check built into the existing scheduler.

## 3. Recommended sequencing (not started)

1. Pick the dashboard/metrics/alerting tool (human decision — this repo
   doesn't have one chosen; do not infer one).
2. Wire structured logs to that tool first — it's the highest-leverage step
   since SLOs 2, 3, 6 (and partially 1, 4) all derive from the same
   `log_event` stream that already exists.
3. Add the missing time-to-first-token instrumentation (SLO 5) as its own
   focused change.
4. Move the audit log off local-file storage before relying on it for any
   compliance/incident-investigation claim.
5. Configure the external uptime monitor (SLO 1) and backup-freshness check
   (SLO 9) — both are small, tool-specific configuration tasks once #1 is
   decided.
6. Build the dashboard panels and alert rules specified per-SLO in
   `docs/SLO.md`, verify each alert actually fires (test it, don't assume),
   then and only then update this plan's status and `docs/OPERATIONS.md` to
   say they exist.

## 4. Explicit non-claims

This plan does **not** claim:
- Any dashboard currently exists.
- Any alert currently fires.
- `SENTRY_DSN` is set in any real environment (unverified in this pass).
- The structured logs are currently retained anywhere beyond Railway's
  default log retention.
- The audit log survives a container restart in production today.

Any of the above being true requires verification against the actual
running environment, not an assumption from reading source code.
