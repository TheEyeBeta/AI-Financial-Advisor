-- Fix 404 errors on ai.chats / ai.chat_messages when:
--   • The "ai" schema IS listed in Project Settings → API → Exposed schemas
--   • The ai.chats and ai.chat_messages tables DO exist in the database
--
-- Root cause: PostgREST returns 404 (not 403) when the `authenticated` role
-- is missing GRANT USAGE on the schema or GRANT SELECT/INSERT/UPDATE/DELETE
-- on the tables, because the role literally cannot see those tables.
--
-- Safe to rerun — GRANTs are idempotent.

-- 1. Allow the authenticated role to look up objects in the ai schema
GRANT USAGE ON SCHEMA ai TO authenticated;

-- 2. Grant full DML on the two chat tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chats         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_messages TO authenticated;

-- 3. Allow service_role (Edge Functions / backend workers) to read
GRANT USAGE ON SCHEMA ai TO service_role;
GRANT SELECT ON ai.chats         TO service_role;
GRANT SELECT ON ai.chat_messages TO service_role;

-- 4. Ensure any future tables added to the ai schema are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
