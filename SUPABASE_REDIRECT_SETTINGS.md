# Supabase Redirect Settings

## Where to Check/Update in Supabase Dashboard

### 1. Auth Settings → URL Configuration

Go to: **Supabase Dashboard → Authentication → URL Configuration**

**Site URL**: Should be your production URL (e.g., `https://yourdomain.com`)

**Redirect URLs**: Add these allowed redirect URLs:
- `http://localhost:8080/**` (for local development)
- `http://localhost:5173/**` (if using Vite default port)
- `https://yourdomain.com/**` (for production)

**Important**: Make sure `/auth/callback` is included in your redirect URLs pattern.

### 2. Email Templates → Redirect URL

Go to: **Supabase Dashboard → Authentication → Email Templates**

In the **Confirmation Email** template, check the redirect URL:
- Should be: `{{ .SiteURL }}/auth/callback?verified=true`
- Or: `{{ .ConfirmationURL }}` (Supabase handles this automatically)

### 3. OAuth Providers (if using)

If you have any OAuth providers enabled:
- **Redirect URL** should be: `https://your-project.supabase.co/auth/v1/callback`
- This is handled automatically by Supabase

## Current Code Redirects

After our changes, all sign-in redirects go to `/advisor`:
- ✅ Sign-in success → `/advisor`
- ✅ Sign-up success → `/advisor` (after email verification)
- ✅ Auth callback → `/advisor`
- ✅ Landing page (if authenticated) → `/advisor`

## No Changes Needed in Supabase

The redirect URLs in Supabase are for **email verification links** and **OAuth callbacks**, not for post-login redirects. Those are handled by your React code, which we've already updated.

If you're still being redirected to `/dashboard`, it's likely:
1. Browser cache (try hard refresh: Ctrl+Shift+R)
2. The Landing page redirect (we just fixed this)
3. Old session data
