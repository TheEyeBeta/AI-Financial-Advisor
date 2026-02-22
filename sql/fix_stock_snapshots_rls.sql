-- Fix RLS policy for stock_snapshots to allow both authenticated and anonymous users
-- Run this in Supabase SQL Editor

-- Drop existing policy
DROP POLICY IF EXISTS "Authenticated users can view stock snapshots" ON public.stock_snapshots;
DROP POLICY IF EXISTS "Anyone can view stock snapshots" ON public.stock_snapshots;

-- Create new policy that allows both authenticated and anonymous users
CREATE POLICY "Anyone can view stock snapshots"
ON public.stock_snapshots FOR SELECT
TO authenticated, anon
USING (true);

-- Verify the policy was created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'stock_snapshots';
