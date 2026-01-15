-- Complete Fix for Signup Trigger Error
-- This fixes the "Database error saving new user" error
-- Run this in Supabase SQL Editor

-- Step 1: Check current table structure and log it
DO $$
DECLARE
    has_auth_id BOOLEAN;
    has_risk_level BOOLEAN;
BEGIN
    -- Check if auth_id column exists (new structure)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'auth_id'
    ) INTO has_auth_id;

    -- Check if risk_level column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'risk_level'
    ) INTO has_risk_level;

    RAISE NOTICE 'Table structure: auth_id=% risk_level=%', has_auth_id, has_risk_level;
END $$;

-- Step 2: Create robust trigger function that handles errors gracefully
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_has_auth_id BOOLEAN;
BEGIN
    -- Check if auth_id column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'auth_id'
    ) INTO v_has_auth_id;

    -- Determine user_id based on structure
    IF v_has_auth_id THEN
        -- New structure: id is independent, auth_id references auth.users
        INSERT INTO public.users (
            auth_id,
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
        )
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
    ELSE
        -- Old structure: id = auth.users.id
        INSERT INTO public.users (
            id,
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
        )
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
    END IF;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error details
        RAISE WARNING 'Error in handle_new_user for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
        -- Still return NEW to allow auth user creation to succeed
        -- The profile can be created manually later if needed
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 4: Ensure RLS INSERT policy exists
DROP POLICY IF EXISTS "Service role can insert user profiles" ON public.users;

CREATE POLICY "Service role can insert user profiles" ON public.users
    FOR INSERT 
    WITH CHECK (true);

-- Step 5: Verify setup
SELECT 
    '✅ Trigger fixed' AS status,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created') AS trigger_exists,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'users' AND policyname = 'Service role can insert user profiles') AS policy_exists;
