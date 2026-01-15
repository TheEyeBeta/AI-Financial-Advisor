-- Test Data Script for John Doe User
-- Run this AFTER running supabase-schema.sql
-- This creates a test user and sample data for testing

-- Step 1: Create John Doe user in auth.users (using Supabase Admin API or Dashboard)
-- For now, we'll use a placeholder UUID. 
-- You'll need to create the user in Supabase Auth dashboard first, then replace this UUID
-- 
-- TO CREATE THE USER:
-- 1. Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
-- 2. Click "Add user" → "Create new user"
-- 3. Email: john.doe@example.com
-- 4. Password: TestPassword123!
-- 5. Copy the user ID (UUID) from the created user
-- 6. Replace 'USER_ID_PLACEHOLDER' below with the actual UUID

-- First, let's create the user profile (assuming auth user already exists)
-- You'll need to replace 'USER_ID_PLACEHOLDER' with the actual user ID from auth.users
DO $$
DECLARE
    john_doe_id UUID;
BEGIN
    -- Get or create John Doe user ID
    -- If user already exists in auth.users, use that ID
    -- Otherwise, you need to create it first in Supabase Auth dashboard
    
    -- Try to get existing user ID (you'll need to replace this with actual user ID)
    -- SELECT id INTO john_doe_id FROM auth.users WHERE email = 'john.doe@example.com' LIMIT 1;
    
    -- For now, we'll use a placeholder approach
    -- The actual user ID should be inserted via Supabase dashboard first
    -- Then replace USER_ID_PLACEHOLDER with that ID
    
    -- Create user profile if it doesn't exist
    INSERT INTO public.users (id, email, created_at, updated_at)
    VALUES (
        'USER_ID_PLACEHOLDER', -- REPLACE THIS with actual user ID from auth.users
        'john.doe@example.com',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
    
    -- Portfolio History
    INSERT INTO public.portfolio_history (user_id, date, value)
    VALUES
        ('USER_ID_PLACEHOLDER', '2024-01-01', 10000.00),
        ('USER_ID_PLACEHOLDER', '2024-01-08', 10450.00),
        ('USER_ID_PLACEHOLDER', '2024-01-15', 10200.00),
        ('USER_ID_PLACEHOLDER', '2024-01-22', 11100.00),
        ('USER_ID_PLACEHOLDER', '2024-02-01', 11800.00),
        ('USER_ID_PLACEHOLDER', '2024-02-08', 11600.00),
        ('USER_ID_PLACEHOLDER', '2024-02-15', 12400.00),
        ('USER_ID_PLACEHOLDER', '2024-02-22', 12100.00),
        ('USER_ID_PLACEHOLDER', '2024-03-01', 13200.00),
        ('USER_ID_PLACEHOLDER', '2024-03-08', 13800.00),
        ('USER_ID_PLACEHOLDER', '2024-03-15', 14200.00),
        ('USER_ID_PLACEHOLDER', '2024-03-22', 15340.00)
    ON CONFLICT (user_id, date) DO NOTHING;
    
    -- Open Positions
    INSERT INTO public.open_positions (user_id, symbol, name, quantity, entry_price, current_price, type, entry_date)
    VALUES
        ('USER_ID_PLACEHOLDER', 'AAPL', 'Apple Inc.', 25, 178.50, 185.20, 'LONG', '2024-01-18'),
        ('USER_ID_PLACEHOLDER', 'MSFT', 'Microsoft Corp', 15, 420.00, 415.80, 'LONG', '2024-02-01'),
        ('USER_ID_PLACEHOLDER', 'NVDA', 'NVIDIA Corp', 10, 875.00, 920.50, 'LONG', '2024-01-20'),
        ('USER_ID_PLACEHOLDER', 'TSLA', 'Tesla Inc.', 8, 245.00, 238.75, 'LONG', '2024-02-10')
    ON CONFLICT DO NOTHING;
    
    -- Closed Trades
    INSERT INTO public.trades (user_id, symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl)
    VALUES
        ('USER_ID_PLACEHOLDER', 'GOOGL', 'LONG', 'CLOSED', 12, 142.50, 156.80, '2024-01-15', '2024-01-22', 171.60),
        ('USER_ID_PLACEHOLDER', 'AMD', 'LONG', 'CLOSED', 30, 165.00, 158.20, '2024-01-10', '2024-01-18', -204.00),
        ('USER_ID_PLACEHOLDER', 'META', 'LONG', 'CLOSED', 8, 485.00, 512.30, '2024-01-08', '2024-01-16', 218.40),
        ('USER_ID_PLACEHOLDER', 'AMZN', 'LONG', 'CLOSED', 15, 178.50, 185.20, '2024-01-05', '2024-01-12', 100.50),
        ('USER_ID_PLACEHOLDER', 'NFLX', 'LONG', 'CLOSED', 5, 545.00, 532.80, '2024-01-02', '2024-01-08', -61.00),
        ('USER_ID_PLACEHOLDER', 'PYPL', 'LONG', 'CLOSED', 20, 65.00, 72.50, '2023-12-20', '2024-01-03', 150.00),
        ('USER_ID_PLACEHOLDER', 'INTC', 'LONG', 'CLOSED', 50, 48.00, 45.20, '2023-12-15', '2023-12-28', -140.00)
    ON CONFLICT DO NOTHING;
    
    -- Trade Journal Entries
    INSERT INTO public.trade_journal (user_id, symbol, type, date, quantity, price, strategy, notes, tags)
    VALUES
        (
            'USER_ID_PLACEHOLDER',
            'NVDA',
            'BUY',
            '2024-01-20',
            10,
            875.00,
            'Momentum breakout on strong earnings',
            'Breaking above key resistance at $870. AI demand continues to drive growth. Stop loss at $840.',
            ARRAY['momentum', 'earnings', 'tech']
        ),
        (
            'USER_ID_PLACEHOLDER',
            'AAPL',
            'BUY',
            '2024-01-18',
            25,
            178.50,
            'Support bounce with positive divergence',
            'Bouncing off 50-day MA. RSI showing bullish divergence. Target $190.',
            ARRAY['technical', 'support', 'swing']
        ),
        (
            'USER_ID_PLACEHOLDER',
            'GOOGL',
            'BUY',
            '2024-01-15',
            12,
            142.50,
            'Breakout above resistance with high volume',
            'Strong earnings report. Breakout pattern confirmed. Target $160.',
            ARRAY['breakout', 'earnings', 'momentum']
        )
    ON CONFLICT DO NOTHING;
    
    -- Learning Topics
    INSERT INTO public.learning_topics (user_id, topic_name, progress, completed)
    VALUES
        ('USER_ID_PLACEHOLDER', 'Stock Market Basics', 100, true),
        ('USER_ID_PLACEHOLDER', 'Technical Analysis', 75, false),
        ('USER_ID_PLACEHOLDER', 'Options Trading', 40, false),
        ('USER_ID_PLACEHOLDER', 'Risk Management', 60, false),
        ('USER_ID_PLACEHOLDER', 'Portfolio Theory', 20, false)
    ON CONFLICT (user_id, topic_name) DO UPDATE SET
        progress = EXCLUDED.progress,
        completed = EXCLUDED.completed;
    
    -- Achievements
    INSERT INTO public.achievements (user_id, name, icon)
    VALUES
        ('USER_ID_PLACEHOLDER', 'First Trade', '🎯'),
        ('USER_ID_PLACEHOLDER', 'Week Streak', '🔥'),
        ('USER_ID_PLACEHOLDER', 'Profit Master', '💰')
    ON CONFLICT (user_id, name) DO NOTHING;
    
    -- Chat Messages (initial welcome)
    INSERT INTO public.chat_messages (user_id, role, content)
    VALUES
        (
            'USER_ID_PLACEHOLDER',
            'assistant',
            'Hello! I''m your AI Financial Advisor. I''m here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?'
        )
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Test data inserted successfully! Make sure to replace USER_ID_PLACEHOLDER with the actual user ID from auth.users';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
        RAISE NOTICE 'Make sure you have created the user in Supabase Auth dashboard first!';
END $$;

-- Market Data (Public - no user_id needed)
INSERT INTO public.market_indices (symbol, name, value, change_percent, is_positive)
VALUES
    ('SPX', 'S&P 500', 5234.18, 1.24, true),
    ('IXIC', 'NASDAQ', 16742.39, 1.58, true),
    ('DJI', 'DOW JONES', 39087.38, 0.87, true),
    ('RUT', 'RUSSELL 2000', 2089.45, -0.32, false)
ON CONFLICT (symbol) DO UPDATE SET
    value = EXCLUDED.value,
    change_percent = EXCLUDED.change_percent,
    is_positive = EXCLUDED.is_positive,
    updated_at = NOW();

INSERT INTO public.trending_stocks (symbol, name, change_percent)
VALUES
    ('NVDA', 'NVIDIA', 4.2),
    ('TSLA', 'Tesla', -2.1),
    ('AAPL', 'Apple', 0.8),
    ('MSFT', 'Microsoft', 1.2),
    ('GOOGL', 'Alphabet', 2.3)
ON CONFLICT DO NOTHING;

-- NOTE: After running this script, you need to:
-- 1. Create the user in Supabase Auth dashboard (if not already created)
-- 2. Get the user ID from auth.users table
-- 3. Run this SQL to replace the placeholder:
--    UPDATE public.users SET id = 'ACTUAL_USER_ID' WHERE email = 'john.doe@example.com';
--    UPDATE public.portfolio_history SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.open_positions SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.trades SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.trade_journal SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.learning_topics SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.achievements SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    UPDATE public.chat_messages SET user_id = 'ACTUAL_USER_ID' WHERE user_id = 'USER_ID_PLACEHOLDER';
--    DELETE FROM public.users WHERE id = 'USER_ID_PLACEHOLDER';
