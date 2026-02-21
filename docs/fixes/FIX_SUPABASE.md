# Fix Supabase Configuration Error

## The Error

```
Uncaught Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
```

This happens because your `.env` file has placeholder values instead of real Supabase credentials.

## Quick Fix

### Option 1: Use Demo Mode (No Supabase Required)

The app will now work without Supabase! I've updated the code to handle missing configuration gracefully. The page should load now, but authentication features won't work.

### Option 2: Configure Supabase (Recommended for Full Features)

1. **Get your Supabase credentials:**
   - Go to https://supabase.com
   - Create a project (or use existing)
   - Go to Project Settings → API
   - Copy:
     - **Project URL** (looks like: `https://xxxxx.supabase.co`)
     - **anon/public key** (long JWT token)

2. **Update your `.env` file:**
   ```bash
   nano .env  # or use your preferred editor
   ```

   Replace the placeholder values:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXItcHJvamVjdC1pZCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQ1MTkyMDAwLCJleHAiOjE5NjA3NjgwMDB9.your-actual-key
   ```

3. **Restart the dev server:**
   ```bash
   # Stop current server (Ctrl+C)
   npm run dev
   ```

4. **Hard refresh browser:**
   - Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)

## What Changed

I've updated `src/lib/supabase.ts` to:
- ✅ Validate URL format before creating client
- ✅ Use a dummy client if Supabase is not configured
- ✅ Show helpful warning messages
- ✅ Allow the app to run without Supabase (demo mode)

## Current Status

**Without Supabase:**
- ✅ Landing page loads
- ✅ UI works
- ❌ Authentication disabled
- ❌ Database features disabled

**With Supabase:**
- ✅ Full functionality
- ✅ User authentication
- ✅ Database access
- ✅ All features enabled

## Test It

1. **Refresh your browser** (hard refresh: Ctrl+Shift+R)
2. **Check console** - should see warning instead of error
3. **Page should load** - you'll see the landing page

The error should be gone now! 🎉
