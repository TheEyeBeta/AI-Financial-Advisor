-- Add indicator-based sub-score columns to market.trending_stocks.
-- These columns store the five sub-scores produced by the new composite
-- ranking formula derived entirely from the stock_snapshots indicators table.
--
-- Run once in the Supabase SQL editor against the runtime market schema.

ALTER TABLE market.trending_stocks
ADD COLUMN IF NOT EXISTS trend_score  NUMERIC;

ALTER TABLE market.trending_stocks
ADD COLUMN IF NOT EXISTS volume_score NUMERIC;

ALTER TABLE market.trending_stocks
ADD COLUMN IF NOT EXISTS range_score  NUMERIC;

ALTER TABLE market.trending_stocks
ADD COLUMN IF NOT EXISTS adx_score    NUMERIC;
