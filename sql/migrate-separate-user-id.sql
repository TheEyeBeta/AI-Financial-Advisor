-- Migration: Separate User ID from Auth ID
-- This restructures the users table to have:
-- - id: Auto-generated UUID (primary key, independent of auth)
-- - auth_id: References auth.users(id) (for authentication)
--
-- IMPORTANT: This is a breaking change. Run this carefully.

-- Step 1: Create new structure (we'll migrate data)
-- First, let's check if we need to backup data
DO $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM public.users;
    RAISE NOTICE 'Found % users to migrate', user_count;
END $$;

-- Step 2: Drop foreign key constraints from other tables temporarily
-- We'll recreate them after restructuring
ALTER TABLE IF EXISTS public.portfolio_history 
    DROP CONSTRAINT IF EXISTS portfolio_history_user_id_fkey;

ALTER TABLE IF EXISTS public.open_positions 
    DROP CONSTRAINT IF EXISTS open_positions_user_id_fkey;

ALTER TABLE IF EXISTS public.trades 
    DROP CONSTRAINT IF EXISTS trades_user_id_fkey;

ALTER TABLE IF EXISTS public.trade_journal 
    DROP CONSTRAINT IF EXISTS trade_journal_user_id_fkey;

ALTER TABLE IF EXISTS public.chat_messages 
    DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey;

ALTER TABLE IF EXISTS public.learning_topics 
    DROP CONSTRAINT IF EXISTS learning_topics_user_id_fkey;

ALTER TABLE IF EXISTS public.achievements 
    DROP CONSTRAINT IF EXISTS achievements_user_id_fkey;

-- Step 3: Create temporary table with new structure
CREATE TABLE IF NOT EXISTS public.users_new (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    age INTEGER CHECK (age >= 13 AND age <= 150),
    email TEXT,
    experience_level experience_level_enum DEFAULT 'beginner',
    risk_level risk_level_enum DEFAULT 'mid',
    is_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Migrate existing data (if any)
-- Create mapping: old_id (auth_id) -> new_id
INSERT INTO public.users_new (id, auth_id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, created_at, updated_at)
SELECT 
    uuid_generate_v4() as id,  -- New independent ID
    id as auth_id,              -- Old ID becomes auth_id
    first_name,
    last_name,
    age,
    email,
    experience_level,
    risk_level,
    is_verified,
    email_verified_at,
    created_at,
    updated_at
FROM public.users
ON CONFLICT (auth_id) DO NOTHING;

-- Step 5: Create mapping table for foreign key updates
CREATE TEMP TABLE user_id_mapping AS
SELECT 
    u.id as old_id,
    u_new.id as new_id
FROM public.users u
JOIN public.users_new u_new ON u.id = u_new.auth_id;

-- Step 6: Update foreign keys in other tables
UPDATE public.portfolio_history ph
SET user_id = um.new_id
FROM user_id_mapping um
WHERE ph.user_id = um.old_id;

UPDATE public.open_positions op
SET user_id = um.new_id
FROM user_id_mapping um
WHERE op.user_id = um.old_id;

UPDATE public.trades t
SET user_id = um.new_id
FROM user_id_mapping um
WHERE t.user_id = um.old_id;

UPDATE public.trade_journal tj
SET user_id = um.new_id
FROM user_id_mapping um
WHERE tj.user_id = um.old_id;

UPDATE public.chat_messages cm
SET user_id = um.new_id
FROM user_id_mapping um
WHERE cm.user_id = um.old_id;

UPDATE public.learning_topics lt
SET user_id = um.new_id
FROM user_id_mapping um
WHERE lt.user_id = um.old_id;

UPDATE public.achievements a
SET user_id = um.new_id
FROM user_id_mapping um
WHERE a.user_id = um.old_id;

-- Step 7: Drop old table and rename new one
DROP TABLE IF EXISTS public.users CASCADE;
ALTER TABLE public.users_new RENAME TO users;

-- Step 8: Recreate foreign key constraints
ALTER TABLE public.portfolio_history 
    ADD CONSTRAINT portfolio_history_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.open_positions 
    ADD CONSTRAINT open_positions_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.trades 
    ADD CONSTRAINT trades_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.trade_journal 
    ADD CONSTRAINT trade_journal_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.chat_messages 
    ADD CONSTRAINT chat_messages_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.learning_topics 
    ADD CONSTRAINT learning_topics_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.achievements 
    ADD CONSTRAINT achievements_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Step 9: Create indexes
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Step 10: Update trigger function to use auth_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile in public.users when auth user is created
    INSERT INTO public.users (auth_id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, created_at, updated_at)
    VALUES (
        NEW.id,  -- auth_id references auth.users(id)
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
    ON CONFLICT (auth_id) DO UPDATE SET
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

-- Step 11: Update email verification trigger
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
        WHERE auth_id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 12: Verify migration
SELECT 
    '✅ Migration Complete' AS status,
    (SELECT COUNT(*) FROM public.users) AS total_users,
    (SELECT COUNT(*) FROM public.users WHERE auth_id IS NOT NULL) AS users_with_auth_id;
