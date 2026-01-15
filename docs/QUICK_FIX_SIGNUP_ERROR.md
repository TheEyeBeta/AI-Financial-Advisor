# Quick Fix for Signup 500 Error

## Problem
You're getting a 500 error on signup because:
- The code was updated for the NEW structure (with `auth_id`)
- But the database still has the OLD structure (where `id` = `auth.users.id`)
- The trigger function might be trying to use the wrong structure

## Solution: Choose One Path

### Option A: Quick Fix (Keep Old Structure for Now)
If you want signup to work **right now** without migrating:

1. **Run `fix-trigger-for-old-structure.sql`** in Supabase SQL Editor
   - This fixes the trigger to work with your current database structure
   - Signup will work immediately
   - You can migrate later when ready

2. **Revert code changes** (or keep them - they'll work after migration)

### Option B: Full Migration (Recommended)
If you want the new structure with separate user ID:

1. **Run `migrate-separate-user-id.sql`** first
2. **Run `update-rls-policies-for-auth-id.sql`** second
3. **Code is already updated** - should work after migration

## Quick Diagnostic

Run `check-database-structure.sql` to see:
- What columns exist in `users` table
- Whether `auth_id` column exists
- What the trigger function looks like

## Recommended: Quick Fix First

1. Run `fix-trigger-for-old-structure.sql` → Signup works now
2. Test signup/login
3. When ready, run full migration later
