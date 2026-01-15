# Google OAuth Setup Guide

This guide shows you how to set up Google sign-in/sign-up for your Advisor Ally application.

## ✅ What's Been Added

### Frontend Integration:
- ✅ Google sign-in button in UserAuth component
- ✅ Google sign-up option (same as sign-in)
- ✅ OAuth callback handler (`/auth/callback` route)
- ✅ Beautiful Google button with logo
- ✅ Both sign-in and sign-up dialogs support Google

## 🔧 Step-by-Step Setup

### Step 1: Create Google OAuth Credentials

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create a New Project (or use existing):**
   - Click "Select a project" → "New Project"
   - Name: `Advisor Ally` (or your choice)
   - Click "Create"

3. **Enable Google+ API:**
   - Go to "APIs & Services" → "Library"
   - Search for "Google+ API" or "People API"
   - Click "Enable"

4. **Create OAuth 2.0 Credentials:**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - If prompted, configure OAuth consent screen first:
     - User Type: "External" (unless you have Google Workspace)
     - App name: `Advisor Ally`
     - User support email: Your email
     - Developer contact: Your email
     - Click "Save and Continue"
     - Add scopes: `email`, `profile`, `openid`
     - Add test users (if app is in testing mode)
     - Click "Save and Continue"

5. **Create OAuth Client:**
   - Application type: "Web application"
   - Name: `Advisor Ally Web`
   - Authorized JavaScript origins:
     ```
     http://localhost:8080
     https://nsngzzbgankkxxxsdacb.supabase.co
     ```
     (Add your production domain later)
   - Authorized redirect URIs:
     ```
     https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback
     ```
   - Click "Create"

6. **Copy Credentials:**
   - Copy the **Client ID** (looks like: `xxxxx.apps.googleusercontent.com`)
   - Copy the **Client Secret** (if shown)
   - Save these securely

### Step 2: Configure Supabase

1. **Go to Supabase Dashboard:**
   - Open: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/providers
   - Or: Dashboard → Authentication → Providers

2. **Enable Google Provider:**
   - Find "Google" in the providers list
   - Click "Enable"

3. **Add OAuth Credentials:**
   - **Client ID (for OAuth)**: Paste your Google Client ID
   - **Client Secret (for OAuth)**: Paste your Google Client Secret
   - **Authorized Client IDs**: Leave empty (or add your client ID)
   - Click "Save"

4. **Configure Redirect URLs:**
   - Supabase automatically handles: `https://your-project.supabase.co/auth/v1/callback`
   - Make sure this matches your Google OAuth redirect URI

### Step 3: Update Site URL (Important!)

⚠️ **IMPORTANT:** You need to go to **Authentication** settings, NOT API settings!

1. **Go to Supabase Authentication Settings:**
   - **Method 1 (Recommended):** 
     - Click "Authentication" in the left sidebar (it has a key icon 🔑)
     - Then click "URL Configuration" at the top of the Authentication page
   - **Method 2:**
     - Dashboard → Authentication → URL Configuration
   - **Direct Link:** https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/url-configuration
   - ⚠️ **NOT** Settings → API (that's the wrong page - you'll see "Data API Settings" there)

2. **Update Site URL:**
   - Look for "Site URL" field (should be at the top of the page)
   - **Site URL**: `http://localhost:8080` (for development)
   - For production, change to your production URL
   - Click "Save" or the page should auto-save

3. **Add Redirect URLs:**
   - Look for "Redirect URLs" section (below Site URL)
   - Click "Add URL" or the input field
   - Add each URL one by one:
     ```
     http://localhost:8080/auth/callback
     ```
   - Click "Add URL" again and add:
     ```
     http://localhost:8080/**
     ```
   - (Optional) For production, add:
     ```
     https://your-production-domain.com/auth/callback
     ```
   - Make sure to save after adding URLs

### Step 4: Test Google Sign-In

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Open the app:**
   - Go to: http://localhost:8080

3. **Test Google Sign-In:**
   - Click "Sign In" (top right)
   - Click "Continue with Google"
   - You'll be redirected to Google
   - Sign in with your Google account
   - You'll be redirected back to `/auth/callback`
   - Then redirected to `/dashboard`
   - ✅ You're signed in!

## 📋 Configuration Checklist

- [ ] Google Cloud project created
- [ ] Google+ API or People API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth client ID created
- [ ] Authorized redirect URI added: `https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback`
- [ ] Google provider enabled in Supabase
- [ ] Client ID added to Supabase
- [ ] Client Secret added to Supabase
- [ ] Site URL set in Supabase
- [ ] Redirect URLs configured in Supabase
- [ ] Tested sign-in with Google

## 🎯 How It Works

1. **User clicks "Continue with Google"**
   - Frontend calls `signInWithGoogle()`
   - User redirected to Google sign-in page

2. **User signs in with Google**
   - Google authenticates the user
   - Google redirects back to Supabase callback URL

3. **Supabase processes OAuth**
   - Creates/updates user in `auth.users`
   - Creates session
   - Redirects to your app's `/auth/callback`

4. **Your app handles callback**
   - `AuthCallback` component gets session
   - Redirects user to dashboard
   - User is now signed in!

## 🔍 Troubleshooting

### Error: "redirect_uri_mismatch"
**Problem:** Redirect URI doesn't match Google OAuth settings

**Solution:**
1. Check Google Cloud Console → Credentials
2. Make sure redirect URI is exactly:
   ```
   https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback
   ```
3. No trailing slash, exact match required

### Error: "invalid_client"
**Problem:** Client ID or Secret is incorrect

**Solution:**
1. Verify Client ID in Supabase matches Google Cloud Console
2. Verify Client Secret matches (if required)
3. Make sure credentials are for the correct project

### Error: "access_denied"
**Problem:** User denied permission or app not authorized

**Solution:**
1. If app is in testing mode, add user email to test users list
2. Or publish OAuth consent screen
3. Make sure required scopes are added

### OAuth callback not working
**Problem:** Redirect not happening after Google sign-in

**Solution:**
1. Check Supabase Site URL is set correctly
2. Check Redirect URLs include `/auth/callback`
3. Verify `/auth/callback` route exists (already added)
4. Check browser console for errors

### User created but not authenticated
**Problem:** Session not established after OAuth

**Solution:**
1. Check `AuthCallback` component handles the callback correctly
2. Verify Supabase client is configured correctly
3. Check if email confirmation is required (can disable for testing)

## 🎨 UI Features

### Sign In Dialog:
- ✅ Google sign-in button (primary)
- ✅ Email/password sign-in (alternative)
- ✅ Separator between options

### Sign Up Dialog:
- ✅ Google sign-up button (primary)
- ✅ Email/password sign-up (alternative)
- ✅ Password confirmation
- ✅ Password validation (min 6 characters)

### User Menu (When Signed In):
- ✅ Shows user email
- ✅ Sign out option
- ✅ Account info

## 📝 Important Notes

1. **Email Verification:**
   - Google-authenticated users are automatically verified
   - `is_verified` will be `true` in `public.users`
   - No email confirmation needed for Google sign-in

2. **User Profile:**
   - User profile in `public.users` is created automatically via trigger
   - Email synced from Google account
   - `email_verified_at` set automatically

3. **Sessions:**
   - Sessions persist across page refreshes
   - Auto-refresh token handled by Supabase
   - Sign out clears session

4. **Development vs Production:**
   - Development: Use `http://localhost:8080`
   - Production: Update Site URL and Redirect URLs in both:
     - Google Cloud Console
     - Supabase Dashboard

## 🔒 Security

- ✅ OAuth credentials stored in Supabase (server-side)
- ✅ Client ID is public (safe to expose)
- ✅ Client Secret is server-side only (never in frontend)
- ✅ Redirect URIs must match exactly
- ✅ HTTPS required for production

## 🚀 Next Steps

After setting up Google OAuth:

1. ✅ Test sign-in with Google account
2. ✅ Test sign-up (creates new account)
3. ✅ Verify user profile is created in `public.users`
4. ✅ Test all features with Google-authenticated user
5. ✅ Set up production OAuth credentials when deploying

## 📚 References

- **Supabase Auth Docs**: https://supabase.com/docs/guides/auth/social-login/auth-google
- **Google OAuth Docs**: https://developers.google.com/identity/protocols/oauth2
- **Google Cloud Console**: https://console.cloud.google.com/

## ✅ Quick Setup Summary

1. **Google Cloud Console:**
   - Create project
   - Enable API
   - Create OAuth client
   - Add redirect URI: `https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback`

2. **Supabase Dashboard:**
   - Enable Google provider
   - Add Client ID and Secret
   - Set Site URL: `http://localhost:8080`
   - Add redirect URL: `http://localhost:8080/auth/callback`

3. **Test:**
   - Click "Continue with Google" in app
   - Sign in with Google
   - ✅ Done!

Enjoy Google OAuth! 🎉
