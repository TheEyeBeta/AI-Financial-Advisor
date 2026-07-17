# Runbook: Scheduler failure

**Rehearsed:** NO

- **Trigger:** scheduled jobs not firing (intelligence 6h, ranking 01:00 UTC, memory 15m); rankings/meridian visibly stale; admin job worker idle.
- **Severity:** SEV-3.
- **User impact:** stale rankings and context; chat/trading/auth unaffected.

## Immediate containment
1. Find the scheduler replica: exactly one process must run with `SCHEDULER_ENABLED=true` (or dedicated `run_scheduler.py`) — see `docs/OPERATIONS.md` topology.
2. **Two schedulers running is also a failure mode** (duplicate writes) — verify count is exactly one before restarting anything.

## Diagnostics
- Railway logs on the scheduler process: last fire lines per job, exceptions.
- `app/scheduler_config.py` / `test_scheduler_config.py` document expected cadences.
- Check env: was `SCHEDULER_ENABLED` lost in a redeploy/env edit?

## Dashboards / logs
Railway logs + service env vars; Sentry backend.

## Recovery
1. Env flag lost → restore `SCHEDULER_ENABLED=true` on the designated replica only; redeploy.
2. Crash-loop in one job → disable/patch that job via PR; the scheduler must not be left dead because one job throws.
3. After restart, trigger a manual run of the stalest job via the admin API rather than waiting a full cycle.

## Rollback
If a deploy broke a job, roll back backend; scheduled state is idempotent-by-design on next run (refresh jobs overwrite).

## Validation
Each cadence fires once post-recovery (check logs at 15m for memory job); rankings timestamp advances after 01:00 UTC run or manual trigger.

## Communication
Internal; staleness banners cover the user side.

## Post-incident
Add "scheduler last-fire age" to monitoring plan alerts; document any manual trigger used.
