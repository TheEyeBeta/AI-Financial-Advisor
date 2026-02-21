# Backend Connectivity Fixes

## Issues Fixed

### 1. ✅ CORS Configuration
**Problem:** CORS errors when frontend (running on `http://192.168.0.245:8080`) tries to access backend (`http://localhost:8000`)

**Fix Applied:**
- Updated `backend/websearch_service/app/main.py` to properly handle CORS
- Added explicit `expose_headers` and proper method list
- Development mode allows all origins (`*`)
- Production mode uses `CORS_ORIGINS` environment variable

**Status:** ✅ Fixed

### 2. ✅ Health Check Port Mismatch
**Problem:** Frontend was trying to check port 8001, but backend only runs on port 8000

**Fix Applied:**
- Updated `src/services/healthCheck.ts` to use port 8000 for both websearch and AI backend
- Both services now point to the same backend URL
- Health check gracefully handles connection errors (doesn't spam console)

**Status:** ✅ Fixed

### 3. ✅ Backend Startup Scripts
**Problem:** No easy way to start the backend service

**Fix Applied:**
- Added `npm run start:backend` script
- Created `scripts/start-backend.sh` with proper error handling
- Added `BACKEND_STARTUP.md` with detailed instructions
- Updated `README.md` with backend setup steps

**Status:** ✅ Fixed

### 4. ✅ E2E Test Configuration
**Problem:** Playwright tests fail because backend isn't running

**Fix Applied:**
- Updated `playwright.config.ts` to automatically start backend before tests
- Backend starts in background during E2E test runs
- Tests wait for backend to be healthy before running

**Status:** ✅ Fixed

### 5. ✅ React Router Warnings
**Problem:** Deprecation warnings about React Router v7

**Fix Applied:**
- Added future flags to `BrowserRouter` in `src/App.tsx`:
  - `v7_startTransition: true`
  - `v7_relativeSplatPath: true`

**Status:** ✅ Fixed

## How to Use

### Start Backend Manually
```bash
npm run start:backend
```

Or:
```bash
cd backend/websearch_service
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Verify Backend is Running
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status":"healthy","service":"websearch_service"}
```

### Check Port Status
```bash
lsof -i :8000
```

### Run E2E Tests
```bash
npm run test:e2e
```

The backend will automatically start before tests run.

## Troubleshooting

### Backend Won't Start
1. Check if Python virtual environment exists:
   ```bash
   cd backend/websearch_service
   ls -la venv/
   ```

2. If missing, create it:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Check environment variables:
   ```bash
   cd backend/websearch_service
   cat .env
   ```

### CORS Still Failing
1. Make sure backend is running: `curl http://localhost:8000/health`
2. Check backend logs for CORS errors
3. Verify `ENVIRONMENT` is not set to "production" in `.env`
4. Check browser console for exact error message

### Port Already in Use
```bash
# Find what's using port 8000
lsof -i :8000

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or use a different port
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

Then update frontend `.env`:
```
VITE_PYTHON_API_URL=http://localhost:8001
```

## Next Steps

1. **Start the backend:**
   ```bash
   npm run start:backend
   ```

2. **Start the frontend (in another terminal):**
   ```bash
   npm run dev
   ```

3. **Verify both are working:**
   - Frontend: http://localhost:8080 (or http://192.168.0.245:8080)
   - Backend: http://localhost:8000
   - API Docs: http://localhost:8000/docs

4. **Check browser console** - errors should be gone!

## Files Changed

- `backend/websearch_service/app/main.py` - CORS configuration
- `src/services/healthCheck.ts` - Health check endpoints and error handling
- `src/App.tsx` - React Router future flags
- `playwright.config.ts` - Auto-start backend for tests
- `package.json` - Added `start:backend` script
- `scripts/start-backend.sh` - Backend startup script
- `README.md` - Added backend setup instructions
- `BACKEND_STARTUP.md` - Detailed backend guide
