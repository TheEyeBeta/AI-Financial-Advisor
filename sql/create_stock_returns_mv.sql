-- market.stock_returns_mv
-- Pre-computes multi-horizon price returns for every ticker in
-- market.stock_price_history.  Consumed by the ranking engine
-- (services/ranking_engine.py) to avoid per-ticker return
-- computation inside the scoring loop.
--
-- Returns are expressed as decimals (0.12 = +12%).
-- NULL means insufficient history for that horizon:
--   return_1m  NULL → fewer than 22 valid price rows  (< 21 trading days)
--   return_3m  NULL → fewer than 64 valid price rows  (< 63 trading days)
--   return_6m  NULL → fewer than 127 valid price rows (< 126 trading days)
--   return_12m NULL → fewer than 253 valid price rows (< 252 trading days)
--
-- Refresh: run REFRESH MATERIALIZED VIEW CONCURRENTLY market.stock_returns_mv
-- once daily after stock_price_history is updated (before the 01:00 UTC
-- ranking cycle).

-- ── Create the view ───────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS market.stock_returns_mv AS
WITH ranked AS (
    SELECT
        ticker,
        close,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn,
        COUNT(*)     OVER (PARTITION BY ticker)                    AS total_trading_days
    FROM market.stock_price_history
    WHERE close IS NOT NULL
      AND close > 0
),
latest  AS (SELECT ticker, close AS c0, total_trading_days FROM ranked WHERE rn = 1),
ago_1m  AS (SELECT ticker, close AS c1m  FROM ranked WHERE rn = 22),   -- 21 trading days ago
ago_3m  AS (SELECT ticker, close AS c3m  FROM ranked WHERE rn = 64),   -- 63 trading days ago
ago_6m  AS (SELECT ticker, close AS c6m  FROM ranked WHERE rn = 127),  -- 126 trading days ago
ago_12m AS (SELECT ticker, close AS c12m FROM ranked WHERE rn = 253)   -- 252 trading days ago
SELECT
    l.ticker,
    l.total_trading_days,
    (l.total_trading_days >= 22)  AS has_1m_history,
    (l.total_trading_days >= 64)  AS has_3m_history,
    (l.total_trading_days >= 127) AS has_6m_history,
    (l.total_trading_days >= 253) AS has_12m_history,
    CASE WHEN a1.c1m   > 0 THEN (l.c0 - a1.c1m)   / a1.c1m   END AS return_1m,
    CASE WHEN a3.c3m   > 0 THEN (l.c0 - a3.c3m)   / a3.c3m   END AS return_3m,
    CASE WHEN a6.c6m   > 0 THEN (l.c0 - a6.c6m)   / a6.c6m   END AS return_6m,
    CASE WHEN a12.c12m > 0 THEN (l.c0 - a12.c12m) / a12.c12m END AS return_12m
FROM      latest  l
LEFT JOIN ago_1m  a1  USING (ticker)
LEFT JOIN ago_3m  a3  USING (ticker)
LEFT JOIN ago_6m  a6  USING (ticker)
LEFT JOIN ago_12m a12 USING (ticker);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS stock_returns_mv_ticker_idx
    ON market.stock_returns_mv (ticker);

-- ── Access ────────────────────────────────────────────────────────────────────

GRANT USAGE  ON SCHEMA market TO authenticated, anon;
GRANT SELECT ON market.stock_returns_mv TO authenticated, anon;
