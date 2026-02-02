-- Update news_articles table for Trade Engine sync
-- Run this in Supabase SQL Editor BEFORE running the sync script

-- Add unique constraint on link to prevent duplicates
ALTER TABLE public.news_articles 
ADD CONSTRAINT news_articles_link_key UNIQUE (link);

-- Add index on created_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at 
ON public.news_articles(created_at DESC);

-- Allow public read access (for testing)
DROP POLICY IF EXISTS "Anyone can view news articles" ON public.news_articles;
CREATE POLICY "Anyone can view news articles"
ON public.news_articles FOR SELECT
TO authenticated, anon
USING (true);

-- Verify
SELECT 'News table updated for Trade Engine sync' as status;
