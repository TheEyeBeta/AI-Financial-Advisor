-- ============================================================
-- Trade Engine Integration - News Articles Table
-- Run this in Supabase SQL Editor
-- 
-- This table stores news synced from the Trade Engine.
-- The AI gets LIVE data directly from Trade Engine API (no snapshots needed).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.news_articles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  link text NOT NULL,
  source text,
  published_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT news_articles_pkey PRIMARY KEY (id),
  CONSTRAINT news_articles_link_key UNIQUE (link)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at 
  ON public.news_articles(published_at DESC);

-- Enable RLS
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read news (public data)
CREATE POLICY "Anyone can view news articles"
  ON public.news_articles FOR SELECT
  TO authenticated, anon
  USING (true);

-- Verify
SELECT 'news_articles table created!' as status;
SELECT COUNT(*) as existing_articles FROM public.news_articles;
