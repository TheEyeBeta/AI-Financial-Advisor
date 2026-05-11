-- Job run log table — records every scheduled / manual job execution so the
-- admin panel can show real execution history rather than inferring "last run"
-- from side-effect DB records (which are absent when a job finds nothing to do).
--
-- Run this in the Supabase SQL editor against your project database.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS core.job_run_logs (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name            text        NOT NULL,
    started_at          timestamptz NOT NULL,
    finished_at         timestamptz,
    status              text        NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
    records_processed   integer,
    summary             text,
    error               text,
    created_at          timestamptz DEFAULT now()
);

-- Index for the primary admin query: latest N runs per job_name
CREATE INDEX IF NOT EXISTS idx_job_run_logs_job_name_started
    ON core.job_run_logs (job_name, started_at DESC);

-- Index for cleanup: prune rows older than 30 days
CREATE INDEX IF NOT EXISTS idx_job_run_logs_created_at
    ON core.job_run_logs (created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE core.job_run_logs ENABLE ROW LEVEL SECURITY;

-- Only the service role (backend) can read/write job logs.
-- The admin panel reads via the backend API (service-role key), not directly.
DROP POLICY IF EXISTS "Service role full access on job_run_logs" ON core.job_run_logs;
CREATE POLICY "Service role full access on job_run_logs"
ON core.job_run_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ── GRANTs ───────────────────────────────────────────────────────────────────

-- No grants to authenticated / anon — access is proxied through the backend API.
