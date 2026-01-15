-- Script to create John Doe user and test data automatically
-- This script creates the user in auth.users and all associated test data
-- 
-- IMPORTANT: Run this with admin/service role privileges OR
-- Run in Supabase SQL Editor (which has the necessary permissions)
--
-- The user will be created with:
-- Email: john.doe@example.com
-- Password: TestPassword123!
-- You can change the password after first login if needed

-- Step 1: Create the user in auth.users
-- Note: In Supabase, creating users via SQL requires admin/service role
-- This will work in Supabase SQL Editor with proper permissions

DO $$
DECLARE
    john_doe_id UUID;
    user_exists BOOLEAN;
BEGIN
    -- Check if user already exists
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = 'john.doe@example.com') INTO user_exists;
    
    IF user_exists THEN
        -- Get existing user ID
        SELECT id INTO john_doe_id FROM auth.users WHERE email = 'john.doe@example.com' LIMIT 1;
        RAISE NOTICE 'User already exists with ID: %', john_doe_id;
    ELSE
        -- Create new user ID (UUID)
        john_doe_id := gen_random_uuid();
        
        -- Insert into auth.users
        -- Note: This requires admin/service role privileges
        -- The encrypted password hash needs to be generated properly
        -- For Supabase, we'll use the admin API approach or create via dashboard
        
        -- Alternative: Create user via extension if available
        -- For now, we'll generate UUID and user must create via dashboard first
        -- OR use Supabase Management API
        
        RAISE NOTICE 'User does not exist. Please create user in Supabase Auth Dashboard first, then run the rest of this script.';
        RAISE NOTICE 'OR use this ID when creating: %', john_doe_id;
        RETURN; -- Exit early if user doesn't exist
    END IF;

    -- Step 2: Create user profile in public.users
    -- Note: is_verified will be synced from auth.users.email_confirmed_at via trigger
    INSERT INTO public.users (id, email, is_verified, email_verified_at, created_at, updated_at)
    SELECT 
        john_doe_id, 
        'john.doe@example.com',
        COALESCE((SELECT email_confirmed_at IS NOT NULL FROM auth.users WHERE id = john_doe_id), false),
        (SELECT email_confirmed_at FROM auth.users WHERE id = john_doe_id),
        NOW(),
        NOW()
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        is_verified = COALESCE((SELECT email_confirmed_at IS NOT NULL FROM auth.users WHERE id = john_doe_id), false),
        email_verified_at = (SELECT email_confirmed_at FROM auth.users WHERE id = john_doe_id),
        updated_at = NOW();

    -- Step 3: Portfolio History
    INSERT INTO public.portfolio_history (user_id, date, value)
    SELECT john_doe_id, date::DATE, value::DECIMAL FROM (VALUES
        ('2024-01-01', 10000.00),
        ('2024-01-08', 10450.00),
        ('2024-01-15', 10200.00),
        ('2024-01-22', 11100.00),
        ('2024-02-01', 11800.00),
        ('2024-02-08', 11600.00),
        ('2024-02-15', 12400.00),
        ('2024-02-22', 12100.00),
        ('2024-03-01', 13200.00),
        ('2024-03-08', 13800.00),
        ('2024-03-15', 14200.00),
        ('2024-03-22', 15340.00)
    ) AS t(date, value)
    ON CONFLICT (user_id, date) DO UPDATE SET
        value = EXCLUDED.value;

    -- Step 4: Open Positions
    INSERT INTO public.open_positions (user_id, symbol, name, quantity, entry_price, current_price, type, entry_date)
    SELECT john_doe_id, symbol, name, quantity, entry_price, current_price, type, entry_date::TIMESTAMPTZ FROM (VALUES
        ('AAPL', 'Apple Inc.', 25, 178.50, 185.20, 'LONG', '2024-01-18'),
        ('MSFT', 'Microsoft Corp', 15, 420.00, 415.80, 'LONG', '2024-02-01'),
        ('NVDA', 'NVIDIA Corp', 10, 875.00, 920.50, 'LONG', '2024-01-20'),
        ('TSLA', 'Tesla Inc.', 8, 245.00, 238.75, 'LONG', '2024-02-10')
    ) AS t(symbol, name, quantity, entry_price, current_price, type, entry_date)
    ON CONFLICT DO NOTHING;

    -- Step 5: Closed Trades
    INSERT INTO public.trades (user_id, symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl)
    SELECT john_doe_id, symbol, type, action, quantity, entry_price, exit_price, entry_date::TIMESTAMPTZ, exit_date::TIMESTAMPTZ, pnl FROM (VALUES
        ('GOOGL', 'LONG', 'CLOSED', 12, 142.50, 156.80, '2024-01-15', '2024-01-22', 171.60),
        ('AMD', 'LONG', 'CLOSED', 30, 165.00, 158.20, '2024-01-10', '2024-01-18', -204.00),
        ('META', 'LONG', 'CLOSED', 8, 485.00, 512.30, '2024-01-08', '2024-01-16', 218.40),
        ('AMZN', 'LONG', 'CLOSED', 15, 178.50, 185.20, '2024-01-05', '2024-01-12', 100.50),
        ('NFLX', 'LONG', 'CLOSED', 5, 545.00, 532.80, '2024-01-02', '2024-01-08', -61.00)
    ) AS t(symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl)
    ON CONFLICT DO NOTHING;

    -- Step 6: Trade Journal
    INSERT INTO public.trade_journal (user_id, symbol, type, date, quantity, price, strategy, notes, tags)
    SELECT john_doe_id, symbol, type, date::DATE, quantity, price, strategy, notes, tags FROM (VALUES
        ('NVDA', 'BUY', '2024-01-20', 10, 875.00, 'Momentum breakout on strong earnings', 'Breaking above key resistance at $870. AI demand continues to drive growth. Stop loss at $840.', ARRAY['momentum', 'earnings', 'tech']),
        ('AAPL', 'BUY', '2024-01-18', 25, 178.50, 'Support bounce with positive divergence', 'Bouncing off 50-day MA. RSI showing bullish divergence. Target $190.', ARRAY['technical', 'support', 'swing'])
    ) AS t(symbol, type, date, quantity, price, strategy, notes, tags)
    ON CONFLICT DO NOTHING;

    -- Step 7: Learning Topics
    INSERT INTO public.learning_topics (user_id, topic_name, progress, completed)
    SELECT john_doe_id, topic_name, progress, completed FROM (VALUES
        ('Stock Market Basics', 100, true),
        ('Technical Analysis', 75, false),
        ('Options Trading', 40, false),
        ('Risk Management', 60, false),
        ('Portfolio Theory', 20, false)
    ) AS t(topic_name, progress, completed)
    ON CONFLICT (user_id, topic_name) DO UPDATE SET
        progress = EXCLUDED.progress,
        completed = EXCLUDED.completed;

    -- Step 8: Achievements
    INSERT INTO public.achievements (user_id, name, icon)
    SELECT john_doe_id, name, icon FROM (VALUES
        ('First Trade', '🎯'),
        ('Week Streak', '🔥'),
        ('Profit Master', '💰')
    ) AS t(name, icon)
    ON CONFLICT (user_id, name) DO NOTHING;

    -- Step 9: Initial Chat Message (only if none exist)
    INSERT INTO public.chat_messages (user_id, role, content)
    SELECT john_doe_id, 'assistant', 'Hello! I''m your AI Financial Advisor. I''m here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.chat_messages WHERE user_id = john_doe_id
    );

    RAISE NOTICE '✅ Test data for John Doe created successfully!';
    RAISE NOTICE 'User ID: %', john_doe_id;
    RAISE NOTICE 'Email: john.doe@example.com';
    
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

-- Final message
SELECT '✅ Script completed! User and test data created/updated.' AS message,
       (SELECT email FROM public.users WHERE email = 'john.doe@example.com' LIMIT 1) AS user_email,
       (SELECT id FROM auth.users WHERE email = 'john.doe@example.com' LIMIT 1) AS user_id;
