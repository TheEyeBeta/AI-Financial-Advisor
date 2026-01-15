-- Diagnostic Script: Check if User Creation Triggers Are Set Up Correctly
-- Run this in Supabase SQL Editor to diagnose user creation issues

-- Step 1: Check if trigger exists
SELECT 
    'Trigger Check' as check_type,
    tgname as trigger_name,
    CASE tgenabled
        WHEN 'O' THEN 'Enabled ✅'
        WHEN 'D' THEN 'Disabled ❌'
        ELSE 'Unknown'
    END as status,
    tgrelid::regclass as table_name
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Step 2: Check if function exists
SELECT 
    'Function Check' as check_type,
    routine_name,
    routine_type,
    'Exists ✅' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'handle_new_user';

-- Step 3: Count users in both tables
SELECT 
    'User Count - auth.users' as source,
    COUNT(*) as count
FROM auth.users
UNION ALL
SELECT 
    'User Count - public.users',
    COUNT(*)
FROM public.users
UNION ALL
SELECT 
    'Users Missing from public.users',
    COUNT(*)
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL;

-- Step 4: Check if columns exist
SELECT 
    'Column Check' as check_type,
    column_name,
    data_type,
    'Exists ✅' as status
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 5: Check recent users (last 5)
SELECT 
    'Recent Users - auth.users' as source,
    id,
    email,
    email_confirmed_at IS NOT NULL as is_verified,
    created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 6: Check if they exist in public.users
-- First check what columns exist
DO $$
BEGIN
    -- Check if name column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'name'
    ) THEN
        -- If name exists, show full data
        RAISE NOTICE '✅ Columns exist - showing full user data';
    ELSE
        -- If name doesn't exist, show basic data
        RAISE NOTICE '⚠️  Columns name/experience_level missing - showing basic user data';
        RAISE NOTICE '⚠️  Run migration-add-name-experience.sql first!';
    END IF;
END $$;

-- Check recent users (will work even without name/experience_level columns)
SELECT 
    'Recent Users - public.users' as source,
    id,
    email,
    COALESCE(
        (SELECT column_name FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name' LIMIT 1),
        'name column missing'
    ) as name_status,
    is_verified,
    created_at
FROM public.users
ORDER BY created_at DESC
LIMIT 5;
