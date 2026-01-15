-- Fix User Creation Trigger
-- Run this if the trigger is missing or not working
-- This will recreate the trigger and function

-- Step 1: Create/Replace the function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile in public.users when auth user is created
    INSERT INTO public.users (id, email, name, experience_level, is_verified, email_verified_at, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'name')::TEXT, NULL),
        COALESCE((NEW.raw_user_meta_data->>'experience_level')::TEXT, 'beginner')::TEXT,
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.users.email),
        name = COALESCE(EXCLUDED.name, public.users.name),
        experience_level = COALESCE(EXCLUDED.experience_level, public.users.experience_level),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        email_verified_at = NEW.email_confirmed_at,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Drop existing trigger if it exists (to recreate it)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 3: Create the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 4: Verify trigger was created
SELECT 
    '✅ Trigger Created' as status,
    tgname as trigger_name,
    CASE tgenabled
        WHEN 'O' THEN 'Enabled ✅'
        WHEN 'D' THEN 'Disabled ❌'
        ELSE 'Unknown'
    END as status
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Step 5: Sync existing users (if any users exist in auth.users but not in public.users)
INSERT INTO public.users (id, email, name, experience_level, is_verified, email_verified_at, created_at, updated_at)
SELECT 
    au.id,
    au.email,
    COALESCE((au.raw_user_meta_data->>'name')::TEXT, NULL) as name,
    COALESCE((au.raw_user_meta_data->>'experience_level')::TEXT, 'beginner')::TEXT as experience_level,
    COALESCE(au.email_confirmed_at IS NOT NULL, false) as is_verified,
    au.email_confirmed_at,
    au.created_at,
    NOW()
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Success message
SELECT 
    '✅ Trigger setup complete! Users will now be automatically created in public.users when they sign up.' as status,
    (SELECT COUNT(*) FROM auth.users) as auth_users_count,
    (SELECT COUNT(*) FROM public.users) as public_users_count;
