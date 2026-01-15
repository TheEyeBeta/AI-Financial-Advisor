# Fix Missing Columns First

## ❌ Error You're Seeing

```
ERROR: 42703: column "name" does not exist
```

## 🔍 Problem

The `public.users` table is missing the `name` and `experience_level` columns that were added in recent updates.

## ✅ Solution: Add Missing Columns First

### Step 1: Run the Migration Script

1. **Go to Supabase SQL Editor:**
   - https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new

2. **Copy and run `migration-add-name-experience.sql`:**
   - This adds the `name` and `experience_level` columns
   - Safe to run multiple times (idempotent)
   - Won't break if columns already exist

3. **Verify columns were added:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_schema = 'public' 
   AND table_name = 'users'
   ORDER BY ordinal_position;
   ```
   
   **Expected columns:**
   - id
   - email
   - name ✅ (should exist after migration)
   - experience_level ✅ (should exist after migration)
   - is_verified
   - email_verified_at
   - created_at
   - updated_at

### Step 2: Run Diagnostic Script (Safe Version)

1. **Run `check-trigger-setup-safe.sql`:**
   - This version works even if columns are missing
   - Shows what's missing
   - Safer diagnostic

### Step 3: Fix the Trigger

1. **Run `fix-user-trigger.sql`:**
   - This creates/recreates the trigger
   - Syncs existing users
   - Works with the new columns

## 📋 Quick Checklist

- [ ] Run `migration-add-name-experience.sql` first
- [ ] Verify columns exist
- [ ] Run `check-trigger-setup-safe.sql` to diagnose
- [ ] Run `fix-user-trigger.sql` to fix trigger
- [ ] Test with a new user

## 🎯 What Happened

The schema was updated to include:
- `name` column (user's full name)
- `experience_level` column (beginner/intermediate/advanced)

But your database doesn't have these columns yet. You need to run the migration script first before the trigger can work properly.

## ✅ After Adding Columns

Once you've added the columns:
1. ✅ Diagnostic scripts will work
2. ✅ Trigger will work correctly
3. ✅ New users will have name and experience_level
4. ✅ Everything will function properly

Run `migration-add-name-experience.sql` first, then proceed with the other scripts!
