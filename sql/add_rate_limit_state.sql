-- ============================================================
-- Rate Limit State Persistence
-- ============================================================
-- Stores rate limit counters in the database so they survive
-- container restarts. Without this, a Railway/Render deploy
-- resets all limits to zero, allowing unlimited AI API spend.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_state (
    identifier   TEXT        NOT NULL,   -- "user:<uuid>" or "ip:<addr>"
    endpoint     TEXT        NOT NULL,   -- "/api/chat", "/api/search", etc.
    window_type  TEXT        NOT NULL,   -- "minute", "hour", "day"
    request_count INTEGER   NOT NULL DEFAULT 0,
    token_count   INTEGER   NOT NULL DEFAULT 0,
    window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
    blocked_until TIMESTAMPTZ,           -- NULL = not blocked
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (identifier, endpoint, window_type)
);

-- Index for cleanup of expired windows
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_window_start
    ON public.rate_limit_state (window_start);

-- Index for blocked lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_blocked
    ON public.rate_limit_state (blocked_until)
    WHERE blocked_until IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_rate_limit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_limit_state_updated ON public.rate_limit_state;
CREATE TRIGGER rate_limit_state_updated
    BEFORE UPDATE ON public.rate_limit_state
    FOR EACH ROW
    EXECUTE FUNCTION update_rate_limit_timestamp();

-- RLS: Only service role can access this table (backend only)
ALTER TABLE public.rate_limit_state ENABLE ROW LEVEL SECURITY;

-- No user-facing policies — only service_role bypasses RLS
-- This prevents any client-side manipulation of rate limits
