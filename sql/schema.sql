-- ============================================================
-- Advisor Ally - Complete Database Schema
-- ============================================================
-- This is a consolidated schema file that includes all tables,
-- policies, triggers, and functions needed for the application.
-- Run this in Supabase SQL Editor for a fresh database setup.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure application schemas exist
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS trading;
CREATE SCHEMA IF NOT EXISTS market;

-- ============================================================
-- ENUM Types
-- ============================================================

CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');
CREATE TYPE type_of_user AS ENUM ('User', 'Admin');
-- Add marital_status and investment_goal enums if they don't exist
DO $$ BEGIN
    CREATE TYPE marital_status_enum AS ENUM ('single', 'married', 'divorced', 'widowed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE investment_goal_enum AS ENUM ('retirement', 'wealth_building', 'education', 'house_purchase', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- Tables
-- ============================================================

-- Users table (extends Supabase auth.users via auth_id)
CREATE TABLE IF NOT EXISTS core.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    age INTEGER CHECK (age >= 13 AND age <= 150),
    email TEXT,
    experience_level experience_level_enum DEFAULT 'beginner',
    risk_level risk_level_enum DEFAULT 'mid',
    is_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    userType type_of_user NOT NULL DEFAULT 'User',
    onboarding_complete BOOLEAN DEFAULT FALSE,
    marital_status marital_status_enum,
    investment_goal investment_goal_enum,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chats table (conversation sessions)
CREATE TABLE IF NOT EXISTS ai.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages (AI Advisor conversations)
CREATE TABLE IF NOT EXISTS ai.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES ai.chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portfolio Performance History
CREATE TABLE IF NOT EXISTS public.portfolio_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    value DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Open Positions (Active trades)
CREATE TABLE IF NOT EXISTS public.open_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    name TEXT,
    quantity INTEGER NOT NULL,
    entry_price DECIMAL(10, 2) NOT NULL,
    current_price DECIMAL(10, 2),
    type TEXT NOT NULL CHECK (type IN ('LONG', 'SHORT')),
    entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade History (Closed trades)
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('LONG', 'SHORT')),
    action TEXT NOT NULL CHECK (action IN ('OPENED', 'CLOSED')),
    quantity INTEGER NOT NULL,
    entry_price DECIMAL(10, 2) NOT NULL,
    exit_price DECIMAL(10, 2),
    entry_date TIMESTAMPTZ NOT NULL,
    exit_date TIMESTAMPTZ,
    pnl DECIMAL(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade Journal (Detailed trade notes and strategy)
CREATE TABLE IF NOT EXISTS public.trade_journal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
    date DATE NOT NULL,
    quantity INTEGER NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    strategy TEXT,
    notes TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Learning Progress
CREATE TABLE IF NOT EXISTS public.learning_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    topic_name TEXT NOT NULL,
    progress INTEGER NOT NULL CHECK (progress >= 0 AND progress <= 100) DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic_name)
);

-- Achievements
CREATE TABLE IF NOT EXISTS public.achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Market Data (Indices - can be updated by backend)
CREATE TABLE IF NOT EXISTS public.market_indices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    value DECIMAL(12, 2) NOT NULL,
    change_percent DECIMAL(5, 2) NOT NULL,
    is_positive BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trending Stocks
CREATE TABLE IF NOT EXISTS public.trending_stocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    change_percent DECIMAL(5, 2) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- News Articles (Financial news - synced from Trade Engine)
CREATE TABLE IF NOT EXISTS public.news_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL UNIQUE,
    source TEXT,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- News (Canonical table for UI and integrations)
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

-- Backfill canonical news table from legacy news_articles when available.
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

-- The Eye Trade Engine Snapshots
CREATE TABLE IF NOT EXISTS public.eye_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    snapshot_name TEXT,
    snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    portfolio_value DECIMAL(12, 2),
    total_positions INTEGER DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 2),
    total_pnl DECIMAL(12, 2),
    realized_pnl DECIMAL(12, 2),
    unrealized_pnl DECIMAL(12, 2),
    profit_factor DECIMAL(5, 2),
    avg_profit DECIMAL(10, 2),
    avg_loss DECIMAL(10, 2),
    raw_data JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    is_latest BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_latest_per_user UNIQUE NULLS NOT DISTINCT (user_id, is_latest) WHERE (is_latest = TRUE)
);

-- Stock Snapshots (from Trade Engine)
CREATE TABLE IF NOT EXISTS public.stock_snapshots (
    ticker_id BIGINT NOT NULL PRIMARY KEY,
    ticker VARCHAR NOT NULL,
    company_name VARCHAR,
    last_price NUMERIC,
    last_price_ts TIMESTAMPTZ,
    price_change_pct NUMERIC,
    price_change_abs NUMERIC,
    high_52w NUMERIC,
    low_52w NUMERIC,
    updated_at TIMESTAMPTZ,
    volume BIGINT,
    avg_volume_10d BIGINT,
    avg_volume_30d BIGINT,
    volume_ratio NUMERIC,
    sma_10 NUMERIC,
    sma_20 NUMERIC,
    sma_50 NUMERIC,
    sma_100 NUMERIC,
    sma_200 NUMERIC,
    ema_10 NUMERIC,
    ema_20 NUMERIC,
    ema_50 NUMERIC,
    ema_200 NUMERIC,
    rsi_14 NUMERIC,
    rsi_9 NUMERIC,
    stochastic_k NUMERIC,
    stochastic_d NUMERIC,
    williams_r NUMERIC,
    cci NUMERIC,
    macd NUMERIC,
    macd_signal NUMERIC,
    macd_histogram NUMERIC,
    adx NUMERIC,
    bollinger_upper NUMERIC,
    bollinger_middle NUMERIC,
    bollinger_lower NUMERIC,
    pe_ratio NUMERIC,
    forward_pe NUMERIC,
    peg_ratio NUMERIC,
    price_to_book NUMERIC,
    price_to_sales NUMERIC,
    dividend_yield NUMERIC,
    market_cap NUMERIC,
    eps NUMERIC,
    eps_growth NUMERIC,
    revenue_growth NUMERIC,
    price_vs_sma_50 NUMERIC,
    price_vs_sma_200 NUMERIC,
    price_vs_ema_50 NUMERIC,
    price_vs_ema_200 NUMERIC,
    price_vs_bollinger_middle NUMERIC,
    is_bullish BOOLEAN,
    is_oversold BOOLEAN,
    is_overbought BOOLEAN,
    latest_signal VARCHAR,
    signal_strategy VARCHAR,
    signal_confidence NUMERIC,
    signal_timestamp TIMESTAMPTZ,
    last_news_ts TIMESTAMPTZ,
    news_count_24h INTEGER,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON core.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON ai.chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON ai.chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON ai.chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON ai.chat_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_date ON public.portfolio_history(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_open_positions_user ON public.open_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id, exit_date DESC);
CREATE INDEX IF NOT EXISTS idx_trade_journal_user ON public.trade_journal(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_learning_topics_user ON public.learning_topics(user_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON public.news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at ON public.news_articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON public.news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON public.news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_id ON public.eye_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_latest ON public.eye_snapshots(user_id, is_latest) WHERE (is_latest = TRUE);
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_active ON public.eye_snapshots(user_id, is_active) WHERE (is_active = TRUE);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trending_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eye_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_snapshots ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA ai TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai.chats TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE ai.chat_messages TO authenticated;

-- ============================================================
-- Helper Functions
-- ============================================================

-- Function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.users
    WHERE auth_id = auth.uid()
    AND "userType" = 'Admin'
  );
$$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to handle new user creation from auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO core.users (auth_id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, onboarding_complete)
    VALUES (
        NEW.id,
        COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, NULL),
        COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, NULL),
        COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, NULL),
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'experience_level')::experience_level_enum, 'beginner'),
        COALESCE((NEW.raw_user_meta_data->>'risk_level')::risk_level_enum, 'mid'),
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        FALSE  -- New users must complete onboarding
    )
    ON CONFLICT (auth_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, core.users.email),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, core.users.is_verified),
        email_verified_at = COALESCE(NEW.email_confirmed_at, core.users.email_verified_at),
        updated_at = NOW();

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to automatically set is_latest flag for eye snapshots
CREATE OR REPLACE FUNCTION set_latest_eye_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    -- If this snapshot is marked as latest, unmark all others for this user
    IF NEW.is_latest = TRUE THEN
        UPDATE public.eye_snapshots
        SET is_latest = FALSE
        WHERE user_id = NEW.user_id
        AND id != NEW.id
        AND is_latest = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Users policies (with admin support)
DROP POLICY IF EXISTS "Users can view own profile" ON core.users;
DROP POLICY IF EXISTS "Users can view profiles" ON core.users;
DROP POLICY IF EXISTS "Users can update own profile" ON core.users;
DROP POLICY IF EXISTS "Users can update profiles" ON core.users;
DROP POLICY IF EXISTS "Admins can delete users" ON core.users;
DROP POLICY IF EXISTS "Service role can insert user profiles" ON core.users;

CREATE POLICY "Users can view profiles"
ON core.users FOR SELECT
USING (
  auth_id = auth.uid()
  OR
  public.is_current_user_admin()
);

CREATE POLICY "Users can update profiles"
ON core.users FOR UPDATE
USING (
  auth_id = auth.uid()
  OR
  public.is_current_user_admin()
);

CREATE POLICY "Admins can delete users"
ON core.users FOR DELETE
USING (
  public.is_current_user_admin()
  AND auth_id != auth.uid()
);

CREATE POLICY "Service role can insert user profiles"
ON core.users FOR INSERT
WITH CHECK (true);

-- Chats policies
DROP POLICY IF EXISTS "Users can view own chats" ON ai.chats;
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
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chats"
ON ai.chats FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Chat Messages policies
DROP POLICY IF EXISTS "Users can view own chat messages" ON ai.chat_messages;
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
            SELECT 1
            FROM ai.chats
            WHERE ai.chats.id = chat_id
              AND ai.chats.user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid())
        )
    )
);

CREATE POLICY "Users can delete own chat messages"
ON ai.chat_messages FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Portfolio History policies
DROP POLICY IF EXISTS "Users can view own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can insert own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can update own portfolio history" ON public.portfolio_history;

CREATE POLICY "Users can view own portfolio history"
ON public.portfolio_history FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own portfolio history"
ON public.portfolio_history FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own portfolio history"
ON public.portfolio_history FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Open Positions policies
DROP POLICY IF EXISTS "Users can view own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON public.open_positions;

CREATE POLICY "Users can view own positions"
ON public.open_positions FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own positions"
ON public.open_positions FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own positions"
ON public.open_positions FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own positions"
ON public.open_positions FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Trades policies
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;

CREATE POLICY "Users can view own trades"
ON public.trades FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own trades"
ON public.trades FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own trades"
ON public.trades FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Trade Journal policies
DROP POLICY IF EXISTS "Users can view own journal" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can update own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can delete own journal entries" ON public.trade_journal;

CREATE POLICY "Users can view own journal"
ON public.trade_journal FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own journal entries"
ON public.trade_journal FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own journal entries"
ON public.trade_journal FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own journal entries"
ON public.trade_journal FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Learning Topics policies
DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;

CREATE POLICY "Users can view own learning topics"
ON public.learning_topics FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own learning topics"
ON public.learning_topics FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own learning topics"
ON public.learning_topics FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Achievements policies
DROP POLICY IF EXISTS "Users can view own achievements" ON public.achievements;
DROP POLICY IF EXISTS "Users can insert own achievements" ON public.achievements;

CREATE POLICY "Users can view own achievements"
ON public.achievements FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own achievements"
ON public.achievements FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Market data is public read
DROP POLICY IF EXISTS "Anyone can view market indices" ON public.market_indices;
CREATE POLICY "Anyone can view market indices"
ON public.market_indices FOR SELECT
TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Anyone can view trending stocks" ON public.trending_stocks;
CREATE POLICY "Anyone can view trending stocks"
ON public.trending_stocks FOR SELECT
TO authenticated, anon USING (true);

-- Stock snapshots are readable by authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view stock snapshots" ON public.stock_snapshots;
CREATE POLICY "Authenticated users can view stock snapshots"
ON public.stock_snapshots FOR SELECT
TO authenticated USING (true);

-- News articles are public read
DROP POLICY IF EXISTS "Anyone can view news articles" ON public.news_articles;
CREATE POLICY "Anyone can view news articles"
ON public.news_articles FOR SELECT
TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Anyone can view news" ON public.news;
CREATE POLICY "Anyone can view news"
ON public.news FOR SELECT
TO authenticated, anon USING (true);

-- Eye Snapshots policies
DROP POLICY IF EXISTS "Users can view their own eye snapshots" ON public.eye_snapshots;
DROP POLICY IF EXISTS "Users can insert their own eye snapshots" ON public.eye_snapshots;
DROP POLICY IF EXISTS "Users can update their own eye snapshots" ON public.eye_snapshots;
DROP POLICY IF EXISTS "Users can delete their own eye snapshots" ON public.eye_snapshots;

CREATE POLICY "Users can view their own eye snapshots"
ON public.eye_snapshots FOR SELECT
USING (auth.uid() IN (SELECT auth_id FROM core.users WHERE id = user_id));

CREATE POLICY "Users can insert their own eye snapshots"
ON public.eye_snapshots FOR INSERT
WITH CHECK (auth.uid() IN (SELECT auth_id FROM core.users WHERE id = user_id));

CREATE POLICY "Users can update their own eye snapshots"
ON public.eye_snapshots FOR UPDATE
USING (auth.uid() IN (SELECT auth_id FROM core.users WHERE id = user_id));

CREATE POLICY "Users can delete their own eye snapshots"
ON public.eye_snapshots FOR DELETE
USING (auth.uid() IN (SELECT auth_id FROM core.users WHERE id = user_id));

-- ============================================================
-- Triggers
-- ============================================================

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON core.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON core.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON ai.chats;
CREATE TRIGGER update_chats_updated_at
    BEFORE UPDATE ON ai.chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_open_positions_updated_at ON public.open_positions;
CREATE TRIGGER update_open_positions_updated_at
    BEFORE UPDATE ON public.open_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_trades_updated_at ON public.trades;
CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON public.trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_trade_journal_updated_at ON public.trade_journal;
CREATE TRIGGER update_trade_journal_updated_at
    BEFORE UPDATE ON public.trade_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_learning_topics_updated_at ON public.learning_topics;
CREATE TRIGGER update_learning_topics_updated_at
    BEFORE UPDATE ON public.learning_topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_eye_snapshots_updated_at ON public.eye_snapshots;
CREATE TRIGGER update_eye_snapshots_updated_at
    BEFORE UPDATE ON public.eye_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_news_updated_at ON public.news;
CREATE TRIGGER update_news_updated_at
    BEFORE UPDATE ON public.news
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auth user creation trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Eye snapshots latest flag trigger
DROP TRIGGER IF EXISTS trigger_set_latest_eye_snapshot ON public.eye_snapshots;
CREATE TRIGGER trigger_set_latest_eye_snapshot
    BEFORE INSERT OR UPDATE ON public.eye_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION set_latest_eye_snapshot();

-- ============================================================
-- Schema Complete
-- ============================================================

SELECT '✅ Schema setup complete!' as status;
