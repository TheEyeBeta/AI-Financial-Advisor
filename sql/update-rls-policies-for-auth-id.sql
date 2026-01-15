-- Update RLS Policies for New Schema (auth_id instead of id)
-- Run this AFTER running migrate-separate-user-id.sql

-- Step 1: Drop old policies (if they exist)
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Service role can insert user profiles" ON public.users;

-- Step 2: Create new policies using auth_id
-- Users can only see their own profile (matching auth_id to their auth.uid())
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth_id = auth.uid());

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth_id = auth.uid());

-- Allow trigger/service role to insert new user profiles (for signup)
CREATE POLICY "Service role can insert user profiles" ON public.users
    FOR INSERT WITH CHECK (true);

-- Step 3: Update policies for other tables to use auth_id lookup
-- Portfolio History
DROP POLICY IF EXISTS "Users can view own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can insert own portfolio history" ON public.portfolio_history;
DROP POLICY IF EXISTS "Users can update own portfolio history" ON public.portfolio_history;

CREATE POLICY "Users can view own portfolio history" ON public.portfolio_history
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own portfolio history" ON public.portfolio_history
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can update own portfolio history" ON public.portfolio_history
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Open Positions
DROP POLICY IF EXISTS "Users can view own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.open_positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON public.open_positions;

CREATE POLICY "Users can view own positions" ON public.open_positions
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own positions" ON public.open_positions
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can update own positions" ON public.open_positions
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can delete own positions" ON public.open_positions
    FOR DELETE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Trades
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;

CREATE POLICY "Users can view own trades" ON public.trades
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own trades" ON public.trades
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can update own trades" ON public.trades
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Trade Journal
DROP POLICY IF EXISTS "Users can view own journal" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can update own journal entries" ON public.trade_journal;
DROP POLICY IF EXISTS "Users can delete own journal entries" ON public.trade_journal;

CREATE POLICY "Users can view own journal" ON public.trade_journal
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own journal entries" ON public.trade_journal
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can update own journal entries" ON public.trade_journal
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can delete own journal entries" ON public.trade_journal
    FOR DELETE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Chat Messages
DROP POLICY IF EXISTS "Users can view own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON public.chat_messages;

CREATE POLICY "Users can view own messages" ON public.chat_messages
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own messages" ON public.chat_messages
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Learning Topics
DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;

CREATE POLICY "Users can view own learning topics" ON public.learning_topics
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own learning topics" ON public.learning_topics
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can update own learning topics" ON public.learning_topics
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Achievements
DROP POLICY IF EXISTS "Users can view own achievements" ON public.achievements;
DROP POLICY IF EXISTS "Users can insert own achievements" ON public.achievements;

CREATE POLICY "Users can view own achievements" ON public.achievements
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

CREATE POLICY "Users can insert own achievements" ON public.achievements
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- Success message
SELECT '✅ RLS policies updated for new auth_id structure!' AS status;
