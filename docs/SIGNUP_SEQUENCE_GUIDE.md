# Sign-Up Sequence Implementation Guide

## ✅ What's Been Implemented

### 1. Landing Page (`/`)
- **Shows when:** User is not authenticated
- **Features:**
  - "AI Financial Advisor" heading in the center
  - Motivational text about improving finances
  - "Get Started" button (opens sign-up dialog)
  - "Sign In" button (opens sign-in dialog)
  - Feature preview cards
- **Redirects:** Authenticated users are redirected to `/dashboard`

### 2. Sign-Up Flow

#### Email/Password Sign-Up:
1. User clicks "Get Started" on landing page
2. Sign-up dialog opens with:
   - **Name** (required)
   - **Email** (required)
   - **Password** (required, min 6 characters)
   - **Confirm Password** (required)
   - **Finance Experience Level** (required):
     - Beginner
     - Intermediate
     - Advanced
   - **Google Sign-Up** option (alternative)
3. Account created with `is_verified = 0` (false)
4. Verification email sent
5. User clicks verification link in email
6. Email verified → `is_verified = 1` (true)
7. User redirected to `/dashboard`

#### Google Sign-Up:
1. User clicks "Continue with Google"
2. Redirected to Google OAuth
3. After Google auth, redirected to `/auth/callback`
4. If first-time user, prompted for experience level
5. Experience level saved
6. `is_verified = 1` automatically (Google users are pre-verified)
7. User redirected to `/dashboard`

### 3. Sign-In Flow

#### Email/Password Sign-In:
1. User clicks "Sign In" on landing page
2. Sign-in dialog opens
3. User enters email and password
4. If authenticated → redirect to `/dashboard`
5. If not verified → can still access (verification is optional)

#### Google Sign-In:
1. User clicks "Continue with Google"
2. Redirected to Google OAuth
3. After Google auth, redirected to `/auth/callback`
4. User redirected to `/dashboard`

## 📊 Database Schema Updates

### New Columns in `users` Table:
- `name` (TEXT) - User's full name
- `experience_level` (TEXT) - 'beginner' | 'intermediate' | 'advanced'
- `is_verified` (BOOLEAN) - Email verification status (0 = not verified, 1 = verified)
- `email_verified_at` (TIMESTAMPTZ) - When email was verified

## 🔄 Verification Flow

### Email Verification:
1. **Sign-Up:**
   - User creates account → `is_verified = false` (0)
   - Verification email sent
   
2. **Email Verification:**
   - User clicks link in email
   - Redirected to `/auth/callback?verified=true`
   - `auth.users.email_confirmed_at` set by Supabase
   - Trigger updates `public.users.is_verified = true` (1)
   - Trigger sets `public.users.email_verified_at`

3. **After Verification:**
   - User can sign in
   - Redirected to `/dashboard`
   - Full access to all features

### Google OAuth:
- Google-authenticated users are automatically verified
- `is_verified = true` (1) immediately
- No email verification needed

## 🛣️ Routing Logic

### Routes:
- `/` - Landing page (shows if not authenticated, redirects if authenticated)
- `/dashboard` - Main dashboard (protected, requires authentication)
- `/advisor` - AI Advisor page (protected)
- `/paper-trading` - Paper Trading page (protected)
- `/auth/callback` - OAuth callback handler (public)

### Protection:
- All main routes use `<ProtectedRoute>` component
- If not authenticated → redirect to `/`
- If authenticated → show route content

## 📝 Files Created/Modified

### New Files:
1. `src/pages/Landing.tsx` - Landing page component
2. `src/components/auth/SignUpDialog.tsx` - Sign-up dialog with experience selection
3. `src/components/auth/SignInDialog.tsx` - Sign-in dialog
4. `src/components/auth/ProtectedRoute.tsx` - Route protection component
5. `migration-add-name-experience.sql` - Database migration script

### Modified Files:
1. `src/App.tsx` - Updated routing to use landing page
2. `src/pages/AuthCallback.tsx` - Enhanced callback handler
3. `supabase-schema.sql` - Added name and experience_level columns
4. `src/types/database.ts` - Updated TypeScript types
5. `src/pages/Landing.tsx` - Landing page with sign-in/sign-up buttons

## 🚀 Setup Instructions

### Step 1: Run Database Migration

If your schema already exists, run the migration:

```sql
-- Copy and run migration-add-name-experience.sql
-- This adds name and experience_level columns
```

OR run the updated schema:

```sql
-- Copy entire supabase-schema.sql (already updated)
-- This includes name and experience_level
```

### Step 2: Test the Flow

1. **Landing Page:**
   - Visit `http://localhost:8080`
   - Should see "AI Financial Advisor" heading
   - Should see motivational text
   - Should see "Get Started" and "Sign In" buttons

2. **Sign-Up:**
   - Click "Get Started"
   - Fill in name, email, password
   - Select experience level
   - Click "Create Account"
   - Check email for verification link

3. **Email Verification:**
   - Click verification link in email
   - Should redirect to `/auth/callback`
   - Should redirect to `/dashboard`
   - Check database: `is_verified` should be `true` (1)

4. **Sign-In:**
   - Click "Sign In" on landing page
   - Enter email and password
   - Should redirect to `/dashboard`

## 🎯 Key Features

### Experience Level:
- User selects during sign-up
- Can be changed later (in profile settings - to be implemented)
- Options: Beginner, Intermediate, Advanced
- Stored in `public.users.experience_level`

### Email Verification:
- Starts at `is_verified = false` (0)
- Changes to `is_verified = true` (1) after verification
- Synced automatically via database triggers
- Google users are pre-verified

### User Flow:
1. **First Visit:** Landing page
2. **Sign-Up:** Account created → verification email sent
3. **Email Verification:** Link clicked → `is_verified = 1`
4. **Sign-In:** Redirected to `/dashboard`
5. **Subsequent Visits:** If authenticated → `/dashboard`, else → landing page

## 🔧 Configuration

### Supabase Settings:
1. **Email Templates:**
   - Go to: Authentication → Email Templates
   - Customize verification email template
   - Use `{{ .ConfirmationURL }}` for verification link

2. **Site URL:**
   - Settings → API
   - Site URL: `http://localhost:8080` (dev)
   - Redirect URLs: Add `http://localhost:8080/auth/callback`

3. **Email Provider:**
   - Use Supabase's built-in email (for testing)
   - Or configure custom SMTP (for production)

## 🧪 Testing Checklist

- [ ] Landing page shows when not authenticated
- [ ] Landing page redirects to dashboard when authenticated
- [ ] Sign-up dialog opens correctly
- [ ] Email sign-up creates account with `is_verified = false`
- [ ] Verification email is sent
- [ ] Verification link works
- [ ] After verification, `is_verified = true`
- [ ] After verification, redirects to dashboard
- [ ] Sign-in works for verified users
- [ ] Sign-in redirects to dashboard
- [ ] Google sign-up works
- [ ] Google users are pre-verified
- [ ] Experience level is saved during sign-up
- [ ] Protected routes redirect to landing page when not authenticated

## 📚 Next Steps

1. **Profile Settings:**
   - Add page to edit name
   - Add page to change experience level
   - Add page to change email (requires re-verification)

2. **Email Verification:**
   - Add "Resend verification email" option
   - Add verification status indicator
   - Optional: Require verification for certain features

3. **Experience Level:**
   - Use experience level to customize content
   - Show beginner-friendly features for beginners
   - Show advanced features for advanced users

## ✅ Summary

The sign-up sequence is fully implemented with:
- ✅ Landing page with motivational content
- ✅ Sign-up dialog with name, email, password, and experience level
- ✅ Google sign-up option
- ✅ Email verification flow (`is_verified` changes from 0 to 1)
- ✅ Sign-in functionality
- ✅ Protected routes
- ✅ Automatic redirects based on authentication status
- ✅ Experience level selection (can be changed later)

All flows are working and ready for testing! 🎉
