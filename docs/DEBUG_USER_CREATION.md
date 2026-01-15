# Debugging User Creation Issues

## 🔍 Problem
Users are logging in but the `public.users` table is not being populated.

## ✅ How It Should Work

### Email/Password Sign-Up:
1. User signs up → `supabase.auth.signUp()` creates user in `auth.users`
2. Database trigger `on_auth_user_created` fires
3. Trigger calls `handle_new_user()` function
4. Function creates row in `public.users` table
5. User profile is created automatically

### Google OAuth Sign-In:
1. User signs in with Google → OAuth callback creates user in `auth.users`
2. Database trigger `on_auth_user_created` fires
3. Trigger calls `handle_new_user()` function
4. Function creates row in `public.users` table
5. User profile is created automatically

## 🔧 Troubleshooting Steps

### Step 1: Check if Trigger Exists

Run this in Supabase SQL Editor:

```sql
-- Check if trigger exists
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
```

**Expected:** Should return the trigger definition.

**If empty:** Trigger doesn't exist - run the schema migration.

### Step 2: Check if Function Exists

```sql
-- Check if function exists
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'handle_new_user';
```

**Expected:** Should return the function.

**If empty:** Function doesn't exist - run the schema migration.

### Step 3: Check Current Users

```sql
-- Check users in auth.users
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Check users in public.users
SELECT 
    id,
    email,
    name,
    experience_level,
    is_verified,
    created_at
FROM public.users
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** Both queries should return users (may differ in count if trigger isn't working).

**If `auth.users` has users but `public.users` is empty:** Trigger is not firing.

### Step 4: Test Trigger Manually

```sql
-- This should create a test entry (you'll need to replace with actual auth.users id)
-- First, get a user ID from auth.users
SELECT id FROM auth.users LIMIT 1;

-- Then manually insert (replace 'USER_ID_HERE' with actual ID)
INSERT INTO public.users (id, email, name, experience_level, is_verified, email_verified_at, created_at, updated_at)
SELECT 
    id,
    email,
    COALESCE((raw_user_meta_data->>'name')::TEXT, NULL) as name,
    COALESCE((raw_user_meta_data->>'experience_level')::TEXT, 'beginner')::TEXT as experience_level,
    COALESCE(email_confirmed_at IS NOT NULL, false) as is_verified,
    email_confirmed_at,
    created_at,
    NOW()
FROM auth.users
WHERE id = 'USER_ID_HERE'
ON CONFLICT (id) DO NOTHING;
```

### Step 5: Verify Trigger is Enabled

```sql
-- Check if trigger is enabled
SELECT 
    tgname as trigger_name,
    tgenabled as enabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';
```

**Expected:** `tgenabled` should be 'O' (enabled).

**If 'D' (disabled):** Enable it:
```sql
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
```

## 🚨 Common Issues & Fixes

### Issue 1: Trigger Doesn't Exist

**Symptoms:**
- `public.users` table is empty
- Users exist in `auth.users`
- No errors in logs

**Fix:**
Run the schema migration again:

```sql
-- Copy and run the handle_new_user function from supabase-schema.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
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

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
```

### Issue 2: Trigger Exists But Not Firing

**Symptoms:**
- Trigger exists in database
- Function exists
- But users aren't being created

**Possible Causes:**
1. RLS (Row Level Security) blocking the insert
2. Trigger is disabled
3. Function has errors

**Fix 1: Check RLS on users table**

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'users';

-- If rowsecurity is true, check policies
SELECT * FROM pg_policies WHERE tablename = 'users';
```

**Fix 2: Enable trigger explicitly**

```sql
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
```

**Fix 3: Check function for errors**

```sql
-- Try calling function manually (won't work, but will show errors)
-- Instead, check logs in Supabase dashboard
-- Go to: Logs → Postgres Logs
```

### Issue 3: Users Exist But Not Synced

**Symptoms:**
- Old users exist in `auth.users`
- `public.users` is empty or missing some users

**Fix:**
Manually sync existing users:

```sql
-- Sync all existing users
INSERT INTO public.users (id, email, name, experience_level, is_verified, email_verified_at, created_at, updated_at)
SELECT 
    id,
    email,
    COALESCE((raw_user_meta_data->>'name')::TEXT, NULL) as name,
    COALESCE((raw_user_meta_data->>'experience_level')::TEXT, 'beginner')::TEXT as experience_level,
    COALESCE(email_confirmed_at IS NOT NULL, false) as is_verified,
    email_confirmed_at,
    created_at,
    NOW()
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    experience_level = COALESCE(EXCLUDED.experience_level, public.users.experience_level),
    is_verified = COALESCE(EXCLUDED.is_verified, public.users.is_verified),
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = NOW();
```

### Issue 4: Schema Migration Not Run

**Symptoms:**
- `name` or `experience_level` columns don't exist
- Getting column errors

**Fix:**
Run the migration:

```sql
-- Run migration-add-name-experience.sql
-- Or check if columns exist:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users';
```

Expected columns:
- id
- email
- name
- experience_level
- is_verified
- email_verified_at
- created_at
- updated_at

## 🔍 Quick Diagnostic Query

Run this to get a full picture:

```sql
-- Full diagnostic
SELECT 
    'auth.users count' as source,
    COUNT(*) as count
FROM auth.users
UNION ALL
SELECT 
    'public.users count',
    COUNT(*)
FROM public.users
UNION ALL
SELECT 
    'users missing from public',
    COUNT(*)
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL;

-- Check trigger
SELECT 
    tgname,
    CASE tgenabled
        WHEN 'O' THEN 'Enabled'
        WHEN 'D' THEN 'Disabled'
        ELSE 'Unknown'
    END as status
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Check function
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'handle_new_user';
```

## ✅ Expected Behavior After Fix

1. User signs up/logs in
2. User appears in `auth.users` (automatic by Supabase)
3. Within seconds, user appears in `public.users` (via trigger)
4. User can access the app with their profile data

## 📝 Next Steps

1. Run diagnostic queries above
2. Identify which issue you're experiencing
3. Apply the appropriate fix
4. Test by creating a new user
5. Verify user appears in both tables
