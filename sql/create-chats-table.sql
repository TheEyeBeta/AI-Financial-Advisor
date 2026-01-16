-- Create chats table and restructure chat_messages
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new

-- Step 1: Create the chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NULL DEFAULT 'New Chat',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT chats_pkey PRIMARY KEY (id),
  CONSTRAINT chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON public.chats(updated_at DESC);

-- Step 2: Add chat_id column to chat_messages (if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'chat_messages' 
    AND column_name = 'chat_id'
  ) THEN
    ALTER TABLE public.chat_messages ADD COLUMN chat_id uuid NULL;
  END IF;
END $$;

-- Step 3: Create foreign key constraint (if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'chat_messages_chat_id_fkey'
  ) THEN
    ALTER TABLE public.chat_messages 
    ADD CONSTRAINT chat_messages_chat_id_fkey 
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create index for chat_id lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON public.chat_messages(chat_id);

-- Step 4: Enable RLS on chats table
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies for chats
DROP POLICY IF EXISTS "Users can view own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can create own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can update own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can delete own chats" ON public.chats;

CREATE POLICY "Users can view own chats"
ON public.chats FOR SELECT
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can create own chats"
ON public.chats FOR INSERT
WITH CHECK (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can update own chats"
ON public.chats FOR UPDATE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE POLICY "Users can delete own chats"
ON public.chats FOR DELETE
USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Step 6: Migrate existing messages to a default chat (optional - run if you have existing data)
-- This creates a single "Previous Conversations" chat for existing messages
DO $$
DECLARE
  v_user_id uuid;
  v_chat_id uuid;
BEGIN
  -- Loop through users who have messages without chat_id
  FOR v_user_id IN 
    SELECT DISTINCT user_id FROM public.chat_messages WHERE chat_id IS NULL
  LOOP
    -- Create a chat for their existing messages
    INSERT INTO public.chats (user_id, title, created_at)
    VALUES (v_user_id, 'Previous Conversations', NOW())
    RETURNING id INTO v_chat_id;
    
    -- Link existing messages to this chat
    UPDATE public.chat_messages 
    SET chat_id = v_chat_id 
    WHERE user_id = v_user_id AND chat_id IS NULL;
  END LOOP;
END $$;

-- Verify the setup
SELECT 'Chats table created successfully' as status;
SELECT COUNT(*) as total_chats FROM public.chats;
SELECT COUNT(*) as messages_with_chat_id FROM public.chat_messages WHERE chat_id IS NOT NULL;
SELECT COUNT(*) as messages_without_chat_id FROM public.chat_messages WHERE chat_id IS NULL;
