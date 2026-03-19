-- Expose the ai schema to Supabase PostgREST so that REST API calls using
-- the Accept-Profile: ai header resolve correctly instead of returning 404.
--
-- IMPORTANT: This SQL alone is not enough.  PostgREST only serves schemas
-- that are listed in its "db-schemas" / "Exposed schemas" configuration.
-- After running this script you MUST also add "ai" to the Exposed Schemas
-- list in the Supabase Dashboard:
--
--   Project Settings → API → Exposed schemas → add "ai"
--
-- Without that dashboard change every REST call to ai.* tables returns 404.

-- 1. Ensure the ai schema exists
CREATE SCHEMA IF NOT EXISTS ai;

-- 2. Grant connect / usage rights so PostgREST can introspect the schema
GRANT USAGE ON SCHEMA ai TO anon, authenticated, service_role;

-- 3. Grant DML on the two chat tables
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai.chats         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai.chat_messages TO authenticated;

-- Read-only for service_role (used by Edge Functions / backend)
GRANT SELECT ON TABLE ai.chats         TO service_role;
GRANT SELECT ON TABLE ai.chat_messages TO service_role;

-- 4. Ensure future tables in ai schema are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- 5. Verify the tables exist (safe no-op if they do)
CREATE TABLE IF NOT EXISTS ai.chats (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    title      TEXT DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai.chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    chat_id    UUID REFERENCES ai.chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
