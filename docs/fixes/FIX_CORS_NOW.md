# Immediate Fix for CORS and Port 8001 Errors

## Issue Found

Your `.env` file has:
```
VITE_WEBSEARCH_API_URL=http://localhost:8001
```

But your backend runs on port **8000**, not 8001.

## Quick Fix

### Step 1: Update your `.env` file

Remove or comment out the `VITE_WEBSEARCH_API_URL` line, or change it to:

```bash
# Option 1: Remove it (recommended - will use same URL as VITE_PYTHON_API_URL)
# VITE_WEBSEARCH_API_URL=http://localhost:8001

# Option 2: Point it to port 8000
VITE_WEBSEARCH_API_URL=http://localhost:8000
```

### Step 2: Restart the Backend

The CORS fix requires a backend restart:

```bash
# Find and kill the current backend process
pkill -f "uvicorn.*app.main"

# Start it again
npm run start:backend
```

Or if running manually:
```bash
cd backend/websearch_service
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Step 3: Restart the Frontend

Stop the frontend dev server (Ctrl+C) and restart:
```bash
npm run dev
```

### Step 4: Hard Refresh Browser

Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac) to clear cache and reload.

## What Was Fixed

1. ✅ **CORS Configuration**: Fixed FastAPI CORS to properly allow all origins in development
2. ✅ **Port Mismatch**: Updated `env.example` to use port 8000 (or leave unset)
3. ✅ **Health Check**: Already configured to use port 8000

## Verify It's Working

After restarting both services:

1. Check backend is running:
   ```bash
   curl http://localhost:8000/health
   ```

2. Check CORS headers:
   ```bash
   curl -v -H "Origin: http://192.168.0.245:8080" http://localhost:8000/health
   ```
   
   Should see: `access-control-allow-origin: *`

3. Open browser console - errors should be gone!

## If Still Not Working

1. **Check backend logs** for CORS errors
2. **Verify backend is actually running** on port 8000:
   ```bash
   lsof -i :8000
   ```
3. **Check your `.env` file** doesn't have `VITE_WEBSEARCH_API_URL=http://localhost:8001`
