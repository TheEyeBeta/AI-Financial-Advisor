-- =============================================================================
-- Fix RLS Policies for multi-schema architecture
-- =============================================================================
-- PROBLEM: RLS policies were created on public.* tables, but tables now live
-- in ai.*, core.*, trading.*, academy.* schemas.
-- The policies need to exist on the actual schema-qualified tables.
-- =============================================================================

-- ─── Helper function (if not already in the correct schema) ──────────────────

-- Ensure is_current_user_admin works across schemas
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.users
    WHERE auth_id = auth.uid()
      AND "userType" = 'Admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog;

-- ─── core.users RLS ──────────────────────────────────────────────────────────

ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view profiles" ON core.users;
CREATE POLICY "Users can view profiles"
ON core.users FOR SELECT
USING (
  auth_id = auth.uid()
  OR public.is_current_user_admin()
);

DROP POLICY IF EXISTS "Users can update profiles" ON core.users;
CREATE POLICY "Users can update profiles"
ON core.users FOR UPDATE
USING (
  -- Who can target a row for update:
  auth_id = auth.uid()              -- own row
  OR public.is_current_user_admin() -- or admin targets any row
)
WITH CHECK (
  -- What values are allowed to be written:
  (
    -- Regular users updating their own row: userType must remain unchanged.
    auth_id = auth.uid()
    AND NOT public.is_current_user_admin()
    AND "userType" = (SELECT "userType" FROM core.users WHERE auth_id = auth.uid())
  )
  OR
  -- Admins may change any column on any row.
  public.is_current_user_admin()
);

DROP POLICY IF EXISTS "Admins can delete users" ON core.users;
CREATE POLICY "Admins can delete users"
ON core.users FOR DELETE
USING (
  public.is_current_user_admin()
  AND auth_id != auth.uid()
);

-- No INSERT policy for authenticated/anon roles on core.users.
-- The handle_new_user() SECURITY DEFINER trigger handles all legitimate inserts.
-- The service_role key (used by backend/migrations) bypasses RLS entirely.
-- This matches the hardening done in harden_rls_policies.sql (FIX 2).
DROP POLICY IF EXISTS "Service role can insert user profiles" ON core.users;

-- ─── ai.chats RLS ───────────────────────────────────────────────────────────

ALTER TABLE ai.chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chats" ON ai.chats;
CREATE POLICY "Users can view own chats"
ON ai.chats FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own chats" ON ai.chats;
CREATE POLICY "Users can create own chats"
ON ai.chats FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own chats" ON ai.chats;
CREATE POLICY "Users can update own chats"
ON ai.chats FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own chats" ON ai.chats;
CREATE POLICY "Users can delete own chats"
ON ai.chats FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── ai.chat_messages RLS ────────────────────────────────────────────────────

ALTER TABLE ai.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chat messages" ON ai.chat_messages;
CREATE POLICY "Users can view own chat messages"
ON ai.chat_messages FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own chat messages" ON ai.chat_messages;
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

DROP POLICY IF EXISTS "Users can delete own chat messages" ON ai.chat_messages;
CREATE POLICY "Users can delete own chat messages"
ON ai.chat_messages FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.profiles RLS ────────────────────────────────────────────────────

ALTER TABLE academy.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own academy profile" ON academy.profiles;
CREATE POLICY "Users can view own academy profile"
ON academy.profiles FOR SELECT
USING (id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can upsert own academy profile" ON academy.profiles;
CREATE POLICY "Users can upsert own academy profile"
ON academy.profiles FOR INSERT
WITH CHECK (id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own academy profile" ON academy.profiles;
CREATE POLICY "Users can update own academy profile"
ON academy.profiles FOR UPDATE
USING (id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.chat_sessions RLS ───────────────────────────────────────────────

ALTER TABLE academy.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chat sessions" ON academy.chat_sessions;
CREATE POLICY "Users can view own chat sessions"
ON academy.chat_sessions FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own chat sessions" ON academy.chat_sessions;
CREATE POLICY "Users can create own chat sessions"
ON academy.chat_sessions FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.chat_messages RLS ───────────────────────────────────────────────

ALTER TABLE academy.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own academy chat messages" ON academy.chat_messages;
CREATE POLICY "Users can view own academy chat messages"
ON academy.chat_messages FOR SELECT
USING (session_id IN (
  SELECT cs.id FROM academy.chat_sessions cs
  JOIN core.users u ON cs.user_id = u.id
  WHERE u.auth_id = auth.uid()
));

DROP POLICY IF EXISTS "Users can insert own academy chat messages" ON academy.chat_messages;
CREATE POLICY "Users can insert own academy chat messages"
ON academy.chat_messages FOR INSERT
WITH CHECK (session_id IN (
  SELECT cs.id FROM academy.chat_sessions cs
  JOIN core.users u ON cs.user_id = u.id
  WHERE u.auth_id = auth.uid()
));

-- ─── academy.user_lesson_progress RLS ────────────────────────────────────────

ALTER TABLE academy.user_lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own lesson progress" ON academy.user_lesson_progress;
CREATE POLICY "Users can view own lesson progress"
ON academy.user_lesson_progress FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can upsert own lesson progress" ON academy.user_lesson_progress;
CREATE POLICY "Users can upsert own lesson progress"
ON academy.user_lesson_progress FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own lesson progress" ON academy.user_lesson_progress;
CREATE POLICY "Users can update own lesson progress"
ON academy.user_lesson_progress FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.user_tier_enrollments RLS ───────────────────────────────────────

ALTER TABLE academy.user_tier_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tier enrollments" ON academy.user_tier_enrollments;
CREATE POLICY "Users can view own tier enrollments"
ON academy.user_tier_enrollments FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can enroll in tiers" ON academy.user_tier_enrollments;
CREATE POLICY "Users can enroll in tiers"
ON academy.user_tier_enrollments FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own tier enrollments" ON academy.user_tier_enrollments;
CREATE POLICY "Users can update own tier enrollments"
ON academy.user_tier_enrollments FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.quiz_attempts RLS ───────────────────────────────────────────────

ALTER TABLE academy.quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quiz attempts" ON academy.quiz_attempts;
CREATE POLICY "Users can view own quiz attempts"
ON academy.quiz_attempts FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create quiz attempts" ON academy.quiz_attempts;
CREATE POLICY "Users can create quiz attempts"
ON academy.quiz_attempts FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own quiz attempts" ON academy.quiz_attempts;
CREATE POLICY "Users can delete own quiz attempts"
ON academy.quiz_attempts FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── academy.quiz_answers RLS ────────────────────────────────────────────────

ALTER TABLE academy.quiz_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quiz answers" ON academy.quiz_answers;
CREATE POLICY "Users can view own quiz answers"
ON academy.quiz_answers FOR SELECT
USING (attempt_id IN (
  SELECT qa.id FROM academy.quiz_attempts qa
  JOIN core.users u ON qa.user_id = u.id
  WHERE u.auth_id = auth.uid()
));

DROP POLICY IF EXISTS "Users can create quiz answers" ON academy.quiz_answers;
CREATE POLICY "Users can create quiz answers"
ON academy.quiz_answers FOR INSERT
WITH CHECK (attempt_id IN (
  SELECT qa.id FROM academy.quiz_attempts qa
  JOIN core.users u ON qa.user_id = u.id
  WHERE u.auth_id = auth.uid()
));

-- ─── Academy read-only tables (lessons, tiers, etc.) ─────────────────────────
-- These should be readable by all authenticated users

ALTER TABLE academy.tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view tiers" ON academy.tiers;
CREATE POLICY "Authenticated users can view tiers"
ON academy.tiers FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view lessons" ON academy.lessons;
CREATE POLICY "Authenticated users can view lessons"
ON academy.lessons FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.lesson_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view lesson sections" ON academy.lesson_sections;
CREATE POLICY "Authenticated users can view lesson sections"
ON academy.lesson_sections FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.lesson_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view lesson blocks" ON academy.lesson_blocks;
CREATE POLICY "Authenticated users can view lesson blocks"
ON academy.lesson_blocks FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.quizzes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view quizzes" ON academy.quizzes;
CREATE POLICY "Authenticated users can view quizzes"
ON academy.quizzes FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.quiz_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view quiz questions" ON academy.quiz_questions;
CREATE POLICY "Authenticated users can view quiz questions"
ON academy.quiz_questions FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.quiz_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view quiz options" ON academy.quiz_options;
CREATE POLICY "Authenticated users can view quiz options"
ON academy.quiz_options FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.prompt_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view prompt templates" ON academy.prompt_templates;
CREATE POLICY "Authenticated users can view prompt templates"
ON academy.prompt_templates FOR SELECT
USING (auth.uid() IS NOT NULL);

ALTER TABLE academy.lesson_prompt_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view lesson prompt links" ON academy.lesson_prompt_links;
CREATE POLICY "Authenticated users can view lesson prompt links"
ON academy.lesson_prompt_links FOR SELECT
USING (auth.uid() IS NOT NULL);

-- ─── trading schema RLS ──────────────────────────────────────────────────────

ALTER TABLE trading.open_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own positions" ON trading.open_positions;
CREATE POLICY "Users can manage own positions"
ON trading.open_positions FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE trading.trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own trades" ON trading.trades;
CREATE POLICY "Users can manage own trades"
ON trading.trades FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE trading.trade_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own trade journal" ON trading.trade_journal;
CREATE POLICY "Users can manage own trade journal"
ON trading.trade_journal FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE trading.paper_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own paper trades" ON trading.paper_trades;
CREATE POLICY "Users can manage own paper trades"
ON trading.paper_trades FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE trading.paper_trade_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own paper trade closes" ON trading.paper_trade_closes;
CREATE POLICY "Users can manage own paper trade closes"
ON trading.paper_trade_closes FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE trading.portfolio_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own portfolio history" ON trading.portfolio_history;
CREATE POLICY "Users can manage own portfolio history"
ON trading.portfolio_history FOR ALL
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ─── core.achievements RLS ───────────────────────────────────────────────────

ALTER TABLE core.achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own achievements" ON core.achievements;
CREATE POLICY "Users can view own achievements"
ON core.achievements FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can unlock achievements" ON core.achievements;
CREATE POLICY "Users can unlock achievements"
ON core.achievements FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
