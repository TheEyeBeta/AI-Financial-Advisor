-- Supabase Database Schema for FinanceAI (Advisor Ally)
-- WARNING: This is a reference schema. Your database may already have these tables.
-- Only run specific parts if you're setting up a new database.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types
CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');
CREATE TYPE type_of_user AS ENUM ('User', 'Admin');

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

-- News Articles (Financial news - can be populated by Python backend)
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON public.chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON public.chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON public.chat_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_date ON public.portfolio_history(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_open_positions_user ON public.open_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id, exit_date DESC);
CREATE INDEX IF NOT EXISTS idx_trade_journal_user ON public.trade_journal(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_learning_topics_user ON public.learning_topics(user_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON public.news_articles(published_at DESC);

-- Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- RLS Policies (using auth_id for user lookup)

-- Users policies
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth_id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth_id = auth.uid());

-- Chats policies
CREATE POLICY "Users can view own chats" ON public.chats
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can create own chats" ON public.chats
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own chats" ON public.chats
    FOR UPDATE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chats" ON public.chats
    FOR DELETE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Chat Messages policies
CREATE POLICY "Users can view own chat messages" ON public.chat_messages
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own chat messages" ON public.chat_messages
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own chat messages" ON public.chat_messages
    FOR DELETE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Portfolio History policies
CREATE POLICY "Users can view own portfolio history" ON public.portfolio_history
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own portfolio history" ON public.portfolio_history
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Open Positions policies
CREATE POLICY "Users can view own positions" ON public.open_positions
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own positions" ON public.open_positions
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own positions" ON public.open_positions
    FOR UPDATE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own positions" ON public.open_positions
    FOR DELETE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Trades policies
CREATE POLICY "Users can view own trades" ON public.trades
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own trades" ON public.trades
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Trade Journal policies
CREATE POLICY "Users can view own journal" ON public.trade_journal
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own journal entries" ON public.trade_journal
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own journal entries" ON public.trade_journal
    FOR UPDATE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can delete own journal entries" ON public.trade_journal
    FOR DELETE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Learning Topics policies
CREATE POLICY "Users can view own learning topics" ON public.learning_topics
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own learning topics" ON public.learning_topics
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own learning topics" ON public.learning_topics
    FOR UPDATE USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Achievements policies
CREATE POLICY "Users can view own achievements" ON public.achievements
    FOR SELECT USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own achievements" ON public.achievements
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Market data is public read
CREATE POLICY "Anyone can view market indices" ON public.market_indices
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anyone can view trending stocks" ON public.trending_stocks
    FOR SELECT TO authenticated USING (true);

-- News articles are public read
CREATE POLICY "Anyone can view news articles" ON public.news_articles
    FOR SELECT TO authenticated USING (true);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON public.chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_open_positions_updated_at BEFORE UPDATE ON public.open_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON public.trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trade_journal_updated_at BEFORE UPDATE ON public.trade_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learning_topics_updated_at BEFORE UPDATE ON public.learning_topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to create public.users when auth.users is created
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

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
