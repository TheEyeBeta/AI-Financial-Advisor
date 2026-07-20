# Test E — Failure injection (operator-controlled, not automated)

**This directory does not execute anything.** Per the readiness spec, Test E
must never run automatically. Every scenario below requires a human to
perform the injection step manually against infrastructure they control.
`ALLOW_FAILURE_INJECTION=true` is a manual checklist prerequisite for these
procedures — it is not enforced by any preflight check on the ordinary
background traffic you run alongside an injection (e.g. Test A). It exists
so a script that *does* deliberately induce a failure
(`enforceSafety({ requiresFailureInjection: true })` in
`tests/load/lib/safety.js`) refuses to run without it; it does not, and
cannot, perform the injection itself, and no such script exists in this
directory today. None of these scenarios have real Railway/Valkey/Supabase
admin access from this repo or from an agent session; the steps below are
written for whoever does have that access.

**Never run any of these against production or a target sharing production
Supabase/Valkey/AI-quota** — same rule as Tests A-D
(`LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true`).

## Shared preconditions (all scenarios)

1. `LOAD_TEST_CONFIRMED=true`, `LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true` are
   enforced the same way as every other profile. `ALLOW_FAILURE_INJECTION=true`
   is a manual checklist item for this procedure specifically — confirm it's
   set (and true) before starting, but note it is not checked by the
   background-traffic script (e.g. Test A) you run alongside it.
2. Background load running so there's something to observe degrading and
   recovering — normally Test A (`scripts/run-load-test.sh a`) in a second
   terminal, started *before* the injection.
3. A way to reverse the injection quickly (documented per scenario) — never
   start an injection without already knowing how you'll undo it.
4. `docs/SLO.md`'s alert thresholds as the pass/fail reference — an
   injection test is really asking "does the alert that should fire, fire,
   and does the system recover once the dependency returns."

## Pass criteria (from the readiness spec, applies to every scenario)

- No corrupted trades
- No duplicate chat messages
- No lost onboarding state
- No unbounded queues
- No database connection exhaustion
- No permanent stuck loading state
- No fake data substituted during the outage (the app must show an explicit
  degraded/unavailable state, never silently fabricate data — this is
  already a design principle per `docs/OPERATIONS.md`'s market-data section)
- System recovers after dependency restoration, without a manual restart
  unless the scenario specifically says a restart is the intended recovery
  path (e.g. background-worker termination)

---

## 1. OpenAI unavailable

- **Purpose:** verify `/api/chat` fails cleanly (SLO 4) instead of hanging
  or 500ing when the LLM provider is unreachable.
- **Preconditions:** isolated staging, background Test A traffic running,
  a way to flip the provider key/endpoint without touching production.
- **How to induce:** in the staging Railway service's environment, replace
  `OPENAI_API_KEY` with an invalid value (or point the base URL at an
  unreachable host if the client supports an override), then redeploy or
  restart the service so it takes effect.
- **What to observe:** `/api/chat` responses during the outage window — do
  they return an explicit error (502/503 with a body the frontend can
  render) within a bounded time, or do they hang until a client timeout?
  Check `ai.chat_turn_requests` for turns stuck in `processing` past the
  reconciliation sweep's staleness window
  (`app/services/chat_turn_reconciliation.py`).
- **Pass criteria:** every request during the window terminates cleanly
  (matches SLO 4's "accepted or rejected cleanly" definition); no chat
  turns remain stuck in `processing` after the reconciliation sweep runs.
- **Restore:** revert `OPENAI_API_KEY` to the valid staging value, redeploy.
- **Recovery check:** send one more chat request post-restore and confirm
  a normal streamed response.

## 2. Redis (Valkey) unavailable

Production backs `REDIS_URL` with [Valkey](https://valkey.io)
(BSD-3-Clause Redis-protocol fork — see `deployment/DEPLOYMENT.md`), not
Redis Ltd.'s Redis. It's wire-compatible, so everything below (env var
name, log strings, code paths) is identical either way.

- **Purpose:** verify the app degrades to the documented local-fallback
  rate-limiting mode (`app/services/rate_limit_redis.py`, logged as
  `"Redis-backed rate limiting unavailable, using local fallback"`) rather
  than failing requests outright, and that WebSocket tickets (also
  Redis/Valkey-backed) fail gracefully.
- **Preconditions:** isolated staging Valkey instance you can stop/block
  independently of production Valkey.
- **How to induce:** stop the staging Valkey instance, or block network
  access to it from the staging backend (do not touch `REDIS_URL` — that
  would just look like config unset, not a real dependency failure).
- **What to observe:** backend logs for the fallback message; rate-limit
  behavior (does it still work locally, at least per-instance?); the
  `/health/ready` payload's rate-limit-backend field
  (`app/health_checks.py`).
- **Pass criteria:** requests continue to be served (possibly with
  degraded, per-instance-only rate limiting per `docs/OPERATIONS.md`'s
  documented multi-worker caveat); no 5xx spike attributable to Valkey
  absence; readiness does not flip to "not ready" purely because Valkey is
  down (Valkey is a resilience feature, not a hard readiness dependency —
  confirm this is actually true in `health_checks.py`, don't assume it).
  Also distinguish a real outage from `maxclients` exhaustion — the latter
  makes `ping()` fail the same way and can crash-loop multi-worker
  deployments outright (see `docs/runbooks/redis-unavailable.md`).
- **Restore:** restart/unblock the staging Valkey instance.
- **Recovery check:** confirm rate-limit-backend in `/health/ready`
  reports Redis/Valkey again, not local-fallback.

## 3. Market-data provider unavailable

- **Purpose:** verify Trade Engine endpoints report an explicit
  unavailable/degraded state (never fake data) when the external
  TheEyeBetaDataAPI is unreachable — this is an existing documented
  principle (`docs/OPERATIONS.md`: "endpoints return explicit availability
  metadata, never silent stubs").
- **Preconditions:** isolated staging, ability to block the staging
  backend's network path to the DataAPI provider (or point its configured
  URL at an unreachable host).
- **How to induce:** block/misconfigure the DataAPI connection for the
  staging backend only.
- **What to observe:** `/api/v1/engine/status`, `/api/stock-price/{ticker}`,
  `/api/stocks/ranking` responses during the outage — per
  `app/routes/trade_engine.py`, these should return explicit `502`/`503`
  or an "unreachable" status field, not stale-but-unlabeled data or a
  fabricated price.
- **Pass criteria:** no endpoint returns synthetic/fabricated market data;
  the frontend's stock views show an explicit unavailable state (not a
  silent stale render) — this needs an actual frontend check during the
  injection window, not just an API-level check.
- **Restore:** unblock/reconfigure the DataAPI connection.
- **Recovery check:** confirm `/api/v1/engine/status` reports connected
  again and a stock-price request returns live data.

## 4. Increased database latency

- **Purpose:** verify the app degrades gracefully (timeouts, explicit
  errors) rather than cascading into connection-pool exhaustion when
  Supabase Postgres is slow.
- **Preconditions:** isolated staging Supabase project where you can
  introduce artificial latency (e.g. a network-shaping proxy in front of
  the DB connection, or a Supabase-side throttle if the plan supports it —
  this repo has no built-in latency-injection tooling, and none should be
  added to production-reachable code paths).
- **How to induce:** route the staging backend's DB connection through a
  latency-injecting proxy (e.g. `toxiproxy`), or use whatever your Supabase
  plan/tooling offers for controlled throttling. **Do not attempt this
  against the real project without a documented, reversible mechanism in
  place first.**
- **What to observe:** `/health/ready`'s Supabase ping timing and the
  general request-latency dashboard (once built per
  `docs/MONITORING_IMPLEMENTATION_PLAN.md`); watch for connection-pool
  saturation, not just slow individual requests.
- **Pass criteria:** no database connection exhaustion; requests slow down
  and/or time out explicitly rather than the service becoming fully
  unresponsive; `/health/ready` correctly reflects degraded state if
  latency crosses whatever threshold it checks.
- **Restore:** remove the latency injection.
- **Recovery check:** confirm request latency returns to baseline and
  `/health/ready` reports `ready` cleanly.

## 5. Background worker termination

- **Purpose:** verify a killed admin-job-worker/scheduler process is
  recovered from without stuck jobs or data corruption.
- **Preconditions:** isolated staging with the scheduler/admin-job-worker
  process identifiable and killable independently of the web workers
  (`app/services/admin_job_worker.py`, runs in the scheduler process per
  `docs/OPERATIONS.md`'s worker topology section).
- **How to induce:** forcibly terminate (`SIGKILL`) the staging scheduler
  process while a job is in flight (trigger one via the admin panel or
  `/api/admin/trigger-*` first, then kill the process before it completes).
- **What to observe:** the job's row in the admin jobs table
  (`app/services/admin_jobs.py`) — does it remain stuck `processing`
  forever, or does something eventually mark it failed/retryable?
  `/api/admin/scheduler-status` for staleness detection.
- **Pass criteria:** no unbounded queue growth; the interrupted job is
  either retried or surfaced as failed (not silently lost); once the
  process restarts, subsequent scheduled runs resume normally.
- **Restore:** restart the scheduler process (Railway should do this
  automatically on crash for a properly configured service — confirm that
  assumption during the drill rather than relying on it blindly).
- **Recovery check:** trigger a fresh job and confirm it completes
  normally; confirm `/api/admin/scheduler-status` shows recent activity.

## 6. Scheduler restart

- **Purpose:** verify a clean (not crash) scheduler restart doesn't
  duplicate scheduled work (e.g. double-ranking, double-digest) or lose a
  job that was queued but not yet picked up.
- **Preconditions:** isolated staging, ability to trigger a normal restart
  of the scheduler-enabled replica (e.g. Railway redeploy/restart of that
  specific service).
- **How to induce:** restart the staging scheduler process via normal
  means (redeploy, or the platform's restart action) — this is testing the
  *ordinary* restart path, not a crash.
- **What to observe:** job history immediately before/after the restart for
  duplicate runs of the same scheduled job within one window; the admin
  jobs table for orphaned `queued` rows that never got picked up.
- **Pass criteria:** no duplicate scheduled-job execution; no orphaned
  queued jobs after restart; scheduler resumes its normal cadence
  (intelligence 6h, ranking 01:00 UTC, memory 15m per `docs/OPERATIONS.md`).
- **Restore:** n/a — this scenario's "restore" is just confirming normal
  operation resumed.
- **Recovery check:** confirm the next scheduled job fires at its expected
  time and completes once.

---

## Reporting

There is no automated report generator for Test E (unlike A-D, which use
`tests/load/lib/reporting.js`) — record each drill manually using the same
fields as `docs/recovery/RECOVERY_EVIDENCE_TEMPLATE.md` (test date, git SHA,
environment, what was induced, what was observed, pass/fail against the
criteria above, and how long recovery took). Treat every Test E finding with
the same rigor as the Phase 5 recovery exercise: `NOT VERIFIED` until it has
actually been run once, by a human, against real isolated staging
infrastructure.
