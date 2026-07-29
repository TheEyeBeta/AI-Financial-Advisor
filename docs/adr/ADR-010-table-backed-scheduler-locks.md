# ADR-010: Table-Backed Lease Locks for Scheduled Cycles, Not Postgres Advisory Locks
## Status
Accepted

## Context
`ranking_engine.py`, `memory_agent.py`, and `intelligence_engine.py` each run a scheduled batch cycle (daily ranking, 15-minute memory extraction, 6-hourly intelligence digest) guarded only by an in-process `_cycle_running` boolean — their own docstrings already flagged this as single-process-only. On a multi-replica Railway deployment (this backend explicitly supports `WEB_CONCURRENCY`/multi-replica — see `ai_budget_guard.py`'s `validate_*_configuration()` and `ws_tickets.py`'s Redis-backed ticket store for the same concern solved correctly elsewhere), two replicas can run the same cycle concurrently: duplicate writes to `market.trending_stocks`, duplicate OpenAI spend on memory extraction, duplicate `meridian` digests.

Ops maturity: no Redis-based distributed-lock library currently in use for this specific concern (rate limiting uses `rate_limit_redis.py`, but Redis is optional/configured, not guaranteed present); Postgres/Supabase is always present and is the source of truth for everything else these cycles read and write.

## Problem
How should these three cycles coordinate across replicas so only one instance runs a given cycle at a time, cluster-wide?

## Decision
Add a minimal Postgres table, `core.scheduler_locks` (migration `0044_scheduler_locks`), with two `SECURITY DEFINER` RPCs — `try_acquire_scheduler_lock(lock_name, worker_id, lease_seconds)` (atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE expires_at < NOW()`) and `release_scheduler_lock(lock_name, worker_id)`. Each cycle acquires its lock (named after the existing `admin_jobs.JOB_TYPE_*` constants, reused for consistency) before doing any work and releases it in a `finally` block, alongside the existing in-process flag (cheap same-process fast-path, cluster lock as the real cross-replica guarantee).

## Alternatives considered
- **Postgres advisory locks (`pg_try_advisory_lock`/`pg_advisory_unlock`).** Rejected: these are connection/session-scoped in Postgres. Every call through this codebase's Supabase/PostgREST client is an independent request with no persistent connection held across the minutes a cycle runs — acquiring the lock on one connection and attempting to release it via a separate REST call would either silently no-op (wrong session) or leave the lock held until the pooled connection resets. Transaction-scoped advisory locks (`pg_try_advisory_xact_lock`) have the same problem in the opposite direction: they'd auto-release at the end of the single RPC call's implicit transaction, long before the cycle finishes. A stateless REST-calling architecture needs a row-based lease, not a session-based primitive.
- **Extend `core.admin_jobs` (the existing durable job queue with `claim_admin_job`) to cover these three cycles.** Rejected for this pass: the right long-term home conceptually, but these are direct APScheduler timer calls, not enqueued jobs — routing them through the full job-queue lifecycle (queued/running/succeeded/failed, retries, idempotency keys) would be a much larger change than the concurrency bug requires. `admin_jobs`'s `JOB_TYPE_RANKING`/`JOB_TYPE_MEMORY_EXTRACTION`/`JOB_TYPE_INTELLIGENCE` constants already exist unused for this purpose, suggesting this migration was anticipated but not finished — worth revisiting if these cycles ever need admin-triggered reruns, retry/backoff, or progress visibility in the admin dashboard, none of which a bare lock provides.
- **External distributed-lock service (Redis `SETNX`/Redlock, etcd, etc.).** Rejected: adds an operational dependency (Redis is optional in this deployment, not guaranteed configured) for a problem Postgres already solves correctly with a lease pattern this codebase already uses (`admin_jobs`'s `lease_expires_at`/heartbeat).

## Consequences
- Positive: closes the concurrent-cycle-execution gap with a small, self-contained addition (one table, two functions, no new infrastructure dependency) that mirrors an idiom already proven in this codebase.
- Positive: `service_role`-only grants (no `authenticated`/`anon` access) keep this an internal scheduler concern, never reachable from a user-facing route.
- Negative: a crashed worker that fails to hit the `finally` release (e.g. `SIGKILL`) leaves the lock held until its lease expires (`DEFAULT_LEASE_SECONDS = 900`) — the next cycle tick within that window will legitimately skip. Acceptable: these are idempotent, periodically-rerun batch cycles (next run picks up where the skipped one left off), not user-facing requests where a 15-minute delay would be visible.
- Risk / revisit trigger: if these cycles grow retry/backoff or admin-triggered-rerun requirements, migrate them onto `core.admin_jobs` instead of extending this lock table further.
