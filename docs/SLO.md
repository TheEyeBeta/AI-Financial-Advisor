# Service-Level Objectives — 150-user beta

**Owner:** TheEyeBeta · **Status:** SPECIFICATION ONLY — no dashboard or alert
referenced below has been verified to exist. See
[`MONITORING_IMPLEMENTATION_PLAN.md`](./MONITORING_IMPLEMENTATION_PLAN.md) for
exactly what telemetry the repo already emits versus what still requires
external configuration. Do not treat any "Dashboard panel" or "Alert
threshold" section here as live until that plan's gaps are closed and the
panel/alert is verified against the actual tool in use.

This document defines each SLO precisely enough to implement without further
interpretation: what it measures, where the data comes from, when it's
breached, and what happens when it is. It does not implement any of it.

---

## 1. Monthly availability — 99.9%

- **Metric definition:** the fraction of one-minute windows in a calendar
  month where `/health/ready` on the primary backend instance responds `200`
  with `status: "ready"` when polled externally (outside-in, not
  self-reported).
- **Numerator:** count of 1-minute windows where at least one external probe
  succeeded.
- **Denominator:** total 1-minute windows in the month (≈43,200).
- **Included traffic:** external synthetic probes only (see Measurement
  window). Internal health checks (Railway's own container healthcheck) do
  not count toward this SLO — they gate deploys, not availability reporting.
- **Excluded traffic:** planned maintenance windows, if any are ever
  declared in advance (none currently exist for this beta — until a
  maintenance-window process exists, nothing is excluded).
- **Measurement window:** calendar month, evaluated by an external uptime
  checker polling `/health/ready` every 60 seconds.
- **Data source required:** an external synthetic monitor (e.g. a
  status-page/uptime service) hitting the public backend URL. **Not present
  today** — Railway's internal healthcheck only gates its own deploys, it is
  not an external-perspective monthly-uptime record.
- **Alert thresholds:** page if `/health/ready` fails for 2–5 consecutive
  probe minutes (matches the required alert list in the readiness spec).
- **Error budget:** 99.9% of 43,200 minutes/month ≈ 43 minutes of downtime
  budget per month.
- **Consequence of exhausting the budget:** freeze non-essential deploys for
  the remainder of the month; the next release requires a documented root
  cause and mitigation before shipping. (Beta-stage policy — revisit at GA.)
- **Dashboard panel spec:** single stat panel, "Monthly availability %",
  rolling 30-day window, red below 99.9%, computed from the external
  monitor's own uptime percentage — do not compute this from in-app logs,
  since an outage that also takes down logging would silently inflate the
  number.
- **Runbook linkage:** `docs/runbooks/backend-readiness-failure.md`
  *(placeholder — runbook not yet written)*.

---

## 2. Normal API p95 latency — under 500 ms

- **Metric definition:** 95th-percentile server-side request duration for
  non-AI, non-streaming API endpoints.
- **Numerator/denominator:** not a ratio — a percentile over the duration
  distribution of in-scope requests in the window.
- **Included traffic:** all `2xx`/`4xx` responses from REST endpoints under
  `/api/*` and `/rest/v1/*` **excluding** `/api/chat`, `/api/chat/stream`, or
  any endpoint that calls an LLM provider (those are covered by SLO 5, not
  this one — AI latency is dominated by provider time, not app code, and
  mixing them hides regressions in the fast path).
- **Excluded traffic:** AI/LLM-backed endpoints, WebSocket connections,
  health-check endpoints (`/health/*`), admin trigger endpoints (low-volume,
  not representative of user-facing latency).
- **Measurement window:** rolling 5-minute window for the live dashboard;
  rolling 30-day window for the monthly SLO report.
- **Data source required:** `duration_ms` field already emitted per request
  by `CorrelationIdMiddleware` (`app/middleware/correlation.py`,
  `log_event("http_request", ..., duration_ms=...)`) — **exists today as a
  structured log line**, but nothing currently aggregates these logs into a
  percentile metric. Needs a log pipeline (or a metrics middleware emitting
  a histogram) feeding a dashboard tool.
- **Alert thresholds:** warn at p95 > 500 ms for 10 consecutive minutes;
  page at p95 > 1000 ms for 10 consecutive minutes (2x budget, sustained).
- **Error budget:** framed as "percentage of 5-minute windows in the month
  where p95 stayed under 500 ms" — target 99% of windows compliant.
- **Consequence of exhausting the budget:** triage session before the next
  feature release; if a specific endpoint is the driver, that endpoint gets
  a performance task before new work in its area ships.
- **Dashboard panel spec:** line chart, p50/p95/p99 overlaid, 24h default
  range, annotated with deploy markers (release SHA) so a regression can be
  correlated to a specific release.
- **Runbook linkage:** `docs/runbooks/high-latency.md` *(placeholder)*.

---

## 3. Normal API p99 latency — under 1.5 s

- **Metric definition, included/excluded traffic, data source:** identical
  to SLO 2 — same distribution, 99th percentile instead of 95th.
- **Measurement window:** same as SLO 2.
- **Alert thresholds:** warn at p99 > 1.5 s for 10 consecutive minutes; page
  at p99 > 3 s for 10 consecutive minutes.
- **Error budget:** 99% of 5-minute windows in the month compliant.
- **Consequence of exhausting the budget:** same escalation path as SLO 2;
  p99 breaches without a matching p95 breach point at a specific slow-path
  (e.g. one endpoint, one query, one dependency) rather than general load —
  triage should look for an outlier, not assume systemic overload.
- **Dashboard panel spec:** same panel as SLO 2 (p50/p95/p99 share one
  chart).
- **Runbook linkage:** `docs/runbooks/high-latency.md` *(placeholder,
  shared with SLO 2)*.

---

## 4. AI request accepted or rejected cleanly — 99.5%

- **Metric definition:** the fraction of `/api/chat` (and equivalent
  AI-proxy) requests that terminate in a **clean** state — either a
  successful streamed response, or an explicit, well-formed error response
  (`4xx` with a body the frontend can render, or a `429`/`503` the frontend
  already has a defined UI state for) — as opposed to an **unclean**
  termination: connection drop, unhandled `5xx`, timeout with no response
  written, or a turn stuck in `processing` status that `chat_turn_reconciliation`
  later has to mark `failed`.
- **Numerator:** count of AI requests ending in a clean state (success or
  well-formed rejection).
- **Denominator:** total AI requests initiated in the window.
- **Included traffic:** all `/api/chat` calls and any other LLM-backed
  endpoint (quant analysis, chat title generation) that a user directly
  triggers.
- **Excluded traffic:** none — this SLO is specifically about not leaving
  the user in an ambiguous state, so every AI request counts.
- **Measurement window:** rolling 1-hour window for the live dashboard;
  rolling 30-day window for the monthly report.
- **Data source required:** `ai.chat_turn_requests.status` (`completed`,
  `failed` with a `failure_code`, vs. entries the reconciliation job has to
  sweep as `stale_timeout` — see `app/services/chat_turn_reconciliation.py`)
  is the source of truth for "did this end cleanly." **Exists today as a DB
  table**; no dashboard currently queries it. A scheduled query (or a metric
  emitted alongside the reconciliation sweep) is needed to turn this into a
  live number.
- **Alert thresholds:** page if the clean-termination rate drops below 99.5%
  over a rolling 1-hour window, or if `chat_turn_reconciliation` sweeps more
  than 5 stale turns in a single run (a spike in stuck turns is an early
  signal before the 1-hour rate crosses threshold).
- **Error budget:** 0.5% of AI requests/month may end uncleanly.
- **Consequence of exhausting the budget:** treat as an incident — this
  directly means users are seeing stuck/broken chat, not just slow chat.
  Provider-side root cause (see SLO 5's provider-error-rate breakdown)
  should be checked first.
- **Dashboard panel spec:** stacked bar or stat panel: clean-success %,
  clean-rejection %, unclean % — three-way breakdown, not a single number,
  since "clean rejection" (e.g. a correct 429) should not be conflated with
  "unclean failure."
- **Runbook linkage:** `docs/runbooks/ai-provider-errors.md` *(placeholder)*.

---

## 5. AI first-token p95 latency — under 8 s

- **Metric definition:** 95th-percentile time from request received to
  first streamed chunk written to the client, for `/api/chat`.
- **Numerator/denominator:** percentile, not a ratio.
- **Included traffic:** all `/api/chat` requests that reach the point of
  attempting to stream (excludes requests rejected before generation starts,
  e.g. by rate limiting — those are measured under SLO 4, not this one).
- **Excluded traffic:** requests that never reach the provider call (auth
  failures, validation errors, rate-limited requests).
- **Measurement window:** rolling 1-hour window live; rolling 30-day for
  the monthly report.
- **Data source required:** **not currently measured anywhere.** The
  backend does not currently timestamp "first chunk written" separately
  from "request start" in a way that's queryable after the fact — this
  needs a new metric/log field (`time_to_first_token_ms`) emitted at the
  point the first SSE chunk is flushed in `app/routes/ai_proxy.py`.
- **Alert thresholds:** warn if p95 > 8 s for 15 consecutive minutes; page
  if p95 > 15 s for 15 consecutive minutes, or if the AI provider's own
  error/timeout rate (see below) spikes concurrently.
- **Error budget:** 5% of 1-hour windows in the month may exceed 8 s at p95.
- **Consequence of exhausting the budget:** check provider-side status
  first (this is explicitly allowed to be slower than conventional APIs
  per the readiness spec — the budget exists to catch genuine regressions,
  not to fight normal LLM provider variance).
- **Dashboard panel spec:** separate panel from SLO 2/3, split into four
  series per the readiness spec's explicit breakdown: **queue delay**, **time
  to first token**, **total generation time**, **provider error rate** — do
  not merge these into one number; they diagnose different problems.
- **Runbook linkage:** `docs/runbooks/ai-provider-errors.md` *(placeholder,
  shared with SLO 4)*.

---

## 6. Unhandled server-error rate — under 0.5%

- **Metric definition:** fraction of all backend requests resulting in an
  unhandled `5xx` (an exception the app didn't turn into a deliberate error
  response — i.e. what `CorrelationIdMiddleware`'s `except Exception` branch
  logs as `http_request_error`).
- **Numerator:** count of requests logged as `http_request_error`.
- **Denominator:** total requests in the window.
- **Included traffic:** all backend requests, all endpoints.
- **Excluded traffic:** deliberate `5xx` responses the app returns on
  purpose (e.g. `502` when an upstream provider is confirmed down and the
  app is correctly reporting that) — these are handled, not unhandled, and
  should not count against this SLO. This distinction requires tagging
  deliberate vs. exception-driven 5xx separately; today both look the same
  in the raw log unless the response was one of FastAPI's `HTTPException`
  paths (which are not logged via the `except Exception` branch) — so in
  practice `http_request_error` events already only capture the unhandled
  case correctly, since `HTTPException` doesn't reach that branch.
- **Measurement window:** rolling 5-minute window live; rolling 30-day for
  the monthly report.
- **Data source required:** `http_request_error` structured log events
  (**exists today**, `app/middleware/correlation.py`) plus Sentry's
  exception capture (**exists today**, `app/observability.py`, gated on
  `SENTRY_DSN`). No dashboard currently aggregates the log-based rate; Sentry
  provides issue-level visibility but not a rate-over-total-requests metric
  out of the box without configuring it.
- **Alert thresholds:** page if the unhandled-5xx rate exceeds 0.5% over a
  rolling 5-minute window with at least 20 requests in the window (avoid
  false pages on near-zero traffic).
- **Error budget:** 0.5% of all requests/month.
- **Consequence of exhausting the budget:** treat as a release-blocking
  incident; identify the endpoint(s) driving it via Sentry issue grouping
  before shipping further changes.
- **Dashboard panel spec:** line chart, unhandled-5xx rate over time, with
  a secondary panel breaking down by endpoint (top 5 contributors).
- **Runbook linkage:** `docs/runbooks/elevated-5xx-rate.md` *(placeholder)*.

---

## 7. Failed paper-trade integrity operations — zero

- **Metric definition:** count of paper-trading operations that violate a
  data-integrity invariant — oversell, negative quantity/price, a
  `rebuildPaperTradingState` call that discards a rebuild after the
  journal entry already saved (the class of bug fixed in this repo's
  `paper-trading-ledger.ts` this cycle), or any DB constraint violation on
  `trading.*` tables that surfaces to the user as a failure after their
  order was accepted.
- **Numerator:** count of such events.
- **Denominator:** none — this is a hard zero-tolerance count, not a rate.
- **Included traffic:** all paper-trading write paths (journal entry
  creation, position rebuild, admin-triggered corrections).
- **Excluded traffic:** DB constraint violations that correctly **reject**
  a bad request before anything is persisted (e.g. the oversell-protection
  trigger doing its job) are the system working correctly, not a failure —
  only count cases where the user was told something succeeded (or the
  request appeared to complete) while the resulting state is wrong or
  inconsistent.
- **Measurement window:** continuous; reported monthly, alerted immediately.
- **Data source required:** **not currently measured as a dedicated
  metric.** DB-level constraints exist and are tested
  (`test_trading_constraints_db.py`), and the specific "rebuild silently
  discarded" bug class is now covered by
  `src/services/__tests__/paper-trading-sync.test.ts`. What's missing is a
  *production* signal — e.g. an alert on any `admin.user_*` or
  `trading.*`-schema constraint-violation log line, or a scheduled
  reconciliation job comparing `trade_journal` against `open_positions` /
  `portfolio_history` for drift.
- **Alert thresholds:** page on any single occurrence — zero tolerance.
- **Error budget:** zero. Any occurrence is an incident.
- **Consequence of exhausting the budget:** immediate incident, affected
  user(s) identified and made whole manually if their portfolio state is
  wrong; postmortem required.
- **Dashboard panel spec:** single stat, "Failed integrity operations
  (30d)" — should read 0; any non-zero value is red regardless of magnitude.
- **Runbook linkage:** `docs/runbooks/paper-trade-integrity-incident.md`
  *(placeholder)*.

---

## 8. Data-loss incidents — zero

- **Metric definition:** count of incidents where durably-stored user data
  (chats, trades, academy progress, profile/onboarding data, audit records)
  is destroyed or becomes unrecoverable outside of the user's own deliberate
  delete action.
- **Numerator:** count of such incidents.
- **Denominator:** none — zero-tolerance count.
- **Included/excluded traffic:** not traffic-based; this is an incident
  count, not a request-level metric.
- **Measurement window:** continuous; reported monthly, alerted immediately.
- **Data source required:** no automated detection exists today. Backups
  (`docs/DB_RECOVERY.md`) and audit records (`app/services/audit.py`, now
  wired into suspend/restore/delete this cycle) provide the raw material to
  *investigate* a suspected loss, but nothing currently *detects* one
  automatically. Candidate signals: unexpected row-count drops in a
  scheduled table-count check, or a spike in `admin.user_deleted` /
  orphan-cleanup audit events outside expected volume (see SLO 9 below,
  which is the closest existing proxy).
- **Alert thresholds:** page on any confirmed incident; the "unexpected
  administrative deletion/suspension volume" alert (SLO 9's mechanism) is
  the leading indicator that should fire before a human confirms actual
  data loss.
- **Error budget:** zero.
- **Consequence of exhausting the budget:** immediate incident; execute the
  restore procedure (`docs/DB_RECOVERY.md`, and the Phase 5 recovery
  documents in `docs/recovery/` once the drill has actually been performed);
  postmortem required; RPO/RTO actuals recorded against the targets below.
- **Dashboard panel spec:** single stat, "Data-loss incidents (30d)" — same
  zero-tolerance styling as SLO 7.
- **Runbook linkage:** `docs/runbooks/data-loss-incident.md` *(placeholder)*.

---

## 9. Restore-point objective (RPO) — 24 hours or less

- **Metric definition:** the maximum acceptable gap between the most recent
  backup and the point of data loss, i.e. how much data a restore could lose.
- **Numerator/denominator:** not a ratio — measured as elapsed time since
  the last successful, verified backup.
- **Included/excluded traffic:** not traffic-based.
- **Measurement window:** continuous — the gap must never exceed 24h at any
  point in time, not just on average.
- **Data source required:** Supabase's own backup schedule/status (daily
  backups per `docs/DB_RECOVERY.md`) — **exists as a platform feature**, but
  there's no automated check confirming a backup actually completed
  successfully each day; today this is manual ("Supabase Dashboard →
  Database → Backups: confirm the latest daily backup is recent").
- **Alert thresholds:** page if the most recent successful backup is older
  than 24 hours, or if a scheduled backup fails.
- **Error budget:** none — this is a hard ceiling, not a percentage.
- **Consequence of exhausting the budget:** treat as an active data-loss
  risk even absent an incident; escalate to fix the backup pipeline
  immediately.
- **Dashboard panel spec:** single stat, "Hours since last verified
  backup," red above 24.
- **Runbook linkage:** `docs/runbooks/backup-failure.md` *(placeholder)*.

---

## 10. Restore-time objective (RTO) — 4 hours or less

- **Metric definition:** the maximum acceptable elapsed time from a
  declared data-loss incident to the restored system serving traffic again
  with verified data integrity.
- **Numerator/denominator:** not a ratio — measured per-incident, elapsed
  wall-clock time.
- **Included/excluded traffic:** not traffic-based.
- **Measurement window:** per-incident; there is no "normal operation"
  measurement — this SLO only has a value when an incident occurs.
- **Data source required:** the restore procedure itself
  (`docs/DB_RECOVERY.md`'s forward-recovery steps, plus the Phase 5
  documents in `docs/recovery/`) is the mechanism; the *timing* is manual —
  recorded by whoever executes the restore, using the
  `docs/recovery/RPO_RTO_WORKSHEET.md` and
  `docs/recovery/RECOVERY_EVIDENCE_TEMPLATE.md` created alongside this
  document. **This objective has never been measured against a real
  restore** — see `docs/recovery/` for the prepared-but-`NOT VERIFIED`
  exercise.
- **Alert thresholds:** not alertable in advance (it's a target for a
  hypothetical future incident) — but during an active incident, escalate
  internally if elapsed time passes 2 hours without a completed restore
  (halfway checkpoint).
- **Error budget:** none — hard ceiling per incident.
- **Consequence of exhausting the budget:** postmortem must address why the
  restore took longer than 4 hours and what specifically slowed it down
  (this is exactly what the Phase 5 recovery-evidence template is for).
- **Dashboard panel spec:** none (not a live metric) — reported in the
  post-incident writeup instead.
- **Runbook linkage:** `docs/DB_RECOVERY.md`, `docs/recovery/ISOLATED_RESTORE_PROCEDURE.md`.

---

## Summary table

| # | SLO | Target | Data source status |
|---|-----|--------|---|
| 1 | Monthly availability | 99.9% | Needs external synthetic monitor |
| 2 | Normal API p95 | <500ms | Log field exists; no aggregation/dashboard |
| 3 | Normal API p99 | <1.5s | Log field exists; no aggregation/dashboard |
| 4 | AI accepted/rejected cleanly | 99.5% | DB table exists; no dashboard query |
| 5 | AI first-token p95 | <8s | **Not measured at all** — needs new instrumentation |
| 6 | Unhandled server-error rate | <0.5% | Log events + Sentry exist; no rate dashboard |
| 7 | Failed paper-trade integrity ops | 0 | DB constraints + tests exist; no production alert signal |
| 8 | Data-loss incidents | 0 | No automated detection; manual investigation only |
| 9 | RPO | ≤24h | Platform backups exist; no automated freshness check |
| 10 | RTO | ≤4h | Procedure documented; **never measured against a real restore** |

No dashboard or alert in this document should be described as "implemented"
anywhere else in this repo's docs until it is built against a named tool and
verified to fire correctly.
