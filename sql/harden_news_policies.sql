-- ============================================================
-- Harden news RLS policies for production
-- ============================================================
-- Run this after initial setup if you want production-safe access on market.news:
-- - Public read allowed
-- - Writes blocked for anon/authenticated users

ALTER TABLE market.news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open access to news" ON market.news;
DROP POLICY IF EXISTS "Anyone can view news" ON market.news;

CREATE POLICY "Anyone can view news"
ON market.news FOR SELECT
TO authenticated, anon
USING (true);

SELECT 'market.news policies hardened for production' AS status;
