# Fix Your Current Schema

## 🔍 Your Current Schema Issues

Looking at your current `public.users` table, I found these issues:

1. ❌ **Has `password` column** - Passwords should NEVER be in `public.users` (security risk!)
2. ❌ **Missing `name` column** - Needed for user profiles
3. ❌ **Missing `experience_level` column** - Needed for sign-up flow
4. ❌ **Missing trigger** - No automatic user creation when users sign up

## ✅ Complete Fix

### Step 1: Run the Complete Fix Script

1. **Go to Supabase SQL Editor:**
   - https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new

2. **Copy and run `fix-users-table-complete.sql`:**
   - This will:
     - ✅ Remove the `password` column (security fix)
     - ✅ Add `name` column
     - ✅ Add `experience_level` column
     - ✅ Create the auto-create trigger
     - ✅ Sync existing users
     - ✅ Verify everything works

3. **Check the results:**
   - Should show "✅ Setup Complete!"
   - Should show user counts
   - Should show final table structure

### Step 2: Verify It Worked

Run this to verify:

```sql
-- Check table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;
```

**Expected columns (in order):**
- id
- email
- created_at
- updated_at
- is_verified ✅
- email_verified_at ✅
- name ✅ (newly added)
- experience_level ✅ (newly added)
- **NO password column** ✅ (removed)

### Step 3: Test User Creation

1. **Create a new user** (sign up in your app)
2. **Check if user appears automatically:**
   ```sql
   -- Check both tables
   SELECT COUNT(*) FROM auth.users;
   SELECT COUNT(*) FROM public.users;
   -- Should match (or close if you had existing users)
   ```

## 🔒 Security Note

**IMPORTANT:** The `password` column in `public.users` is a **security risk**:
- Passwords should ONLY be in `auth.users` (encrypted by Supabase)
- Never store passwords in `public.users`
- The fix script removes this column

## 📋 What the Fix Script Does

1. **Removes `password` column** - Security fix
2. **Adds `name` column** - For user profiles
3. **Adds `experience_level` column** - For sign-up flow
4. **Creates `handle_new_user()` function** - Auto-creates user profiles
5. **Creates `on_auth_user_created` trigger** - Fires when users sign up
6. **Creates email verification trigger** - Updates `is_verified
7. **Syncs existing users** - Adds any missing users from `auth.users`

## ✅ After Running the Fix

Your schema will be:
- ✅ Secure (no password in public table)
- ✅ Complete (has all required columns)
- ✅ Automatic (users created via trigger)
- ✅ Synced (existing users added)

## 🎯 Next Steps

1. Run `fix-users-table-complete.sql`
2. Verify the table structure
3. Test with a new user sign-up
4. Check that users appear in `public.users` automatically

Everything should work after this! 🎉
