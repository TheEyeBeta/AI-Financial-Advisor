# Migration Guide: Separate User ID from Auth ID

## What Changed

### Before:
- `public.users.id` = `auth.users.id` (same UUID)
- Direct foreign key relationship

### After:
- `public.users.id` = Auto-generated UUID (independent)
- `public.users.auth_id` = `auth.users.id` (references auth)
- Separate user ID from authentication ID

## Migration Steps

### 1. Run the Migration Script

**⚠️ IMPORTANT: Backup your database first!**

1. Go to Supabase SQL Editor: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
2. Run `migrate-separate-user-id.sql`
3. This will:
   - Create new table structure
   - Migrate existing data
   - Update all foreign keys
   - Update trigger functions

### 2. Update RLS Policies

Run `update-rls-policies-for-auth-id.sql` to update security policies.

### 3. Update Code

You'll need to update code that queries users. Here's what changes:

#### Getting User ID from Auth ID

**Before:**
```typescript
const user = await supabase.auth.getUser();
const userId = user.data.user?.id; // This was the user ID
```

**After:**
```typescript
const { data: { user: authUser } } = await supabase.auth.getUser();
if (!authUser) return;

// Get user profile by auth_id
const { data: userProfile } = await supabase
  .from('users')
  .select('id, auth_id, *')
  .eq('auth_id', authUser.id)
  .single();

const userId = userProfile?.id; // This is now the separate user ID
```

#### Helper Function (Recommended)

Create a helper to get user profile:

```typescript
// src/lib/user-helpers.ts
export async function getUserProfile() {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authUser.id)
    .single();

  return profile;
}
```

## Files That Need Updates

1. **`src/components/auth/SignUpDialog.tsx`**
   - Remove manual upsert (trigger handles it now)
   - Or update to use `auth_id` instead of `id`

2. **`src/pages/Advisor.tsx`**
   - Update `user.id` to get from user profile

3. **`src/hooks/use-data.ts`**
   - Update `user.id` references

## RLS Security

**Question: Is disabling RLS a security threat?**

**Answer: For a multi-user app, YES - keep RLS enabled!**

- ✅ **Keep RLS enabled** + use proper policies (recommended)
- ❌ **Disable RLS** = Users could access other users' data

The migration scripts include proper RLS policies that:
- Allow users to see only their own data
- Allow signup (trigger can insert)
- Protect all user data at database level

## New Schema Structure

```sql
public.users:
  id UUID PRIMARY KEY              -- Independent user ID
  auth_id UUID UNIQUE              -- References auth.users(id)
  first_name TEXT
  last_name TEXT
  email TEXT
  ... (other fields)

Other tables:
  user_id UUID                     -- References users.id (not auth_id)
```

## Benefits

1. ✅ User ID is independent of auth system
2. ✅ Can change auth provider without changing user IDs
3. ✅ Better separation of concerns
4. ✅ More flexible architecture

## Testing

After migration:
1. Test signup - should create user with new structure
2. Test login - should find user by auth_id
3. Test queries - should use new user.id for foreign keys
4. Verify RLS - users should only see their own data
