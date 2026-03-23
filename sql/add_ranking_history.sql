-- Ranking History table for tracking stock ranking stability over time.
-- This table persists computed ranking snapshots so the frontend can show
-- how long a stock has held its current tier (rank stability indicator)
-- and supports EMA score smoothing across refresh cycles.
--
-- Run this in the Supabase SQL editor against the runtime market schema.

-- ── Create the table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.stock_ranking_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker        VARCHAR NOT NULL,
    horizon       VARCHAR NOT NULL CHECK (horizon IN ('short', 'balanced', 'long')),
    composite_score   DECIMAL(5, 1) NOT NULL,
    smoothed_score    DECIMAL(5, 1) NOT NULL,
    rank_tier         VARCHAR NOT NULL,
    conviction        VARCHAR NOT NULL,
    dimension_scores  JSONB NOT NULL DEFAULT '{}',
    scored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for the primary query: "latest score per ticker+horizon"
CREATE INDEX IF NOT EXISTS idx_ranking_history_ticker_horizon_scored
    ON market.stock_ranking_history (ticker, horizon, scored_at DESC);

-- Cleanup index: for pruning old rows (keep ~7 days = ~1008 rows per ticker at 10-min intervals)
CREATE INDEX IF NOT EXISTS idx_ranking_history_scored_at
    ON market.stock_ranking_history (scored_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE market.stock_ranking_history ENABLE ROW LEVEL SECURITY;

-- Public read: ranking history is market data, readable by anyone (same as stock_snapshots)
DROP POLICY IF EXISTS "Anyone can view ranking history" ON market.stock_ranking_history;
CREATE POLICY "Anyone can view ranking history"
ON market.stock_ranking_history FOR SELECT
TO authenticated, anon
USING (true);

-- No INSERT/UPDATE/DELETE policies = only service role can write (backend writes via service key)

-- ── GRANTs ───────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA market TO authenticated, anon;
GRANT SELECT ON market.stock_ranking_history TO authenticated, anon;
