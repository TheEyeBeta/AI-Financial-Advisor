-- ============================================================
-- Harden news RLS policies for production
-- ============================================================
-- Run this after initial setup if you want production-safe access:
-- - Public read allowed
-- - Writes blocked for anon/authenticated users

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open access to news" ON public.news;
DROP POLICY IF EXISTS "Anyone can view news" ON public.news;

CREATE POLICY "Anyone can view news"
ON public.news FOR SELECT
TO authenticated, anon
USING (true);

SELECT '✅ public.news policies hardened for production' AS status;
