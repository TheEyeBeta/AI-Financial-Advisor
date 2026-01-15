-- Supabase Database Schema for Advisor Ally
-- This schema supports paper trading, portfolio tracking, chat history, and learning progress

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types
CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');

-- Users table (extends Supabase auth.users)
-- Password authentication is handled by auth.users table (Supabase built-in)
-- This table extends user profile with additional fields
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT, -- User's first name
    last_name TEXT, -- User's last name
    age INTEGER CHECK (age >= 13 AND age <= 150), -- User's age
    email TEXT, -- User's email
    experience_level experience_level_enum DEFAULT 'beginner', -- Finance experience level
    risk_level risk_level_enum DEFAULT 'mid', -- Risk tolerance level
    is_verified BOOLEAN DEFAULT FALSE, -- Email verification status (synced with auth.users.email_confirmed_at)
    email_verified_at TIMESTAMPTZ, -- When email was verified (synced with auth.users.email_confirmed_at)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
    tags TEXT[], -- Array of tags
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages (AI Advisor conversations)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
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

-- Market Data (Indices and trending stocks - can be updated by Python backend)
CREATE TABLE IF NOT EXISTS public.market_indices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    value DECIMAL(12, 2) NOT NULL,
    change_percent DECIMAL(5, 2) NOT NULL,
    is_positive BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trending_stocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    change_percent DECIMAL(5, 2) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_date ON public.portfolio_history(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_open_positions_user ON public.open_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id, exit_date DESC);
CREATE INDEX IF NOT EXISTS idx_trade_journal_user ON public.trade_journal(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON public.chat_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_topics_user ON public.learning_topics(user_id);

-- Row Level Security (RLS) Policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Portfolio History policies
CREATE POLICY "Users can view own portfolio history" ON public.portfolio_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolio history" ON public.portfolio_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolio history" ON public.portfolio_history
    FOR UPDATE USING (auth.uid() = user_id);

-- Open Positions policies
CREATE POLICY "Users can view own positions" ON public.open_positions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions" ON public.open_positions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions" ON public.open_positions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions" ON public.open_positions
    FOR DELETE USING (auth.uid() = user_id);

-- Trades policies
CREATE POLICY "Users can view own trades" ON public.trades
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades" ON public.trades
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trades" ON public.trades
    FOR UPDATE USING (auth.uid() = user_id);

-- Trade Journal policies
CREATE POLICY "Users can view own journal" ON public.trade_journal
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own journal entries" ON public.trade_journal
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own journal entries" ON public.trade_journal
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own journal entries" ON public.trade_journal
    FOR DELETE USING (auth.uid() = user_id);

-- Chat Messages policies
CREATE POLICY "Users can view own messages" ON public.chat_messages
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages" ON public.chat_messages
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Learning Topics policies
CREATE POLICY "Users can view own learning topics" ON public.learning_topics
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learning topics" ON public.learning_topics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learning topics" ON public.learning_topics
    FOR UPDATE USING (auth.uid() = user_id);

-- Achievements policies
CREATE POLICY "Users can view own achievements" ON public.achievements
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own achievements" ON public.achievements
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Market data is public (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view market indices" ON public.market_indices
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view trending stocks" ON public.trending_stocks
    FOR SELECT TO authenticated USING (true);

-- Functions for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_open_positions_updated_at BEFORE UPDATE ON public.open_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON public.trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trade_journal_updated_at BEFORE UPDATE ON public.trade_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learning_topics_updated_at BEFORE UPDATE ON public.learning_topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to sync email verification status from auth.users to public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile in public.users when auth user is created
    INSERT INTO public.users (id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, created_at, updated_at)
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
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.users.last_name),
        age = COALESCE(EXCLUDED.age, public.users.age),
        email = COALESCE(EXCLUDED.email, public.users.email),
        experience_level = COALESCE(EXCLUDED.experience_level, public.users.experience_level),
        risk_level = COALESCE(EXCLUDED.risk_level, public.users.risk_level),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        email_verified_at = NEW.email_confirmed_at,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create/update public.users when auth.users changes
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Function to update verification status when email is confirmed
CREATE OR REPLACE FUNCTION public.handle_email_verification()
RETURNS TRIGGER AS $$
BEGIN
    -- Update public.users when email_confirmed_at changes in auth.users
    IF NEW.email_confirmed_at IS NOT NULL AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at != NEW.email_confirmed_at) THEN
        UPDATE public.users
        SET 
            is_verified = true,
            email_verified_at = NEW.email_confirmed_at,
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync email verification status
CREATE TRIGGER on_email_verified
    AFTER UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
    EXECUTE FUNCTION public.handle_email_verification();
