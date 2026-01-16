-- Fix RLS policies for chat_messages table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new

-- First, let's see what policies exist (optional, for debugging)
-- SELECT * FROM pg_policies WHERE tablename = 'chat_messages';

-- Enable RLS if not already enabled
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (to recreate cleanly)
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_messages;

-- Policy 1: Users can SELECT their own messages
CREATE POLICY "Users can view own chat messages"
ON public.chat_messages
FOR SELECT
USING (
  user_id IN (
    SELECT id FROM public.users WHERE auth_id = auth.uid()
  )
);

-- Policy 2: Users can INSERT their own messages
CREATE POLICY "Users can insert own chat messages"
ON public.chat_messages
FOR INSERT
WITH CHECK (
  user_id IN (
    SELECT id FROM public.users WHERE auth_id = auth.uid()
  )
);

-- Policy 3: Users can DELETE their own messages (optional, for clearing chat history)
CREATE POLICY "Users can delete own chat messages"
ON public.chat_messages
FOR DELETE
USING (
  user_id IN (
    SELECT id FROM public.users WHERE auth_id = auth.uid()
  )
);

-- Verify policies were created
SELECT schemaname, tablename, policyname, cmd 
FROM pg_policies 
WHERE tablename = 'chat_messages';
