-- ============================================================
-- Fix RLS Policies for learning_topics to support upsert
-- ============================================================
-- Run this in Supabase SQL Editor to fix the 403 Forbidden error
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;

-- Recreate policies with proper WITH CHECK clauses for upsert support
CREATE POLICY "Users can view own learning topics"
ON public.learning_topics FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own learning topics"
ON public.learning_topics FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own learning topics"
ON public.learning_topics FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Optional: Add DELETE policy if needed
DROP POLICY IF EXISTS "Users can delete own learning topics" ON public.learning_topics;
CREATE POLICY "Users can delete own learning topics"
ON public.learning_topics FOR DELETE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Verify policies
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'learning_topics'
ORDER BY policyname;

SELECT '✅ RLS policies updated for learning_topics!' as status;
