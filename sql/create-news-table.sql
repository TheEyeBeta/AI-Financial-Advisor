-- Create news_articles table for financial news
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.news_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  link TEXT NOT NULL,
  source TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for sorting by date
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON public.news_articles(published_at DESC);

-- Enable RLS
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read news
CREATE POLICY "Anyone can view news articles"
ON public.news_articles FOR SELECT
TO authenticated
USING (true);

-- Allow service role to insert/update (for Python backend)
-- Note: This requires service role key, not anon key
-- Python backend should use service role key for inserts

-- Verify table creation
SELECT 'News articles table created successfully' as status;
SELECT COUNT(*) as total_articles FROM public.news_articles;
