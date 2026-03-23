-- Verify runtime schema readiness for production deployments.
-- Run this in the Supabase SQL editor after applying migrations.
--
-- This script validates the schema layout the app currently uses at runtime:
--   core, ai, trading, market, academy
--
-- NOTE:
-- SQL can verify database objects, RLS, and grants, but it cannot verify the
-- dashboard-level "Exposed schemas" setting in Supabase API settings. Confirm
-- that the schemas above are exposed when PostgREST/browser access is required.

WITH checks AS (
  SELECT
    'schema core exists' AS check_name,
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core') AS ok,
    'Create the core schema before deploying.' AS hint

  UNION ALL

  SELECT
    'schema ai exists',
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai'),
    'Run sql/create_ai_chat_tables.sql if the ai schema is missing.'

  UNION ALL

  SELECT
    'schema trading exists',
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'trading'),
    'Apply the trading schema migration before deploying.'

  UNION ALL

  SELECT
    'schema market exists',
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'market'),
    'Apply the market schema migration before deploying.'

  UNION ALL

  SELECT
    'schema academy exists',
    EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'academy'),
    'Apply curriculum/academy migrations before deploying.'

  UNION ALL

  SELECT
    'table core.users exists',
    to_regclass('core.users') IS NOT NULL,
    'The authenticated user/profile table is missing.'

  UNION ALL

  SELECT
    'table core.achievements exists',
    to_regclass('core.achievements') IS NOT NULL,
    'The achievements table used by the dashboard is missing.'

  UNION ALL

  SELECT
    'table ai.chats exists',
    to_regclass('ai.chats') IS NOT NULL,
    'Run sql/create_ai_chat_tables.sql if ai.chats is missing.'

  UNION ALL

  SELECT
    'table ai.chat_messages exists',
    to_regclass('ai.chat_messages') IS NOT NULL,
    'Run sql/create_ai_chat_tables.sql if ai.chat_messages is missing.'

  UNION ALL

  SELECT
    'table trading.portfolio_history exists',
    to_regclass('trading.portfolio_history') IS NOT NULL,
    'The trading.portfolio_history table is missing.'

  UNION ALL

  SELECT
    'table trading.open_positions exists',
    to_regclass('trading.open_positions') IS NOT NULL,
    'The trading.open_positions table is missing.'

  UNION ALL

  SELECT
    'table trading.trades exists',
    to_regclass('trading.trades') IS NOT NULL,
    'The trading.trades table is missing.'

  UNION ALL

  SELECT
    'table trading.trade_journal exists',
    to_regclass('trading.trade_journal') IS NOT NULL,
    'The trading.trade_journal table is missing.'

  UNION ALL

  SELECT
    'table market.news exists',
    to_regclass('market.news') IS NOT NULL,
    'The canonical market.news table is missing.'

  UNION ALL

  SELECT
    'table market.stock_snapshots exists',
    to_regclass('market.stock_snapshots') IS NOT NULL,
    'The market.stock_snapshots table is missing.'

  UNION ALL

  SELECT
    'table market.market_indices exists',
    to_regclass('market.market_indices') IS NOT NULL,
    'The market.market_indices table is missing.'

  UNION ALL

  SELECT
    'table market.trending_stocks exists',
    to_regclass('market.trending_stocks') IS NOT NULL,
    'The market.trending_stocks table is missing.'

  UNION ALL

  SELECT
    'table academy.lessons exists',
    to_regclass('academy.lessons') IS NOT NULL,
    'The academy.lessons table is missing.'

  UNION ALL

  SELECT
    'table academy.user_lesson_progress exists',
    to_regclass('academy.user_lesson_progress') IS NOT NULL,
    'The academy.user_lesson_progress table is missing.'

  UNION ALL

  SELECT
    'table market.stock_ranking_history exists',
    to_regclass('market.stock_ranking_history') IS NOT NULL,
    'Run sql/add_ranking_history.sql to create the ranking history table.'

  UNION ALL

  SELECT
    'authenticated has read access on market.stock_ranking_history',
    has_table_privilege('authenticated', 'market.stock_ranking_history', 'SELECT'),
    'Grant SELECT on market.stock_ranking_history to authenticated.'

  UNION ALL

  SELECT
    'RLS enabled on market.stock_ranking_history',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'market'
        AND c.relname = 'stock_ranking_history'
        AND c.relrowsecurity
    ),
    'Enable RLS on market.stock_ranking_history.'

  UNION ALL

  SELECT
    'at least one policy exists on market.stock_ranking_history',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'market' AND tablename = 'stock_ranking_history'),
    'Create RLS policies for market.stock_ranking_history.'

  UNION ALL

  SELECT
    'authenticated has USAGE on ai',
    has_schema_privilege('authenticated', 'ai', 'USAGE'),
    'Grant authenticated USAGE on schema ai.'

  UNION ALL

  SELECT
    'authenticated has USAGE on trading',
    has_schema_privilege('authenticated', 'trading', 'USAGE'),
    'Grant authenticated USAGE on schema trading.'

  UNION ALL

  SELECT
    'authenticated has USAGE on market',
    has_schema_privilege('authenticated', 'market', 'USAGE'),
    'Grant authenticated USAGE on schema market.'

  UNION ALL

  SELECT
    'authenticated has USAGE on academy',
    has_schema_privilege('authenticated', 'academy', 'USAGE'),
    'Grant authenticated USAGE on schema academy.'

  UNION ALL

  SELECT
    'authenticated has SELECT/UPDATE on core.users',
    has_table_privilege('authenticated', 'core.users', 'SELECT,UPDATE'),
    'Grant SELECT and UPDATE on core.users to authenticated.'

  UNION ALL

  SELECT
    'authenticated has SELECT/INSERT on core.achievements',
    has_table_privilege('authenticated', 'core.achievements', 'SELECT,INSERT'),
    'Grant SELECT and INSERT on core.achievements to authenticated.'

  UNION ALL

  SELECT
    'authenticated has DML on ai.chats',
    has_table_privilege('authenticated', 'ai.chats', 'SELECT,INSERT,UPDATE,DELETE'),
    'Run sql/fix_ai_chat_grants.sql if ai.chats privileges are missing.'

  UNION ALL

  SELECT
    'authenticated has DML on ai.chat_messages',
    has_table_privilege('authenticated', 'ai.chat_messages', 'SELECT,INSERT,UPDATE,DELETE'),
    'Run sql/fix_ai_chat_grants.sql if ai.chat_messages privileges are missing.'

  UNION ALL

  SELECT
    'authenticated has DML on trading.portfolio_history',
    has_table_privilege('authenticated', 'trading.portfolio_history', 'SELECT,INSERT,UPDATE,DELETE'),
    'Grant DML on trading.portfolio_history to authenticated.'

  UNION ALL

  SELECT
    'authenticated has DML on trading.open_positions',
    has_table_privilege('authenticated', 'trading.open_positions', 'SELECT,INSERT,UPDATE,DELETE'),
    'Grant DML on trading.open_positions to authenticated.'

  UNION ALL

  SELECT
    'authenticated has DML on trading.trades',
    has_table_privilege('authenticated', 'trading.trades', 'SELECT,INSERT,UPDATE,DELETE'),
    'Grant DML on trading.trades to authenticated.'

  UNION ALL

  SELECT
    'authenticated has DML on trading.trade_journal',
    has_table_privilege('authenticated', 'trading.trade_journal', 'SELECT,INSERT,UPDATE,DELETE'),
    'Grant DML on trading.trade_journal to authenticated.'

  UNION ALL

  SELECT
    'authenticated has read access on market.news',
    has_table_privilege('authenticated', 'market.news', 'SELECT'),
    'Grant SELECT on market.news to authenticated.'

  UNION ALL

  SELECT
    'authenticated has read access on market.stock_snapshots',
    has_table_privilege('authenticated', 'market.stock_snapshots', 'SELECT'),
    'Grant SELECT on market.stock_snapshots to authenticated.'

  UNION ALL

  SELECT
    'authenticated has read access on market.market_indices',
    has_table_privilege('authenticated', 'market.market_indices', 'SELECT'),
    'Grant SELECT on market.market_indices to authenticated.'

  UNION ALL

  SELECT
    'authenticated has read access on market.trending_stocks',
    has_table_privilege('authenticated', 'market.trending_stocks', 'SELECT'),
    'Grant SELECT on market.trending_stocks to authenticated.'

  UNION ALL

  SELECT
    'authenticated has read access on academy.lessons',
    has_table_privilege('authenticated', 'academy.lessons', 'SELECT'),
    'Grant SELECT on academy.lessons to authenticated.'

  UNION ALL

  SELECT
    'authenticated has SELECT/INSERT/UPDATE on academy.user_lesson_progress',
    has_table_privilege('authenticated', 'academy.user_lesson_progress', 'SELECT,INSERT,UPDATE'),
    'Grant SELECT, INSERT, and UPDATE on academy.user_lesson_progress to authenticated.'

  UNION ALL

  SELECT
    'RLS enabled on core.users',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = 'users'
        AND c.relrowsecurity
    ),
    'Enable RLS on core.users.'

  UNION ALL

  SELECT
    'RLS enabled on core.achievements',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = 'achievements'
        AND c.relrowsecurity
    ),
    'Enable RLS on core.achievements.'

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
    'Run sql/fix_rls_policies_schema.sql if ai.chats does not have RLS.'

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
    'Run sql/fix_rls_policies_schema.sql if ai.chat_messages does not have RLS.'

  UNION ALL

  SELECT
    'RLS enabled on trading.portfolio_history',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'trading'
        AND c.relname = 'portfolio_history'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if trading.portfolio_history does not have RLS.'

  UNION ALL

  SELECT
    'RLS enabled on trading.open_positions',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'trading'
        AND c.relname = 'open_positions'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if trading.open_positions does not have RLS.'

  UNION ALL

  SELECT
    'RLS enabled on trading.trades',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'trading'
        AND c.relname = 'trades'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if trading.trades does not have RLS.'

  UNION ALL

  SELECT
    'RLS enabled on trading.trade_journal',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'trading'
        AND c.relname = 'trade_journal'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if trading.trade_journal does not have RLS.'

  UNION ALL

  SELECT
    'RLS enabled on market.news',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'market'
        AND c.relname = 'news'
        AND c.relrowsecurity
    ),
    'Enable RLS on market.news.'

  UNION ALL

  SELECT
    'RLS enabled on market.stock_snapshots',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'market'
        AND c.relname = 'stock_snapshots'
        AND c.relrowsecurity
    ),
    'Enable RLS on market.stock_snapshots.'

  UNION ALL

  SELECT
    'RLS enabled on academy.user_lesson_progress',
    EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'academy'
        AND c.relname = 'user_lesson_progress'
        AND c.relrowsecurity
    ),
    'Run sql/fix_rls_policies_schema.sql if academy.user_lesson_progress does not have RLS.'

  UNION ALL

  SELECT
    'at least one policy exists on core.users',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'core' AND tablename = 'users'),
    'Create RLS policies for core.users.'

  UNION ALL

  SELECT
    'at least one policy exists on core.achievements',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'core' AND tablename = 'achievements'),
    'Create RLS policies for core.achievements.'

  UNION ALL

  SELECT
    'at least one policy exists on ai.chats',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'chats'),
    'Create RLS policies for ai.chats.'

  UNION ALL

  SELECT
    'at least one policy exists on ai.chat_messages',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'chat_messages'),
    'Create RLS policies for ai.chat_messages.'

  UNION ALL

  SELECT
    'at least one policy exists on trading.portfolio_history',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'trading' AND tablename = 'portfolio_history'),
    'Create RLS policies for trading.portfolio_history.'

  UNION ALL

  SELECT
    'at least one policy exists on trading.open_positions',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'trading' AND tablename = 'open_positions'),
    'Create RLS policies for trading.open_positions.'

  UNION ALL

  SELECT
    'at least one policy exists on trading.trades',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'trading' AND tablename = 'trades'),
    'Create RLS policies for trading.trades.'

  UNION ALL

  SELECT
    'at least one policy exists on trading.trade_journal',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'trading' AND tablename = 'trade_journal'),
    'Create RLS policies for trading.trade_journal.'

  UNION ALL

  SELECT
    'at least one policy exists on market.news',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'market' AND tablename = 'news'),
    'Create RLS policies for market.news.'

  UNION ALL

  SELECT
    'at least one policy exists on market.stock_snapshots',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'market' AND tablename = 'stock_snapshots'),
    'Create RLS policies for market.stock_snapshots.'

  UNION ALL

  SELECT
    'at least one policy exists on academy.user_lesson_progress',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'academy' AND tablename = 'user_lesson_progress'),
    'Create RLS policies for academy.user_lesson_progress.'
)
SELECT
  check_name,
  ok,
  CASE WHEN ok THEN 'OK' ELSE hint END AS detail
FROM checks
ORDER BY check_name;
