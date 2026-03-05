-- ============================================================
-- Advisor Ally - Complete Database Schema
-- ============================================================
-- This is a consolidated schema file that includes all tables,
-- policies, triggers, and functions needed for the application.
-- Run this in Supabase SQL Editor for a fresh database setup.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
CREATE TABLE IF NOT EXISTS public.users (
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
CREATE TABLE IF NOT EXISTS public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages (AI Advisor conversations)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portfolio Performance History
CREATE TABLE IF NOT EXISTS public.portfolio_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    value DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Open Positions (Active trades)
CREATE TABLE IF NOT EXISTS public.open_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON public.chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON public.chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON public.chat_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_date ON public.portfolio_history(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_open_positions_user ON public.open_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_open_positions_symbol_upper ON public.open_positions(UPPER(symbol));
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
CREATE INDEX IF NOT EXISTS idx_stock_snapshots_ticker_upper ON public.stock_snapshots(UPPER(ticker));

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
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
    SELECT 1 FROM public.users 
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
    INSERT INTO public.users (auth_id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, onboarding_complete)
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
        email = COALESCE(EXCLUDED.email, public.users.email),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, public.users.is_verified),
        email_verified_at = COALESCE(NEW.email_confirmed_at, public.users.email_verified_at),
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

-- Function to normalize symbols and default open position prices from latest stock snapshot
CREATE OR REPLACE FUNCTION set_open_position_prices_from_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    latest_price NUMERIC;
BEGIN
    NEW.symbol = UPPER(TRIM(NEW.symbol));

    SELECT ss.last_price
    INTO latest_price
    FROM public.stock_snapshots ss
    WHERE UPPER(ss.ticker) = NEW.symbol
    ORDER BY ss.updated_at DESC NULLS LAST, ss.last_price_ts DESC NULLS LAST, ss.synced_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticker "%" does not exist in stock_snapshots', NEW.symbol
            USING ERRCODE = '23503',
                  HINT = 'Use a valid ticker present in stock_snapshots.';
    END IF;

    IF latest_price IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            NEW.entry_price = ROUND(latest_price::NUMERIC, 2);
        END IF;
        NEW.current_price = ROUND(latest_price::NUMERIC, 2);
    ELSIF NEW.current_price IS NULL THEN
        NEW.current_price = NEW.entry_price;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to keep open_positions.current_price synchronized with stock snapshots
CREATE OR REPLACE FUNCTION sync_open_positions_current_price_from_stock_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_price IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.open_positions
    SET current_price = ROUND(NEW.last_price::NUMERIC, 2)
    WHERE UPPER(symbol) = UPPER(NEW.ticker)
      AND current_price IS DISTINCT FROM ROUND(NEW.last_price::NUMERIC, 2);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Users policies (with admin support)
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can view profiles" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update profiles" ON public.users;
DROP POLICY IF EXISTS "Admins can delete users" ON public.users;
DROP POLICY IF EXISTS "Service role can insert user profiles" ON public.users;

CREATE POLICY "Users can view profiles"
ON public.users FOR SELECT
USING (
  auth_id = auth.uid()
  OR
  public.is_current_user_admin()
);

CREATE POLICY "Users can update profiles"
ON public.users FOR UPDATE
USING (
  auth_id = auth.uid()
  OR
  public.is_current_user_admin()
);

CREATE POLICY "Admins can delete users"
ON public.users FOR DELETE
USING (
  public.is_current_user_admin()
  AND auth_id != auth.uid()
);

CREATE POLICY "Service role can insert user profiles"
ON public.users FOR INSERT
WITH CHECK (true);

-- Chats policies
DROP POLICY IF EXISTS "Users can view own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can create own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can update own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can delete own chats" ON public.chats;

CREATE POLICY "Users can view own chats"
ON public.chats FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can create own chats"
ON public.chats FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own chats"
ON public.chats FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chats"
ON public.chats FOR DELETE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Chat Messages policies
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_messages;

CREATE POLICY "Users can view own chat messages"
ON public.chat_messages FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chat messages"
ON public.chat_messages FOR DELETE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Portfolio History policies
DROP POLICY IF EXISTS "Users can view own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can insert own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can update own portfolio history" ON public.portfolio_history;

CREATE POLICY "Users can view own portfolio history"
ON public.portfolio_history FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own portfolio history"
ON public.portfolio_history FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own portfolio history"
ON public.portfolio_history FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Open Positions policies
DROP POLICY IF EXISTS "Users can view own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON public.open_positions;

CREATE POLICY "Users can view own positions"
ON public.open_positions FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own positions"
ON public.open_positions FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own positions"
ON public.open_positions FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own positions"
ON public.open_positions FOR DELETE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Trades policies
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;

CREATE POLICY "Users can view own trades"
ON public.trades FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own trades"
ON public.trades FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own trades"
ON public.trades FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Trade Journal policies
DROP POLICY IF EXISTS "Users can view own journal" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can update own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can delete own journal entries" ON public.trade_journal;

CREATE POLICY "Users can view own journal"
ON public.trade_journal FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own journal entries"
ON public.trade_journal FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own journal entries"
ON public.trade_journal FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own journal entries"
ON public.trade_journal FOR DELETE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Learning Topics policies
DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;

CREATE POLICY "Users can view own learning topics"
ON public.learning_topics FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own learning topics"
ON public.learning_topics FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own learning topics"
ON public.learning_topics FOR UPDATE
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Achievements policies
DROP POLICY IF EXISTS "Users can view own achievements" ON public.achievements;
DROP POLICY IF EXISTS "Users can insert own achievements" ON public.achievements;

CREATE POLICY "Users can view own achievements"
ON public.achievements FOR SELECT
USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own achievements"
ON public.achievements FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

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
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can insert their own eye snapshots"
ON public.eye_snapshots FOR INSERT
WITH CHECK (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can update their own eye snapshots"
ON public.eye_snapshots FOR UPDATE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can delete their own eye snapshots"
ON public.eye_snapshots FOR DELETE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

-- ============================================================
-- Triggers
-- ============================================================

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON public.chats;
CREATE TRIGGER update_chats_updated_at
    BEFORE UPDATE ON public.chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_open_positions_updated_at ON public.open_positions;
CREATE TRIGGER update_open_positions_updated_at
    BEFORE UPDATE ON public.open_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_set_open_position_prices_from_snapshot ON public.open_positions;
CREATE TRIGGER trigger_set_open_position_prices_from_snapshot
    BEFORE INSERT OR UPDATE OF symbol ON public.open_positions
    FOR EACH ROW EXECUTE FUNCTION set_open_position_prices_from_snapshot();

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

DROP TRIGGER IF EXISTS trigger_sync_open_positions_from_stock_snapshot ON public.stock_snapshots;
CREATE TRIGGER trigger_sync_open_positions_from_stock_snapshot
    AFTER INSERT OR UPDATE OF last_price ON public.stock_snapshots
    FOR EACH ROW
    WHEN (NEW.last_price IS NOT NULL)
    EXECUTE FUNCTION sync_open_positions_current_price_from_stock_snapshot();

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

-- Backfill existing open positions to latest snapshot prices
UPDATE public.open_positions op
SET current_price = ROUND(ss.last_price::NUMERIC, 2)
FROM public.stock_snapshots ss
WHERE UPPER(op.symbol) = UPPER(ss.ticker)
  AND ss.last_price IS NOT NULL
  AND op.current_price IS DISTINCT FROM ROUND(ss.last_price::NUMERIC, 2);

-- ============================================================
-- Paper Trading Refactor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.paper_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    buy_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    buy_quantity INTEGER NOT NULL CHECK (buy_quantity > 0),
    buy_price DECIMAL(10, 2) NOT NULL CHECK (buy_price > 0),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    tags TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.paper_trade_closes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    buy_trade_id UUID NOT NULL REFERENCES public.paper_trades(id) ON DELETE CASCADE,
    close_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    close_quantity INTEGER NOT NULL CHECK (close_quantity > 0),
    close_price DECIMAL(10, 2) NOT NULL CHECK (close_price > 0),
    reason TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_user_buy_time ON public.paper_trades(user_id, buy_time DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_user_status ON public.paper_trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_upper ON public.paper_trades(UPPER(symbol));
CREATE INDEX IF NOT EXISTS idx_paper_trade_closes_user_time ON public.paper_trade_closes(user_id, close_time DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trade_closes_trade_id ON public.paper_trade_closes(buy_trade_id);

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_trade_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can insert own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can update own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can delete own paper trades" ON public.paper_trades;

CREATE POLICY "Users can view own paper trades"
ON public.paper_trades FOR SELECT
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can insert own paper trades"
ON public.paper_trades FOR INSERT
WITH CHECK (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can update own paper trades"
ON public.paper_trades FOR UPDATE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can delete own paper trades"
ON public.paper_trades FOR DELETE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

DROP POLICY IF EXISTS "Users can view own paper trade closes" ON public.paper_trade_closes;
DROP POLICY IF EXISTS "Users can insert own paper trade closes" ON public.paper_trade_closes;

CREATE POLICY "Users can view own paper trade closes"
ON public.paper_trade_closes FOR SELECT
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can insert own paper trade closes"
ON public.paper_trade_closes FOR INSERT
WITH CHECK (
    auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id)
    AND EXISTS (
        SELECT 1
        FROM public.paper_trades pt
        WHERE pt.id = buy_trade_id
          AND pt.user_id = paper_trade_closes.user_id
    )
);

CREATE OR REPLACE FUNCTION public.validate_paper_trade_symbol_exists()
RETURNS TRIGGER AS $$
BEGIN
    NEW.symbol = UPPER(TRIM(NEW.symbol));

    PERFORM 1
    FROM public.stock_snapshots ss
    WHERE UPPER(ss.ticker) = NEW.symbol
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticker "%" does not exist in stock_snapshots', NEW.symbol
            USING ERRCODE = '23503',
                  HINT = 'Use a valid ticker present in stock_snapshots.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_paper_trade_close_insert()
RETURNS TRIGGER AS $$
DECLARE
    target_trade public.paper_trades%ROWTYPE;
    already_closed INTEGER;
BEGIN
    IF NEW.close_quantity <= 0 THEN
        RAISE EXCEPTION 'close_quantity must be greater than 0';
    END IF;

    IF NEW.close_price <= 0 THEN
        RAISE EXCEPTION 'close_price must be greater than 0';
    END IF;

    SELECT *
    INTO target_trade
    FROM public.paper_trades
    WHERE id = NEW.buy_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BUY trade % not found', NEW.buy_trade_id;
    END IF;

    IF target_trade.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Close user_id must match BUY trade user_id';
    END IF;

    SELECT COALESCE(SUM(close_quantity), 0)
    INTO already_closed
    FROM public.paper_trade_closes
    WHERE buy_trade_id = NEW.buy_trade_id;

    IF already_closed + NEW.close_quantity > target_trade.buy_quantity THEN
        RAISE EXCEPTION 'Cannot close % shares. Open quantity is %.',
            NEW.close_quantity,
            target_trade.buy_quantity - already_closed;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_paper_trade_core_field_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol
       OR NEW.buy_time IS DISTINCT FROM OLD.buy_time
       OR NEW.buy_quantity IS DISTINCT FROM OLD.buy_quantity
       OR NEW.buy_price IS DISTINCT FROM OLD.buy_price THEN
        RAISE EXCEPTION 'BUY trade core fields are immutable. Create a new BUY lot instead.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.refresh_paper_trade_status_after_close()
RETURNS TRIGGER AS $$
DECLARE
    buy_qty INTEGER;
    total_closed INTEGER;
BEGIN
    SELECT buy_quantity
    INTO buy_qty
    FROM public.paper_trades
    WHERE id = NEW.buy_trade_id;

    SELECT COALESCE(SUM(close_quantity), 0)
    INTO total_closed
    FROM public.paper_trade_closes
    WHERE buy_trade_id = NEW.buy_trade_id;

    UPDATE public.paper_trades
    SET
        status = CASE WHEN total_closed >= buy_qty THEN 'CLOSED' ELSE 'OPEN' END,
        updated_at = NOW()
    WHERE id = NEW.buy_trade_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_paper_trade_symbol ON public.paper_trades;
CREATE TRIGGER trigger_validate_paper_trade_symbol
    BEFORE INSERT OR UPDATE OF symbol ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_paper_trade_symbol_exists();

DROP TRIGGER IF EXISTS update_paper_trades_updated_at ON public.paper_trades;
CREATE TRIGGER update_paper_trades_updated_at
    BEFORE UPDATE ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_prevent_paper_trade_core_field_updates ON public.paper_trades;
CREATE TRIGGER trigger_prevent_paper_trade_core_field_updates
    BEFORE UPDATE ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_paper_trade_core_field_updates();

DROP TRIGGER IF EXISTS trigger_validate_paper_trade_close_insert ON public.paper_trade_closes;
CREATE TRIGGER trigger_validate_paper_trade_close_insert
    BEFORE INSERT ON public.paper_trade_closes
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_paper_trade_close_insert();

DROP TRIGGER IF EXISTS trigger_refresh_paper_trade_status_after_close ON public.paper_trade_closes;
CREATE TRIGGER trigger_refresh_paper_trade_status_after_close
    AFTER INSERT ON public.paper_trade_closes
    FOR EACH ROW
    EXECUTE FUNCTION public.refresh_paper_trade_status_after_close();

UPDATE public.paper_trades pt
SET
    status = CASE
        WHEN COALESCE((
            SELECT SUM(c.close_quantity)::INTEGER
            FROM public.paper_trade_closes c
            WHERE c.buy_trade_id = pt.id
        ), 0) >= pt.buy_quantity THEN 'CLOSED'
        ELSE 'OPEN'
    END,
    updated_at = NOW()
;

-- ============================================================
-- Schema Complete
-- ============================================================

SELECT '✅ Schema setup complete!' as status;
