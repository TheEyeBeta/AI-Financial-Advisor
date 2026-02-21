# Backend Startup Guide

## Quick Start

### Option 1: Using the Script (Recommended)
```bash
./scripts/start-backend.sh
```

### Option 2: Manual Start
```bash
cd backend/websearch_service
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Prerequisites

1. **Python 3.8+** installed
2. **Virtual environment** created:
   ```bash
   cd backend/websearch_service
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Environment variables** set up:
   ```bash
   cd backend/websearch_service
   cp .env.example .env
   # Edit .env and add your API keys:
   # OPENAI_API_KEY=sk-...
   # PERPLEXITY_API_KEY=pplx-... (optional)
   # TAVILY_API_KEY=tvly-...
   ```

## Verify Backend is Running

Once started, you should see:
```
🚀 Starting backend server on http://localhost:8000
📚 API docs: http://localhost:8000/docs
```

Test the health endpoint:
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status":"healthy","service":"websearch_service"}
```

## Troubleshooting

### Port Already in Use
If port 8000 is already in use:
```bash
# Find what's using the port
lsof -i :8000

# Kill the process or use a different port
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

### CORS Errors
The backend is configured to allow all origins in development. If you still see CORS errors:
1. Make sure the backend is running
2. Check that `ENVIRONMENT` is not set to "production" in `.env`
3. Verify the frontend URL matches what's in `CORS_ORIGINS` (if set)

### Module Not Found
If you see `ModuleNotFoundError`:
```bash
cd backend/websearch_service
source venv/bin/activate
pip install -r requirements.txt
```

## Running in Background

To run the backend in the background:
```bash
nohup ./scripts/start-backend.sh > backend.log 2>&1 &
```

To stop it:
```bash
pkill -f "uvicorn app.main:app"
```

## For E2E Tests

The Playwright config will automatically start the backend before running tests. Make sure:
1. The `start-backend.sh` script is executable: `chmod +x scripts/start-backend.sh`
2. The virtual environment exists and dependencies are installed
3. Environment variables are set (or tests will mock them)
