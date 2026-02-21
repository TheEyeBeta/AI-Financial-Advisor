# Troubleshooting: Main Page Not Showing

## Quick Fixes

### 1. Check the Correct Port

The dev server runs on **port 8080** (not 5173).

**Access the app at:**
- http://localhost:8080
- http://127.0.0.1:8080
- http://[::1]:8080 (IPv6)

### 2. Verify Dev Server is Running

```bash
# Check if server is running
lsof -i :8080

# Or restart the server
npm run dev
```

### 3. Check Browser Console

Open browser DevTools (F12) and check:
- **Console tab**: Look for JavaScript errors
- **Network tab**: Check if files are loading (should see 200 status)
- **Elements tab**: Check if `<div id="root">` exists

### 4. Common Issues

#### Issue: Blank White Page

**Possible causes:**
1. JavaScript errors preventing React from mounting
2. Missing environment variables
3. Supabase connection errors

**Solution:**
```bash
# Check browser console for errors
# Verify .env file has Supabase credentials
cat .env | grep VITE_SUPABASE
```

#### Issue: "Cannot GET /" or 404

**Solution:**
- Make sure you're accessing http://localhost:8080 (not a different port)
- Restart the dev server: `npm run dev`

#### Issue: Page Loads but Shows Nothing

**Check:**
1. Browser console for React errors
2. Network tab for failed requests
3. Verify `src/main.tsx` is loading

**Solution:**
```bash
# Clear browser cache and hard refresh (Ctrl+Shift+R)
# Or restart dev server
npm run dev
```

### 5. Verify Environment Variables

The app needs Supabase credentials to work properly:

```bash
# Check .env file
cat .env

# Should have:
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Note:** Even with placeholder values, the Landing page should still show (it just won't be able to authenticate).

### 6. Test Server Response

```bash
# Test if server responds
curl http://localhost:8080

# Should return HTML with React app
```

### 7. Check for Build Errors

```bash
# Check for TypeScript errors
npm run type-check

# Check for linting errors
npm run lint
```

### 8. Restart Everything

If nothing works, restart:

```bash
# Kill any running processes
pkill -f "vite|node.*dev"

# Clear cache
rm -rf node_modules/.vite

# Restart
npm run dev
```

## Expected Behavior

When working correctly:
1. **Landing Page** (`/`) should show:
   - "AI Financial Advisor" heading
   - "Get Started" and "Sign In" buttons
   - Feature cards (Paper Trading, AI Advisor, Track Progress)

2. **If authenticated**, automatically redirects to `/advisor`

3. **Console should show:**
   - Vite HMR (Hot Module Replacement) messages
   - No red errors

## Still Not Working?

1. **Check the exact error** in browser console
2. **Verify port 8080** is accessible
3. **Check network tab** for failed requests
4. **Try incognito mode** to rule out browser extensions
5. **Check firewall** isn't blocking localhost:8080

## Quick Test

```bash
# 1. Start server
npm run dev

# 2. In another terminal, test
curl http://localhost:8080 | grep -o "<title>.*</title>"

# Should output: <title>Your AI Financial Advisor</title>
```
