"""Add a renew RPC for scheduler locks (0044) so long cycles keep their lease.

Architecture audit review of #293/0044 found that the lock never renews:
`DEFAULT_LEASE_SECONDS = 900` (15 minutes) with no heartbeat/extension
mechanism. The intelligence and ranking cycles have no bounded
user/work-item count, so a cycle that runs longer than 15 minutes lets
another replica acquire the now-expired row and start the same cycle while
the original is still working — recreating the duplicate writes and
provider spend 0044 was introduced to prevent.

`core.renew_scheduler_lock` extends `expires_at` for the caller's own lease
only (the `WHERE locked_by = p_worker_id` guard means a lease some other
replica already took over after expiry is left untouched — renewal must
never resurrect a lock this worker no longer legitimately holds).
"""
from __future__ import annotations

from alembic import op

revision = "0045_scheduler_lock_renew"
down_revision = "0044_scheduler_locks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.renew_scheduler_lock(
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
            v_renewed BOOLEAN;
        BEGIN
            UPDATE core.scheduler_locks
                SET expires_at = NOW() + make_interval(secs => p_lease_seconds)
            WHERE lock_name = p_lock_name
              AND locked_by = p_worker_id
              AND expires_at >= NOW()
            RETURNING TRUE INTO v_renewed;

            RETURN COALESCE(v_renewed, FALSE);
        END;
        $$;

        REVOKE EXECUTE ON FUNCTION core.renew_scheduler_lock(text, text, integer)
            FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION core.renew_scheduler_lock(text, text, integer)
            TO service_role;
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION IF EXISTS core.renew_scheduler_lock(text, text, integer);"
    )
