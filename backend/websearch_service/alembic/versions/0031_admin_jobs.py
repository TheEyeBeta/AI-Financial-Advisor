"""Durable admin job queue for idempotent background work."""

from alembic import op

revision = "0031_admin_jobs"
down_revision = "0030_chat_turn_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.admin_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            idempotency_key TEXT NOT NULL,
            actor_id TEXT,
            parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
            progress JSONB,
            result_summary JSONB,
            error_code TEXT,
            error_detail TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3,
            lease_owner TEXT,
            lease_expires_at TIMESTAMPTZ,
            heartbeat_at TIMESTAMPTZ,
            correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            CONSTRAINT admin_jobs_status_check
                CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
        );

        CREATE INDEX IF NOT EXISTS idx_admin_jobs_status_created
            ON core.admin_jobs(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_admin_jobs_type_status
            ON core.admin_jobs(job_type, status);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_jobs_active_idempotency
            ON core.admin_jobs(idempotency_key)
            WHERE status IN ('queued', 'running');

        ALTER TABLE core.admin_jobs ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Service role manages admin jobs" ON core.admin_jobs;
        CREATE POLICY "Service role manages admin jobs"
            ON core.admin_jobs
            FOR ALL
            TO service_role
            USING (TRUE)
            WITH CHECK (TRUE);

        GRANT ALL ON core.admin_jobs TO service_role;

        CREATE OR REPLACE FUNCTION core.claim_admin_job(
            p_worker_id TEXT,
            p_lease_seconds INTEGER DEFAULT 300
        )
        RETURNS SETOF core.admin_jobs
        LANGUAGE plpgsql
        AS $$
        DECLARE
            claimed core.admin_jobs%ROWTYPE;
        BEGIN
            UPDATE core.admin_jobs
            SET status = 'running',
                lease_owner = p_worker_id,
                lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
                heartbeat_at = NOW(),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
            WHERE id = (
                SELECT id
                FROM core.admin_jobs
                WHERE status = 'queued'
                   OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING * INTO claimed;

            IF claimed.id IS NULL THEN
                RETURN;
            END IF;

            RETURN NEXT claimed;
        END;
        $$;

        GRANT EXECUTE ON FUNCTION core.claim_admin_job(TEXT, INTEGER) TO service_role;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.admin_jobs;
        """
    )
