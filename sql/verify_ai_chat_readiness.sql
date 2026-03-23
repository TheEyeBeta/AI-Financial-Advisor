-- Verify AI chat production readiness.
-- Run this in the Supabase SQL editor after migrations.
--
-- NOTE:
-- SQL can verify schema objects, grants, and RLS policies, but it cannot verify
-- the dashboard-level "Exposed schemas" setting. Confirm that `ai` is listed in:
--   Project Settings -> API -> Exposed schemas

WITH checks AS (
  SELECT
    'ai schema exists' AS check_name,
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai') AS ok,
    'Run sql/create_ai_chat_tables.sql if the ai schema is missing.' AS hint

  UNION ALL

  SELECT
    'ai.chats table exists',
    to_regclass('ai.chats') IS NOT NULL,
    'Run sql/create_ai_chat_tables.sql if ai.chats is missing.'

  UNION ALL

  SELECT
    'ai.chat_messages table exists',
    to_regclass('ai.chat_messages') IS NOT NULL,
    'Run sql/create_ai_chat_tables.sql if ai.chat_messages is missing.'

  UNION ALL

  SELECT
    'authenticated has USAGE on ai schema',
    has_schema_privilege('authenticated', 'ai', 'USAGE'),
    'Run sql/fix_ai_chat_grants.sql if authenticated lacks schema usage.'

  UNION ALL

  SELECT
    'authenticated has DML on ai.chats',
    has_table_privilege('authenticated', 'ai.chats', 'SELECT,INSERT,UPDATE,DELETE'),
    'Run sql/fix_ai_chat_grants.sql if authenticated lacks table privileges on ai.chats.'

  UNION ALL

  SELECT
    'authenticated has DML on ai.chat_messages',
    has_table_privilege('authenticated', 'ai.chat_messages', 'SELECT,INSERT,UPDATE,DELETE'),
    'Run sql/fix_ai_chat_grants.sql if authenticated lacks table privileges on ai.chat_messages.'

  UNION ALL

  SELECT
    'service_role has read access to ai.chats',
    has_table_privilege('service_role', 'ai.chats', 'SELECT'),
    'Run sql/fix_ai_chat_grants.sql if service_role cannot read ai.chats.'

  UNION ALL

  SELECT
    'service_role has read access to ai.chat_messages',
    has_table_privilege('service_role', 'ai.chat_messages', 'SELECT'),
    'Run sql/fix_ai_chat_grants.sql if service_role cannot read ai.chat_messages.'

  UNION ALL

  SELECT
    'RLS enabled on ai.chats',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ai'
        AND c.relname = 'chats'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if ai.chats does not have RLS enabled.'

  UNION ALL

  SELECT
    'RLS enabled on ai.chat_messages',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ai'
        AND c.relname = 'chat_messages'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if ai.chat_messages does not have RLS enabled.'

  UNION ALL

  SELECT
    'chat policies exist on ai.chats',
    (
      SELECT COUNT(*)
      FROM pg_policies
      WHERE schemaname = 'ai'
        AND tablename = 'chats'
        AND policyname IN (
          'Users can view own chats',
          'Users can create own chats',
          'Users can update own chats',
          'Users can delete own chats'
        )
    ) = 4,
    'Run sql/fix_rls_policies_schema.sql if ai.chats policies are incomplete.'

  UNION ALL

  SELECT
    'chat policies exist on ai.chat_messages',
    (
      SELECT COUNT(*)
      FROM pg_policies
      WHERE schemaname = 'ai'
        AND tablename = 'chat_messages'
        AND policyname IN (
          'Users can view own chat messages',
          'Users can insert own chat messages',
          'Users can delete own chat messages'
        )
    ) = 3,
    'Run sql/fix_rls_policies_schema.sql if ai.chat_messages policies are incomplete.'
)
SELECT
  check_name,
  CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status,
  hint
FROM checks
ORDER BY check_name;
