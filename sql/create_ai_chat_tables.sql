-- Create ai.chats and ai.chat_messages tables.
--
-- Run this in the Supabase SQL Editor if the chat feature returns 404 errors.
-- This script is idempotent — safe to run multiple times.
--
-- Prerequisites (already handled in schema.sql / expose_ai_schema_to_postgrest.sql):
--   • The "ai" schema must exist
--   • The "ai" schema must be listed in Project Settings → API → Exposed schemas
--   • The core.users table must exist (created by schema.sql)

-- 1. Ensure the ai schema exists
CREATE SCHEMA IF NOT EXISTS ai;

-- 2. Create ai.chats
CREATE TABLE IF NOT EXISTS ai.chats (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create ai.chat_messages
CREATE TABLE IF NOT EXISTS ai.chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    chat_id    UUID REFERENCES ai.chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Enable Row Level Security
ALTER TABLE ai.chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.chat_messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies for ai.chats
DROP POLICY IF EXISTS "Users can view own chats"   ON ai.chats;
DROP POLICY IF EXISTS "Users can create own chats" ON ai.chats;
DROP POLICY IF EXISTS "Users can update own chats" ON ai.chats;
DROP POLICY IF EXISTS "Users can delete own chats" ON ai.chats;

CREATE POLICY "Users can view own chats"
  ON ai.chats FOR SELECT
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can create own chats"
  ON ai.chats FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own chats"
  ON ai.chats FOR UPDATE
  USING      (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chats"
  ON ai.chats FOR DELETE
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- 6. RLS policies for ai.chat_messages
DROP POLICY IF EXISTS "Users can view own chat messages"   ON ai.chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat messages" ON ai.chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat messages" ON ai.chat_messages;

CREATE POLICY "Users can view own chat messages"
  ON ai.chat_messages FOR SELECT
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own chat messages"
  ON ai.chat_messages FOR INSERT
  WITH CHECK (
    user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid())
    AND (
      chat_id IS NULL
      OR EXISTS (
        SELECT 1 FROM ai.chats
        WHERE ai.chats.id = chat_id
          AND ai.chats.user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete own chat messages"
  ON ai.chat_messages FOR DELETE
  USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- 7. Grant permissions
GRANT USAGE ON SCHEMA ai TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chats         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_messages TO authenticated;

GRANT SELECT ON ai.chats         TO service_role;
GRANT SELECT ON ai.chat_messages TO service_role;

-- 8. Set default privileges for any future tables added to the ai schema
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
