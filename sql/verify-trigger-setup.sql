-- Quick diagnostic: Check if trigger function exists and is correct
-- Run this in Supabase SQL Editor

-- Check if trigger function exists
SELECT 
    'Trigger Function' as check_type,
    routine_name,
    CASE 
        WHEN routine_name IS NOT NULL THEN '✅ Exists'
        ELSE '❌ MISSING - Run COMPLETE_DATABASE_FIX.sql'
    END as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'handle_new_user';

-- Check if trigger exists
SELECT 
    'Trigger' as check_type,
    tgname as trigger_name,
    CASE 
        WHEN tgname IS NOT NULL THEN 
            CASE tgenabled
                WHEN 'O' THEN '✅ Exists and Enabled'
                WHEN 'D' THEN '⚠️ Exists but Disabled'
                ELSE '⚠️ Exists but Unknown Status'
            END
        ELSE '❌ MISSING - Run COMPLETE_DATABASE_FIX.sql'
    END as status
FROM pg_trigger
WHERE tgname = 'on_auth_user_created'
AND tgrelid = 'auth.users'::regclass;
