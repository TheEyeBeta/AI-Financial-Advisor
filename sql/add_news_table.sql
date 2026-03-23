-- ============================================================
-- Add Canonical market.news Table
-- ============================================================
-- Run this in Supabase SQL Editor to add a dedicated news table in the
-- runtime market schema used by the app.
-- This script is safe to run multiple times.
-- This setup keeps access open for fast iteration.
-- Before production, run sql/harden_news_policies.sql.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE IF NOT EXISTS market.news (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL UNIQUE,
    provider TEXT,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published_at ON market.news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON market.news(created_at DESC);

ALTER TABLE market.news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view news" ON market.news;
DROP POLICY IF EXISTS "Open access to news" ON market.news;
CREATE POLICY "Open access to news"
ON market.news FOR ALL
TO authenticated, anon
USING (true)
WITH CHECK (true);

-- If market.news_articles exists, copy data into market.news.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'market'
      AND table_name = 'news_articles'
  ) THEN
    INSERT INTO market.news (title, summary, link, provider, published_at, created_at, updated_at)
    SELECT
      na.title,
      na.summary,
      na.link,
      na.source,
      na.published_at,
      na.created_at,
      na.updated_at
    FROM market.news_articles na
    ON CONFLICT (link) DO NOTHING;
  END IF;
END $$;

-- Optional: keep updated_at in sync if helper trigger function already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'core'
      AND p.proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_news_updated_at ON market.news;
    CREATE TRIGGER update_news_updated_at
      BEFORE UPDATE ON market.news
      FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
  END IF;
END $$;

SELECT 'news table migration complete for market.news' AS status;
