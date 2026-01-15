# Fix Database Population Issue

## 🔍 Problem
Users can log in, but the `public.users` table is not being populated.

## ✅ How User Creation Should Work

### Automatic (via Database Trigger):
1. User signs up/logs in → Supabase creates user in `auth.users`
2. Database trigger `on_auth_user_created` fires automatically
3. Trigger calls `handle_new_user()` function
4. Function creates row in `public.users` table
5. ✅ User profile is created automatically

### Manual (Fallback in Code):
- The code also tries to manually insert into `public.users` as a fallback
- But the trigger should handle this automatically

## 🚨 Quick Fix

### Step 1: Run Diagnostic Script

1. **Go to Supabase SQL Editor:**
   - https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new

2. **Copy and run `check-trigger-setup.sql`:**
   - This will check if triggers exist
   - Shows user counts in both tables
   - Shows if columns exist

3. **Review the results:**
   - If trigger doesn't exist → Go to Step 2
   - If users are missing → Go to Step 2
   - If everything looks good but still not working → Check Step 3

### Step 2: Fix the Trigger

1. **Run `fix-user-trigger.sql` in SQL Editor:**
   - This will recreate the trigger and function
   - Syncs any existing users
   - Verifies everything is working

2. **Verify it worked:**
   ```sql
   -- Check trigger exists and is enabled
   SELECT tgname, tgenabled 
   FROM pg_trigger 
   WHERE tgname = 'on_auth_user_created';
   -- Should show 'O' for enabled
   ```

### Step 3: Test User Creation

1. **Create a test user:**
   - Sign up with a new email in your app
   - OR create user in Supabase Auth Dashboard

2. **Check if user appears:**
   ```sql
   -- Check both tables
   SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;
   SELECT id, email FROM public.users ORDER BY created_at DESC LIMIT 1;
   ```

3. **If user appears in `auth.users` but not `public.users`:**
   - The trigger isn't firing
   - Check logs in Supabase Dashboard → Logs → Postgres Logs
   - Run `fix-user-trigger.sql` again

### Step 4: Sync Existing Users

If you have users in `auth.users` but not in `public.users`, run:

```sql
-- Sync all existing users
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
```

## 🔍 Common Issues

### Issue 1: Trigger Doesn't Exist

**Symptoms:**
- `check-trigger-setup.sql` shows no trigger
- Users exist in `auth.users` but not `public.users`

**Fix:**
- Run `fix-user-trigger.sql`
- This will create the trigger

### Issue 2: Trigger Exists But Disabled

**Symptoms:**
- Trigger exists but status shows "Disabled"

**Fix:**
```sql
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
```

### Issue 3: Function Has Errors

**Symptoms:**
- Trigger exists but doesn't fire
- Errors in Postgres logs

**Fix:**
- Run `fix-user-trigger.sql` to recreate function
- Check logs: Dashboard → Logs → Postgres Logs

### Issue 4: Columns Missing

**Symptoms:**
- Errors about missing columns (`name`, `experience_level`)

**Fix:**
- Run `migration-add-name-experience.sql` first
- Then run `fix-user-trigger.sql`

### Issue 5: RLS Blocking Inserts

**Symptoms:**
- Trigger fires but insert fails
- Permission denied errors

**Fix:**
- The function uses `SECURITY DEFINER` so it should bypass RLS
- But check RLS policies on `public.users` table:
  ```sql
  -- Check RLS policies
  SELECT * FROM pg_policies WHERE tablename = 'users';
  ```

## ✅ Verification Checklist

After running the fix:

- [ ] Trigger `on_auth_user_created` exists
- [ ] Trigger is enabled (status = 'O')
- [ ] Function `handle_new_user` exists
- [ ] User counts match (or close - existing users may differ)
- [ ] New users are created automatically
- [ ] Existing users are synced (if ran sync script)

## 📝 Next Steps

1. **Run `check-trigger-setup.sql`** - Diagnose the issue
2. **Run `fix-user-trigger.sql`** - Fix the trigger
3. **Test with a new user** - Verify it works
4. **Sync existing users** - If needed

## 🎯 Expected Result

After fixing:
1. ✅ New users automatically appear in `public.users`
2. ✅ Existing users can be synced
3. ✅ User profiles are created automatically
4. ✅ Login works and data loads correctly

## 📚 Related Files

- `supabase-schema.sql` - Full schema with triggers
- `fix-user-trigger.sql` - Quick fix script
- `check-trigger-setup.sql` - Diagnostic script
- `migration-add-name-experience.sql` - Add columns if missing
