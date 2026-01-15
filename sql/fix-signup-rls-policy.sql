-- Fix Signup Error: Add RLS Policy for User Creation
-- This fixes the "Database error saving new user" error
-- Run this in Supabase SQL Editor

-- Step 1: Ensure the trigger function exists and is correct
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

-- Step 2: Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 3: Add INSERT policy for users table (allows trigger to create user profiles)
-- This is the critical fix - RLS was blocking the trigger from inserting
DROP POLICY IF EXISTS "Service role can insert user profiles" ON public.users;

CREATE POLICY "Service role can insert user profiles" ON public.users
    FOR INSERT 
    WITH CHECK (true);

-- Step 4: Verify the setup
SELECT 
    '✅ Setup Complete' AS status,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created') AS trigger_exists,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'users' AND policyname = 'Service role can insert user profiles') AS insert_policy_exists;
