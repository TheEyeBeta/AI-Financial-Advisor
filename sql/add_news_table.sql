-- ============================================================
-- Add Canonical public.news Table
-- ============================================================
-- Run this in Supabase SQL Editor to add a dedicated news table.
-- This script is safe to run multiple times.
-- This setup keeps access open for fast iteration.
-- Before production, run sql/harden_news_policies.sql.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.news (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL UNIQUE,
    provider TEXT,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published_at ON public.news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON public.news(created_at DESC);

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view news" ON public.news;
DROP POLICY IF EXISTS "Open access to news" ON public.news;
CREATE POLICY "Open access to news"
ON public.news FOR ALL
TO authenticated, anon
USING (true)
WITH CHECK (true);

-- If legacy public.news_articles exists, copy data into public.news.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'news_articles'
  ) THEN
    INSERT INTO public.news (title, summary, link, provider, published_at, created_at, updated_at)
    SELECT
      na.title,
      na.summary,
      na.link,
      na.source,
      na.published_at,
      na.created_at,
      na.updated_at
    FROM public.news_articles na
    ON CONFLICT (link) DO NOTHING;
  END IF;
END $$;

-- Optional: keep updated_at in sync if helper trigger function already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_news_updated_at ON public.news;
    CREATE TRIGGER update_news_updated_at
      BEFORE UPDATE ON public.news
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

SELECT '✅ public.news table migration complete!' AS status;
