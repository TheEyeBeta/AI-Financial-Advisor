# Runbook: Background-job backlog

**Rehearsed:** NO

- **Trigger:** admin jobs queued but not completing; job age alarms; admin dashboard showing stuck jobs.
- **Severity:** SEV-3 (user-facing features are synchronous; jobs are admin/maintenance).
- **User impact:** indirect — stale rankings/meridian context, delayed admin operations.

## Immediate containment
1. Confirm the worker is running: the admin job worker lives **in the scheduler process** (`SCHEDULER_ENABLED=true` replica or `run_scheduler.py`). No scheduler replica = no worker (`scheduler-failure.md`).
2. Don't blindly re-enqueue — check whether the head job is failing repeatedly and poisoning the queue.

## Diagnostics
- Admin routes for job status (`app/routes/admin.py`, `app/services/admin_jobs.py`) — list pending/failed jobs with timestamps.
- Job logs via `job_logger.py` output in Railway logs (correlation IDs).
- `test_admin_job_worker.py` documents expected lifecycle semantics.

## Dashboards / logs
Railway logs (scheduler service/replica), Sentry backend.

## Recovery
1. Failing head job: mark failed / remove per admin API, file issue with its payload.
2. Worker crashed: restart the scheduler replica; verify single-replica rule still holds (exactly one `SCHEDULER_ENABLED=true`).
3. Backlog drains in order; monitor age of oldest pending job to zero.

## Rollback
If a deploy introduced a failing job type, roll back the backend and leave the failed jobs for reprocessing after fix.

## Validation
Queue empty or draining; newest job completes end-to-end; no repeated failure loop in logs.

## Communication
Internal only, unless a user-facing dataset (rankings) went stale enough to notice — then a status note.

## Post-incident
Add/adjust job-age alerting in the monitoring plan (`docs/MONITORING_IMPLEMENTATION_PLAN.md`); consider dead-letter handling if a poison job recurred.
