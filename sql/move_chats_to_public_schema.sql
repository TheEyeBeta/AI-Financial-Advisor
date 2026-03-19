-- Move ai.chats and ai.chat_messages to the public schema so they are
-- accessible via the Supabase REST API without requiring the "ai" schema
-- to be added to the PostgREST "Exposed Schemas" list in the dashboard.
--
-- The public schema is always exposed by Supabase PostgREST, so no
-- dashboard configuration change is needed after running this migration.
--
-- Safe to rerun: CREATE TABLE IF NOT EXISTS and ON CONFLICT DO NOTHING
-- guard against duplicate execution.

-- 1. Create tables in public schema (identical structure to ai.*)
CREATE TABLE IF NOT EXISTS public.chats (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    title      TEXT DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    chat_id    UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Migrate any existing data from ai schema
DO $$
BEGIN
  IF to_regclass('ai.chats') IS NOT NULL THEN
    INSERT INTO public.chats (id, user_id, title, created_at, updated_at)
    SELECT id, user_id, title, created_at, updated_at
    FROM ai.chats
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF to_regclass('ai.chat_messages') IS NOT NULL THEN
    INSERT INTO public.chat_messages (id, user_id, role, content, created_at, chat_id)
    SELECT id, user_id, role, content, created_at, chat_id
    FROM ai.chat_messages
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 3. Enable Row Level Security
ALTER TABLE public.chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for chats
DROP POLICY IF EXISTS "Users can view own chats"   ON public.chats;
DROP POLICY IF EXISTS "Users can create own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can update own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can delete own chats" ON public.chats;

CREATE POLICY "Users can view own chats"
  ON public.chats FOR SELECT
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can create own chats"
  ON public.chats FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own chats"
  ON public.chats FOR UPDATE
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chats"
  ON public.chats FOR DELETE
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- 5. RLS policies for chat_messages
DROP POLICY IF EXISTS "Users can view own messages"   ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.chat_messages;

CREATE POLICY "Users can view own messages"
  ON public.chat_messages FOR SELECT
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own messages"
  ON public.chat_messages FOR DELETE
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- 6. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT SELECT ON public.chats         TO service_role;
GRANT SELECT ON public.chat_messages TO service_role;
