# User Authentication Schema Updates

## ✅ Changes Made

### 1. Added Email Verification Columns to `public.users`

**New Columns:**
- `is_verified` (BOOLEAN) - Whether the user's email is verified
- `email_verified_at` (TIMESTAMPTZ) - Timestamp when email was verified

### 2. Automatic Sync with `auth.users`

**Triggers Created:**
- `on_auth_user_created` - Automatically creates/updates `public.users` when `auth.users` changes
- `on_email_verified` - Automatically updates `is_verified` when email is confirmed

## 📊 Schema Structure

### How It Works

1. **Password Authentication:**
   - ✅ Handled by Supabase's built-in `auth.users` table
   - ✅ Passwords are hashed and stored securely in `auth.users.encrypted_password`
   - ✅ Password authentication via `supabase.auth.signInWithPassword()`

2. **Email Verification:**
   - ✅ Tracked in `auth.users.email_confirmed_at` (Supabase built-in)
   - ✅ Synced to `public.users.is_verified` via trigger
   - ✅ Also stored in `public.users.email_verified_at` for easy querying

3. **Automatic Sync:**
   - When a user is created in `auth.users` → `public.users` profile is created
   - When email is verified → `is_verified` is automatically set to `true`
   - All updates happen automatically via database triggers

## 🔄 Database Tables

### `auth.users` (Supabase Built-in)
```sql
- id (UUID)
- email (TEXT)
- encrypted_password (TEXT) - Hashed password
- email_confirmed_at (TIMESTAMPTZ) - When email was verified
- created_at (TIMESTAMPTZ)
- ... other auth fields
```

### `public.users` (Your Extension Table)
```sql
- id (UUID) - References auth.users(id)
- email (TEXT) - Synced from auth.users
- is_verified (BOOLEAN) - Email verification status
- email_verified_at (TIMESTAMPTZ) - When email was verified
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

## 🚀 Migration Instructions

### If Schema Already Exists:

**Run the migration script:**
```sql
-- Copy and run migration-add-user-verification.sql
-- This will:
-- 1. Add new columns to existing users table
-- 2. Sync existing users with auth.users
-- 3. Create triggers for automatic sync
```

### If Starting Fresh:

**Run the updated schema:**
```sql
-- Run supabase-schema.sql (updated with verification columns)
-- Triggers are included automatically
```

## 📝 Usage in Code

### Check if User is Verified

```typescript
// Using the API
const { data: user } = await supabase
  .from('users')
  .select('is_verified, email_verified_at')
  .eq('id', userId)
  .single();

if (user?.is_verified) {
  // User's email is verified
}
```

### Query Only Verified Users

```typescript
const { data: verifiedUsers } = await supabase
  .from('users')
  .select('*')
  .eq('is_verified', true);
```

### Check Verification in Components

```typescript
const { user } = useAuth();
const { data: userProfile } = useQuery({
  queryKey: ['user-profile', user?.id],
  queryFn: () => supabase
    .from('users')
    .select('is_verified, email_verified_at')
    .eq('id', user!.id)
    .single()
});

if (userProfile?.data?.is_verified) {
  // Show verified badge, enable features, etc.
}
```

## 🔒 Security Notes

1. **Password Storage:**
   - ✅ Never stored in `public.users`
   - ✅ Only in `auth.users.encrypted_password` (Supabase managed)
   - ✅ Never accessible via SQL queries

2. **Authentication:**
   - ✅ Handled by Supabase Auth
   - ✅ Use `supabase.auth.signInWithPassword()` for login
   - ✅ Use `supabase.auth.signUp()` for registration

3. **Email Verification:**
   - ✅ Automatically synced from `auth.users`
   - ✅ Triggers ensure data consistency
   - ✅ `is_verified` reflects actual verification status

## 🧪 Testing

### Verify User Creation

```sql
-- Check user in auth.users
SELECT id, email, email_confirmed_at 
FROM auth.users 
WHERE email = 'john.doe@example.com';

-- Check user profile in public.users
SELECT id, email, is_verified, email_verified_at 
FROM public.users 
WHERE email = 'john.doe@example.com';
```

### Test Email Verification Sync

```sql
-- Manually verify email in auth.users (for testing)
UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email = 'john.doe@example.com';

-- Check if public.users was updated automatically
SELECT is_verified, email_verified_at 
FROM public.users 
WHERE email = 'john.doe@example.com';
-- Should show is_verified = true
```

## 📋 Migration Checklist

- [ ] Run `migration-add-user-verification.sql` (if schema exists)
- [ ] OR run updated `supabase-schema.sql` (if starting fresh)
- [ ] Verify columns were added: `is_verified`, `email_verified_at`
- [ ] Verify triggers were created: `on_auth_user_created`, `on_email_verified`
- [ ] Test user creation - should auto-sync to `public.users`
- [ ] Test email verification - should auto-update `is_verified`
- [ ] Update TypeScript types (already done in `src/types/database.ts`)

## 🔧 Troubleshooting

### Columns not appearing
- Check if migration script ran successfully
- Verify in Supabase Table Editor
- Run migration script again (it's idempotent)

### Verification status not syncing
- Check if triggers exist: `SELECT * FROM pg_trigger WHERE tgname LIKE '%email%';`
- Verify functions exist: `SELECT * FROM pg_proc WHERE proname LIKE '%handle%';`
- Check trigger logs in Supabase

### TypeScript errors
- Update types in `src/types/database.ts` (already updated)
- Restart TypeScript server in your IDE
- Clear build cache if needed

## ✅ Benefits

1. **Easy Querying:**
   - Query `is_verified` directly in `public.users`
   - No need to join with `auth.users`

2. **Automatic Sync:**
   - Verification status stays in sync automatically
   - No manual updates needed

3. **Type Safety:**
   - TypeScript types include new fields
   - Full type checking support

4. **Backward Compatible:**
   - Migration script is idempotent
   - Safe to run multiple times
   - Existing data preserved
