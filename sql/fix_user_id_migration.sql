-- =============================================================================
-- Migration: Fix user_id references after schema redesign
-- =============================================================================
-- PROBLEM: Some tables may still have user_id = auth.users.id (old schema)
-- instead of user_id = core.users.id (new schema).
--
-- This migration updates user_id columns in ai.* and academy.* tables
-- to use the correct core.users.id or academy.profiles.id values.
-- =============================================================================

-- Step 1: Fix ai.chats — update user_id from auth.id to core.users.id
-- Only updates rows where user_id matches an auth_id (meaning it's still the old value)
UPDATE ai.chats c
SET user_id = u.id
FROM core.users u
WHERE c.user_id = u.auth_id
  AND c.user_id != u.id;

-- Step 2: Fix ai.chat_messages — same correction
UPDATE ai.chat_messages cm
SET user_id = u.id
FROM core.users u
WHERE cm.user_id = u.auth_id
  AND cm.user_id != u.id;

-- Step 3: Fix old academy.profiles that used auth.id instead of core.users.id
-- This MUST run before the bulk INSERT in Step 4 so the legacy cleanup loop
-- can detect profiles keyed by auth_id before they're shadowed by new rows.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS old_profile_id, u.id AS new_profile_id, p.display_name
    FROM academy.profiles p
    JOIN core.users u ON p.id = u.auth_id
    WHERE p.id != u.id
  LOOP
    -- Create or update a profile with the correct core.users.id,
    -- preserving the display_name from the legacy profile.
    INSERT INTO academy.profiles (id, display_name)
    VALUES (r.new_profile_id, r.display_name)
    ON CONFLICT (id) DO UPDATE SET
      display_name = COALESCE(academy.profiles.display_name, EXCLUDED.display_name);

    -- Update all academy FK references from old (auth_id) to new (core.users.id)
    UPDATE academy.chat_sessions SET user_id = r.new_profile_id WHERE user_id = r.old_profile_id;
    UPDATE academy.quiz_attempts SET user_id = r.new_profile_id WHERE user_id = r.old_profile_id;
    UPDATE academy.user_lesson_progress SET user_id = r.new_profile_id WHERE user_id = r.old_profile_id;
    UPDATE academy.user_tier_enrollments SET user_id = r.new_profile_id WHERE user_id = r.old_profile_id;

    -- Remove the legacy profile keyed by auth_id
    DELETE FROM academy.profiles WHERE id = r.old_profile_id;
  END LOOP;
END $$;

-- Step 4: Ensure academy.profiles exist for all core.users
-- Now that legacy profiles are cleaned up, safe to bulk-insert missing ones.
-- The academy profile id should be core.users.id (not auth.users.id).
INSERT INTO academy.profiles (id, display_name)
SELECT
  u.id,
  CASE
    WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL
      THEN u.first_name || ' ' || u.last_name
    WHEN u.first_name IS NOT NULL
      THEN u.first_name
    ELSE NULL
  END
FROM core.users u
WHERE NOT EXISTS (
  SELECT 1 FROM academy.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name
WHERE academy.profiles.display_name IS NULL;

-- Step 5: Fix academy tables — update any remaining user_id from auth.id to core.users.id
-- This handles records that weren't covered by the Step 3 profile cleanup loop
-- (e.g., records where the old profile was already deleted but FKs still point to auth_id).

UPDATE academy.chat_sessions cs
SET user_id = u.id
FROM core.users u
WHERE cs.user_id = u.auth_id
  AND cs.user_id != u.id;

UPDATE academy.quiz_attempts qa
SET user_id = u.id
FROM core.users u
WHERE qa.user_id = u.auth_id
  AND qa.user_id != u.id;

UPDATE academy.user_lesson_progress ulp
SET user_id = u.id
FROM core.users u
WHERE ulp.user_id = u.auth_id
  AND ulp.user_id != u.id;

UPDATE academy.user_tier_enrollments ute
SET user_id = u.id
FROM core.users u
WHERE ute.user_id = u.auth_id
  AND ute.user_id != u.id;

-- Step 6: Fix trading tables if needed
UPDATE trading.open_positions op
SET user_id = u.id
FROM core.users u
WHERE op.user_id = u.auth_id
  AND op.user_id != u.id;

UPDATE trading.paper_trades pt
SET user_id = u.id
FROM core.users u
WHERE pt.user_id = u.auth_id
  AND pt.user_id != u.id;

UPDATE trading.paper_trade_closes ptc
SET user_id = u.id
FROM core.users u
WHERE ptc.user_id = u.auth_id
  AND ptc.user_id != u.id;

UPDATE trading.trades t
SET user_id = u.id
FROM core.users u
WHERE t.user_id = u.auth_id
  AND t.user_id != u.id;

UPDATE trading.trade_journal tj
SET user_id = u.id
FROM core.users u
WHERE tj.user_id = u.auth_id
  AND tj.user_id != u.id;

UPDATE trading.portfolio_history ph
SET user_id = u.id
FROM core.users u
WHERE ph.user_id = u.auth_id
  AND ph.user_id != u.id;

UPDATE core.achievements a
SET user_id = u.id
FROM core.users u
WHERE a.user_id = u.auth_id
  AND a.user_id != u.id;

-- Step 7: Fix learning_topics (legacy table in public schema)
-- Update user_id from auth.id to core.users.id
UPDATE public.learning_topics lt
SET user_id = u.id
FROM core.users u
WHERE lt.user_id = u.auth_id
  AND lt.user_id != u.id;

-- Fix learning_topics RLS to reference core.users instead of public.users
DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
CREATE POLICY "Users can view own learning topics"
ON public.learning_topics FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
CREATE POLICY "Users can insert own learning topics"
ON public.learning_topics FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;
CREATE POLICY "Users can update own learning topics"
ON public.learning_topics FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own learning topics" ON public.learning_topics;
CREATE POLICY "Users can delete own learning topics"
ON public.learning_topics FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
