# URGENT: Fix All Console Errors

## Issues Found

1. ✅ **Port 8001 errors** - Health check trying to use port 8001
2. ✅ **CORS errors** - Backend not sending CORS headers
3. ✅ **Missing /api/news endpoint** - Frontend calling non-existent endpoint
4. ⚠️ **Supabase 404/403 errors** - Database table/permission issues

## Fixes Applied

### 1. Health Check Port Fix
- Updated health check to ignore `VITE_WEBSEARCH_API_URL` if it points to port 8001
- Will automatically use port 8000 instead

### 2. CORS Fix
- Updated backend CORS configuration
- **BACKEND MUST BE RESTARTED** for CORS changes to take effect

### 3. News Endpoint
- Added stub `/api/news` endpoint to prevent 404 errors
- Frontend will gracefully fall back to Supabase

## ACTION REQUIRED

### Step 1: Update `.env` file

Remove or fix this line:
```bash
# Remove this or change to port 8000:
VITE_WEBSEARCH_API_URL=http://localhost:8001
```

Change to:
```bash
# Option 1: Remove it (recommended)
# VITE_WEBSEARCH_API_URL=http://localhost:8001

# Option 2: Point to correct port
VITE_WEBSEARCH_API_URL=http://localhost:8000
```

### Step 2: Restart Backend (CRITICAL)

The CORS fix requires a backend restart:

```bash
# Kill current backend
pkill -f "uvicorn.*app.main"
pkill -f "gunicorn.*app.main"

# Start fresh
npm run start:backend
```

Or manually:
```bash
cd backend/websearch_service
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Step 3: Restart Frontend

```bash
# Stop frontend (Ctrl+C)
# Then restart:
npm run dev
```

### Step 4: Hard Refresh Browser

Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)

## Verify Fixes

After restarting:

1. **Check backend is running:**
   ```bash
   curl http://localhost:8000/health
   ```

2. **Check CORS headers:**
   ```bash
   curl -v -H "Origin: http://localhost:8080" http://localhost:8000/health
   ```
   
   Should see: `access-control-allow-origin: *`

3. **Check news endpoint:**
   ```bash
   curl http://localhost:8000/api/news?limit=5
   ```
   
   Should return: `{"items":[],"next_cursor":null,"message":"..."}`

4. **Check browser console** - port 8001 and CORS errors should be gone!

## Remaining Issues (Supabase)

The Supabase errors are separate:

- **404 on `news_articles`**: Table might not exist or wrong name
- **403 on `learning_topics`**: Row Level Security (RLS) policy issue

These need to be fixed in Supabase:
1. Run the SQL schema in `sql/schema.sql`
2. Check RLS policies for `learning_topics` table
3. Verify `news_articles` table exists

## Summary

✅ Health check port fix - **DONE** (no restart needed)
✅ CORS configuration - **DONE** (needs backend restart)
✅ News endpoint stub - **DONE** (needs backend restart)
⚠️ Supabase issues - **Separate issue** (database setup)

**MOST IMPORTANT: Restart the backend now!**
