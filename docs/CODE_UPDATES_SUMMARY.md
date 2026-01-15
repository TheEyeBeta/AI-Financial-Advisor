# Code Updates Summary - New User ID Structure

## ✅ Changes Completed

### 1. Created User Helper Functions (`src/lib/user-helpers.ts`)
- `getUserProfile(authId)` - Get user profile by auth_id
- `getCurrentUserProfile()` - Get current user's profile
- `getCurrentUserId()` - Get current user's profile ID (not auth ID)

### 2. Updated `useAuth` Hook (`src/hooks/use-auth.ts`)
- Now fetches and caches user profile from `public.users`
- Returns:
  - `user` - Auth user (backward compatibility)
  - `userProfile` - User profile from `public.users`
  - `userId` - The actual user ID to use for foreign keys (profile.id)
  - All existing properties (loading, signIn, signUp, etc.)

### 3. Updated `getCurrentUserId` Helper (`src/lib/supabase.ts`)
- Now returns profile ID instead of auth ID
- Re-exports from `user-helpers.ts`

### 4. Updated SignUpDialog (`src/components/auth/SignUpDialog.tsx`)
- Removed manual upsert (trigger handles it automatically)
- Trigger uses `auth_id` to reference `auth.users(id)`

### 5. Updated All Data Hooks (`src/hooks/use-data.ts`)
- Changed from `user.id` to `userId` (from useAuth)
- All hooks now use the profile ID:
  - `usePortfolioHistory()`
  - `useOpenPositions()`
  - `useTrades()`
  - `useTradeJournal()`
  - `useChatMessages()`
  - `useLearningTopics()`
  - `useAchievements()`

### 6. Updated Advisor Page (`src/pages/Advisor.tsx`)
- Changed from `user.id` to `userId`
- Uses profile ID for chat messages

## 🔄 How It Works Now

### Before (Old Structure):
```typescript
const { user } = useAuth();
const userId = user.id; // This was auth.users.id
```

### After (New Structure):
```typescript
const { userId } = useAuth(); // This is public.users.id (independent)
// OR
const { userProfile } = useAuth();
const userId = userProfile?.id; // Same thing
```

## 📋 Migration Checklist

Before running the database migration, make sure:

- [x] Code updated to use new structure
- [x] Helper functions created
- [x] All hooks updated
- [x] All components updated
- [ ] Database migration run (`migrate-separate-user-id.sql`)
- [ ] RLS policies updated (`update-rls-policies-for-auth-id.sql`)
- [ ] Test signup flow
- [ ] Test login flow
- [ ] Test data queries

## 🎯 Key Points

1. **`userId` from useAuth** = `public.users.id` (use this for foreign keys)
2. **`user.id` from useAuth** = `auth.users.id` (auth ID, not for foreign keys)
3. **Trigger automatically creates profile** - no manual upsert needed
4. **All API services unchanged** - they still accept `userId` parameter
5. **Backward compatible** - `user` object still available for display

## 🚨 Important Notes

- The `userId` from `useAuth()` is now the profile ID, not the auth ID
- All foreign key relationships use `public.users.id`
- The trigger automatically creates the profile when a user signs up
- RLS policies need to be updated to use `auth_id` lookup
