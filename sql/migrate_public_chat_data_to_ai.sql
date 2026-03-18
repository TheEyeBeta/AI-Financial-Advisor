-- Migrate legacy chat data from public.* into ai.* before the app starts.
-- Safe to rerun: existing ids are ignored via ON CONFLICT DO NOTHING.

DO $$
BEGIN
  IF to_regclass('public.chats') IS NOT NULL THEN
    INSERT INTO ai.chats (id, user_id, title, created_at, updated_at)
    SELECT id, user_id, title, created_at, updated_at
    FROM public.chats
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF to_regclass('public.chat_messages') IS NOT NULL THEN
    INSERT INTO ai.chat_messages (id, user_id, role, content, created_at, chat_id)
    SELECT id, user_id, role, content, created_at, chat_id
    FROM public.chat_messages
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
