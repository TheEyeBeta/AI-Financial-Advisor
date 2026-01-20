-- Fix RLS policies for trading-related tables
-- These tables need to allow users to see their own data using public.users.id (not auth.uid)
-- Run this in Supabase SQL Editor

-- Portfolio History RLS
DROP POLICY IF EXISTS "Users can view own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can insert own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can update own portfolio history" ON public.portfolio_history;

CREATE POLICY "Users can view own portfolio history"
ON public.portfolio_history FOR SELECT
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can insert own portfolio history"
ON public.portfolio_history FOR INSERT
WITH CHECK (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can update own portfolio history"
ON public.portfolio_history FOR UPDATE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Open Positions RLS
DROP POLICY IF EXISTS "Users can view own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON public.open_positions;

CREATE POLICY "Users can view own positions"
ON public.open_positions FOR SELECT
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can insert own positions"
ON public.open_positions FOR INSERT
WITH CHECK (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can update own positions"
ON public.open_positions FOR UPDATE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can delete own positions"
ON public.open_positions FOR DELETE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Trades RLS
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;

CREATE POLICY "Users can view own trades"
ON public.trades FOR SELECT
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can insert own trades"
ON public.trades FOR INSERT
WITH CHECK (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can update own trades"
ON public.trades FOR UPDATE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Trade Journal RLS
DROP POLICY IF EXISTS "Users can view own journal" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can update own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can delete own journal entries" ON public.trade_journal;

CREATE POLICY "Users can view own journal"
ON public.trade_journal FOR SELECT
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can insert own journal entries"
ON public.trade_journal FOR INSERT
WITH CHECK (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can update own journal entries"
ON public.trade_journal FOR UPDATE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can delete own journal entries"
ON public.trade_journal FOR DELETE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Verify policies
SELECT 'Portfolio History' as table_name, policyname FROM pg_policies WHERE tablename = 'portfolio_history'
UNION ALL
SELECT 'Open Positions', policyname FROM pg_policies WHERE tablename = 'open_positions'
UNION ALL
SELECT 'Trades', policyname FROM pg_policies WHERE tablename = 'trades'
UNION ALL
SELECT 'Trade Journal', policyname FROM pg_policies WHERE tablename = 'trade_journal';
