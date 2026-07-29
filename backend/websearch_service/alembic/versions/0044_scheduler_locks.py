"""Cluster-wide lease locks for scheduled batch cycles.

Architecture audit (rip-apart pass) found that `ranking_engine.py`,
`memory_agent.py`, and `intelligence_engine.py` each guard their scheduled
cycle (`run_ranking_cycle`, `run_memory_extraction_cycle`,
`run_intelligence_cycle`) with only an in-process `_cycle_running` boolean.
Their own docstrings say as much: "Run lock prevents overlapping cycles in
a **single-process** deployment" (ranking_engine.py) and "For multi-replica
deployments, replace with a distributed lock" (memory_agent.py). On a
multi-replica Railway deployment (or during a rolling deploy where two
replicas briefly overlap), a second replica's in-process flag starts at
`False` independently, so both replicas can run the same cycle
concurrently — duplicate writes to `market.trending_stocks`, duplicate
OpenAI spend on memory extraction, duplicate `meridian` digests.

`core.admin_jobs` (0031) already solved this exact problem for the admin
job queue via `claim_admin_job`'s atomic, lease-based claim — but that
queue is a poor fit to bolt onto these three APScheduler-driven cycles
without a larger refactor (they're not enqueued jobs; they're direct
function calls on a timer). This migration adds a minimal, purpose-built
lease table mirroring the same idiom (row-per-lock, `expires_at`-based
takeover, no distributed-lock server dependency) scoped to just this
problem: `core.scheduler_locks` plus `try_acquire_scheduler_lock` /
`release_scheduler_lock` RPCs.

Classic Postgres advisory locks (`pg_try_advisory_lock`) were considered
and rejected: they're connection/session-scoped, but each call here is an
independent PostgREST request with no persistent connection to hold the
lock across the minutes a cycle runs — a table-backed lease is the correct
shape for a stateless REST caller, same reasoning as `admin_jobs`.

`service_role` only; no `authenticated`/`anon` grants — these locks are an
internal scheduler concern, never called from a user-facing route.
"""
from __future__ import annotations

from alembic import op

revision = "0044_scheduler_locks"
down_revision = "0043_trading_atomic_rebuild"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.scheduler_locks (
            lock_name TEXT PRIMARY KEY,
            locked_by TEXT NOT NULL,
            locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        );

        ALTER TABLE core.scheduler_locks ENABLE ROW LEVEL SECURITY;
        -- No policies: service_role bypasses RLS by default and is the
        -- only role granted access below; authenticated/anon get nothing.

        CREATE OR REPLACE FUNCTION core.try_acquire_scheduler_lock(
            p_lock_name TEXT,
            p_worker_id TEXT,
            p_lease_seconds INTEGER DEFAULT 900
        )
        RETURNS BOOLEAN
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = core, pg_temp
        AS $$
        DECLARE
            v_acquired BOOLEAN;
        BEGIN
            INSERT INTO core.scheduler_locks (lock_name, locked_by, locked_at, expires_at)
            VALUES (
                p_lock_name, p_worker_id, NOW(),
                NOW() + make_interval(secs => p_lease_seconds)
            )
            ON CONFLICT (lock_name) DO UPDATE
                SET locked_by = EXCLUDED.locked_by,
                    locked_at = NOW(),
                    expires_at = EXCLUDED.expires_at
                WHERE core.scheduler_locks.expires_at < NOW()
            RETURNING TRUE INTO v_acquired;

            RETURN COALESCE(v_acquired, FALSE);
        END;
        $$;

        CREATE OR REPLACE FUNCTION core.release_scheduler_lock(
            p_lock_name TEXT,
            p_worker_id TEXT
        )
        RETURNS VOID
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = core, pg_temp
        AS $$
        BEGIN
            DELETE FROM core.scheduler_locks
            WHERE lock_name = p_lock_name AND locked_by = p_worker_id;
        END;
        $$;

        REVOKE EXECUTE ON FUNCTION core.try_acquire_scheduler_lock(text, text, integer)
            FROM PUBLIC, anon, authenticated;
        REVOKE EXECUTE ON FUNCTION core.release_scheduler_lock(text, text)
            FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION core.try_acquire_scheduler_lock(text, text, integer)
            TO service_role;
        GRANT EXECUTE ON FUNCTION core.release_scheduler_lock(text, text)
            TO service_role;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS core.try_acquire_scheduler_lock(text, text, integer);
        DROP FUNCTION IF EXISTS core.release_scheduler_lock(text, text);
        DROP TABLE IF EXISTS core.scheduler_locks;
        """
    )
