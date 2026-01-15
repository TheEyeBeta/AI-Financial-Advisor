-- COMPLETE SCRIPT: Creates John Doe user AND all test data
-- This script uses Supabase's auth.users table directly
-- 
-- IMPORTANT: This requires service role/admin privileges
-- Run this in Supabase SQL Editor (which has admin access)
--
-- If you get permission errors, you can:
-- 1. Create the user in Auth Dashboard first (see alternative script)
-- 2. Or use Supabase Management API (via Python/Node.js)

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
    john_doe_id UUID;
    user_password_hash TEXT;
    user_salt TEXT;
BEGIN
    -- Generate a new UUID for the user
    john_doe_id := gen_random_uuid();
    
    -- Check if user already exists
    IF EXISTS(SELECT 1 FROM auth.users WHERE email = 'john.doe@example.com') THEN
        -- Get existing user ID
        SELECT id INTO john_doe_id FROM auth.users WHERE email = 'john.doe@example.com' LIMIT 1;
        RAISE NOTICE 'User already exists with ID: %. Continuing with test data...', john_doe_id;
    ELSE
        -- Create password hash using bcrypt (Supabase's default)
        -- Password: TestPassword123!
        -- Note: In Supabase, we need to use their auth system properly
        -- For direct SQL insertion, we'll use a helper function or create via API
        
        -- Alternative approach: Use Supabase's built-in auth trigger
        -- For now, we'll create the user record manually (may not have password)
        -- Better to use Auth Dashboard or Management API
        
        RAISE NOTICE '⚠️  Cannot create auth.users directly via SQL for security reasons.';
        RAISE NOTICE 'Please create the user first via:';
        RAISE NOTICE '1. Supabase Auth Dashboard: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users';
        RAISE NOTICE '   - Email: john.doe@example.com';
        RAISE NOTICE '   - Password: TestPassword123!';
        RAISE NOTICE '2. Then run this script again, or use create-john-doe-user.sql';
        RAISE NOTICE '   (which will detect existing user and create test data)';
        
        RETURN; -- Exit if user doesn't exist
    END IF;

    -- Create user profile in public.users
    INSERT INTO public.users (id, email, created_at, updated_at)
    VALUES (john_doe_id, 'john.doe@example.com', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = NOW();

    -- Portfolio History (12 entries)
    INSERT INTO public.portfolio_history (user_id, date, value)
    SELECT john_doe_id, date::DATE, value::DECIMAL(12,2) FROM (VALUES
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
    ON CONFLICT (user_id, date) DO UPDATE SET value = EXCLUDED.value;

    -- Open Positions (4 positions)
    DELETE FROM public.open_positions WHERE user_id = john_doe_id;
    INSERT INTO public.open_positions (user_id, symbol, name, quantity, entry_price, current_price, type, entry_date)
    VALUES
        (john_doe_id, 'AAPL', 'Apple Inc.', 25, 178.50, 185.20, 'LONG', '2024-01-18'::TIMESTAMPTZ),
        (john_doe_id, 'MSFT', 'Microsoft Corp', 15, 420.00, 415.80, 'LONG', '2024-02-01'::TIMESTAMPTZ),
        (john_doe_id, 'NVDA', 'NVIDIA Corp', 10, 875.00, 920.50, 'LONG', '2024-01-20'::TIMESTAMPTZ),
        (john_doe_id, 'TSLA', 'Tesla Inc.', 8, 245.00, 238.75, 'LONG', '2024-02-10'::TIMESTAMPTZ);

    -- Closed Trades (5 trades)
    DELETE FROM public.trades WHERE user_id = john_doe_id AND action = 'CLOSED';
    INSERT INTO public.trades (user_id, symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl)
    VALUES
        (john_doe_id, 'GOOGL', 'LONG', 'CLOSED', 12, 142.50, 156.80, '2024-01-15'::TIMESTAMPTZ, '2024-01-22'::TIMESTAMPTZ, 171.60),
        (john_doe_id, 'AMD', 'LONG', 'CLOSED', 30, 165.00, 158.20, '2024-01-10'::TIMESTAMPTZ, '2024-01-18'::TIMESTAMPTZ, -204.00),
        (john_doe_id, 'META', 'LONG', 'CLOSED', 8, 485.00, 512.30, '2024-01-08'::TIMESTAMPTZ, '2024-01-16'::TIMESTAMPTZ, 218.40),
        (john_doe_id, 'AMZN', 'LONG', 'CLOSED', 15, 178.50, 185.20, '2024-01-05'::TIMESTAMPTZ, '2024-01-12'::TIMESTAMPTZ, 100.50),
        (john_doe_id, 'NFLX', 'LONG', 'CLOSED', 5, 545.00, 532.80, '2024-01-02'::TIMESTAMPTZ, '2024-01-08'::TIMESTAMPTZ, -61.00);

    -- Trade Journal (2 entries)
    DELETE FROM public.trade_journal WHERE user_id = john_doe_id;
    INSERT INTO public.trade_journal (user_id, symbol, type, date, quantity, price, strategy, notes, tags)
    VALUES
        (john_doe_id, 'NVDA', 'BUY', '2024-01-20'::DATE, 10, 875.00, 'Momentum breakout on strong earnings', 'Breaking above key resistance at $870. AI demand continues to drive growth. Stop loss at $840.', ARRAY['momentum', 'earnings', 'tech']),
        (john_doe_id, 'AAPL', 'BUY', '2024-01-18'::DATE, 25, 178.50, 'Support bounce with positive divergence', 'Bouncing off 50-day MA. RSI showing bullish divergence. Target $190.', ARRAY['technical', 'support', 'swing']);

    -- Learning Topics (5 topics)
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

    -- Achievements (3 achievements)
    INSERT INTO public.achievements (user_id, name, icon)
    SELECT john_doe_id, name, icon FROM (VALUES
        ('First Trade', '🎯'),
        ('Week Streak', '🔥'),
        ('Profit Master', '💰')
    ) AS t(name, icon)
    ON CONFLICT (user_id, name) DO NOTHING;

    -- Initial Chat Message
    INSERT INTO public.chat_messages (user_id, role, content)
    SELECT john_doe_id, 'assistant', 'Hello! I''m your AI Financial Advisor. I''m here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.chat_messages WHERE user_id = john_doe_id AND role = 'assistant' LIMIT 1
    );

    RAISE NOTICE '✅ All test data created successfully for user ID: %', john_doe_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
        RAISE NOTICE 'If you see permission errors, create the user in Auth Dashboard first.';
END $$;

-- Market Data (Public data)
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

-- Success message
SELECT 
    '✅ Script completed!' AS status,
    u.email AS user_email,
    u.id AS user_id,
    (SELECT COUNT(*) FROM public.portfolio_history WHERE user_id = u.id) AS portfolio_entries,
    (SELECT COUNT(*) FROM public.open_positions WHERE user_id = u.id) AS open_positions,
    (SELECT COUNT(*) FROM public.trades WHERE user_id = u.id) AS total_trades
FROM public.users u
WHERE u.email = 'john.doe@example.com'
LIMIT 1;
