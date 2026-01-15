# Google OAuth Configuration - Quick Setup

## 🔑 Your Google OAuth Credentials

**Client ID:**
```
274606712059-3puslr3hvqsdj0lngpv01n358u59r5b0.apps.googleusercontent.com
```

**Client Secret:**
```
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
```

## ✅ Step-by-Step Configuration

### Step 1: Configure Google Cloud Console

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/apis/credentials
   - Sign in with your Google account

2. **Find Your OAuth Client:**
   - Look for Client ID: `274606712059-3puslr3hvqsdj0lngpv01n358u59r5b0`
   - Click on it to edit

3. **Configure Authorized Redirect URIs:**
   - Click "Edit" on your OAuth client
   - Under "Authorized redirect URIs", add:
     ```
     https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback
     ```
   - Click "Save"

4. **Verify Authorized JavaScript Origins:**
   - Under "Authorized JavaScript origins", add:
     ```
     http://localhost:8080
     https://nsngzzbgankkxxxsdacb.supabase.co
     ```
   - Click "Save"

### Step 2: Configure Supabase (Google Provider)

1. **Go to Supabase Dashboard:**
   - Visit: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/providers
   - Or: Dashboard → Authentication → Providers (left sidebar, key icon 🔑)

2. **Enable Google Provider:**
   - Find "Google" in the providers list
   - Toggle "Enable Google provider" to ON

3. **Add OAuth Credentials:**
   - **Client ID (for OAuth)**: 
     ```
     274606712059-3puslr3hvqsdj0lngpv01n358u59r5b0.apps.googleusercontent.com
     ```
   - **Client Secret (for OAuth)**: 
     ```
     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
     ```
   - Click "Save"

### Step 3: Configure Site URL and Redirect URLs ⚠️ IMPORTANT

⚠️ **YOU NEED TO GO TO AUTHENTICATION SETTINGS, NOT API SETTINGS!**

1. **Go to Supabase Authentication URL Configuration:**
   - **Click "Authentication" in the left sidebar** (has a key icon 🔑)
   - **Then click "URL Configuration"** at the top of the Authentication page
   - **Direct Link:** https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/url-configuration
   
   ⚠️ **DO NOT go to:** Settings → API (that shows "Data API Settings" - wrong page!)

2. **Update Site URL:**
   - Look for "Site URL" field at the top
   - **Site URL:** `http://localhost:8080`
   - Click "Save" (or it auto-saves)

3. **Add Redirect URLs:**
   - Look for "Redirect URLs" section
   - Click "Add URL" button
   - Add: `http://localhost:8080/auth/callback`
   - Click "Add URL" again
   - Add: `http://localhost:8080/**`
   - Click "Save"

## 🧪 Testing

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Open the app:**
   - Go to: http://localhost:8080

3. **Test Google Sign-In:**
   - Click "Sign In" (top right or on landing page)
   - Click "Continue with Google"
   - You'll be redirected to Google
   - Sign in with your Google account
   - You'll be redirected back to the app
   - ✅ You should be signed in!

## 🔒 Security Notes

- ⚠️ **Never commit credentials to Git**
- ✅ Credentials are stored securely in Supabase dashboard
- ✅ Client Secret should never be exposed in frontend code
- ✅ OAuth flow handles authentication securely server-side

## 📋 Checklist

- [ ] Google OAuth client configured in Google Cloud Console
- [ ] Redirect URI added: `https://nsngzzbgankkxxxsdacb.supabase.co/auth/v1/callback`
- [ ] JavaScript origin added: `http://localhost:8080`
- [ ] Google provider enabled in Supabase
- [ ] Client ID added to Supabase
- [ ] Client Secret added to Supabase
- [ ] Site URL set in Authentication URL Configuration: `http://localhost:8080`
- [ ] Redirect URL added: `http://localhost:8080/auth/callback`
- [ ] Tested Google sign-in successfully

## 🚨 Troubleshooting

### Error: "redirect_uri_mismatch"
**Problem:** Redirect URI doesn't match

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
1. Double-check Client ID in Supabase matches Google Cloud Console
2. Double-check Client Secret matches (no extra spaces)
3. Make sure you saved changes in Supabase

### OAuth callback not working
**Problem:** Redirect not happening after Google sign-in

**Solution:**
1. Check Supabase Authentication → URL Configuration (NOT API settings!)
2. Verify Site URL: `http://localhost:8080`
3. Check Redirect URLs include: `http://localhost:8080/auth/callback`
4. Verify JavaScript origin in Google Cloud Console
5. Check browser console for errors

## 🎯 Quick Reference

**Supabase Project:**
- URL: `https://nsngzzbgankkxxxsdacb.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb

**Important Links:**
- Authentication Providers: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/providers
- **Authentication URL Configuration:** https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/url-configuration ⚠️ THIS IS WHERE YOU NEED TO GO FOR STEP 3!

**Google Cloud Console:**
- Credentials: https://console.cloud.google.com/apis/credentials

**Your App:**
- Local: `http://localhost:8080`
- Callback: `http://localhost:8080/auth/callback`

## ✅ Next Steps

After configuration:
1. ✅ Test sign-in with Google account
2. ✅ Test sign-up (creates new account)
3. ✅ Verify user profile is created in `public.users`
4. ✅ Test all features with Google-authenticated user
5. ✅ Set up production OAuth credentials when deploying

Enjoy Google OAuth! 🎉
