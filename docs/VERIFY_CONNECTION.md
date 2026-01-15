# How to Verify Supabase Connection

Here are **3 easy ways** to confirm your app is connected to Supabase:

## Method 1: Visual Test in Browser (Easiest) ⭐

I've added a connection test component to your Dashboard page!

1. **Start the dev server:**
   ```bash
   npm run dev
   ```

2. **Open your browser:**
   - Go to: http://localhost:8080
   - Navigate to Dashboard (or go directly to: http://localhost:8080/dashboard)

3. **Look for the connection status card** at the top of the Dashboard
   - ✅ **Green "Connected"** = Successfully connected to Supabase
   - ⚠️ **Orange "Tables Missing"** = Connected, but need to run schema
   - ⚠️ **Yellow "Auth Required"** = Connected, tables exist, need authentication
   - ❌ **Red "Error"** = Connection issue (check .env file)

## Method 2: Browser Console Test (Quick Check)

1. **Start the dev server:**
   ```bash
   npm run dev
   ```

2. **Open browser console:**
   - Open: http://localhost:8080
   - Press `F12` (or right-click → Inspect → Console tab)

3. **Run this in the console:**
   ```javascript
   // Check if Supabase client exists
   import('@/lib/supabase').then(({ supabase }) => {
     console.log('✅ Supabase client loaded');
     
     // Test connection
     supabase.auth.getSession().then(({ data, error }) => {
       if (error) {
         console.log('❌ Error:', error.message);
       } else {
         console.log('✅ Supabase connected!');
         console.log('Session:', data.session ? 'Active' : 'No session (expected)');
       }
     });
     
     // Test table query (will show different errors based on state)
     supabase.from('portfolio_history').select('count').limit(1).then(({ data, error }) => {
       if (error) {
         if (error.message.includes('relation') || error.message.includes('does not exist')) {
           console.log('⚠️  Tables not found - Run supabase-schema.sql');
         } else if (error.message.includes('permission') || error.message.includes('RLS')) {
           console.log('✅ Tables exist! RLS working (need auth)');
         } else {
           console.log('❌ Error:', error.message);
         }
       } else {
         console.log('✅ Tables exist and accessible!');
       }
     });
   });
   ```

## Method 3: Check Environment Variables

1. **Verify .env file exists and has values:**
   ```bash
   cat .env
   ```

   You should see:
   ```
   VITE_SUPABASE_URL=https://nsngzzbgankkxxxsdacb.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGc...
   ```

2. **Check if Vite is reading the env variables:**
   - In your browser, open console (F12)
   - Type: `console.log(import.meta.env.VITE_SUPABASE_URL)`
   - Should show: `https://nsngzzbgankkxxxsdacb.supabase.co`

## What Each Status Means

### ✅ **Connected (Green)**
- Successfully connected to Supabase
- All tables exist
- Everything is working!

### ⚠️ **Tables Missing (Orange)**
- ✅ Connected to Supabase
- ❌ Database schema not run yet
- **Action:** Run `supabase-schema.sql` in Supabase SQL Editor

### ⚠️ **Auth Required (Yellow)**
- ✅ Connected to Supabase
- ✅ Tables exist
- ⚠️ Row Level Security (RLS) is working
- **Action:** Need to authenticate user (or disable RLS for testing)

### ❌ **Error (Red)**
- Connection failed
- **Possible causes:**
  - Wrong URL or key in .env
  - Network issues
  - Supabase project paused or deleted
- **Action:** Check .env file and Supabase dashboard

## Quick Test Checklist

- [ ] `.env` file exists with correct values
- [ ] Dev server running (`npm run dev`)
- [ ] Browser shows Dashboard page
- [ ] Connection status card visible
- [ ] Status shows "Connected" or "Tables Missing" (both mean connection works!)

## Troubleshooting

### "Missing environment variables" error
- Check if `.env` file exists: `ls -la .env`
- Verify values: `cat .env`
- Restart dev server after creating/editing `.env`

### "Cannot find module" errors
- Make sure you ran: `npm install`
- Check if `@supabase/supabase-js` is installed: `npm list @supabase/supabase-js`

### Connection works but tables not found
- This is normal if you haven't run the schema yet
- Run `supabase-schema.sql` in Supabase SQL Editor
- Refresh the page

### Connection test component not showing
- Make sure Dashboard page is loaded
- Check browser console for errors
- Verify the component file exists: `src/utils/test-connection.tsx`
