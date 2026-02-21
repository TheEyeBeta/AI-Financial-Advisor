# Local Testing Guide

This guide will help you test the application locally before deployment.

## Prerequisites

- Node.js 20+ (currently using 18.19.1 - may have warnings but should work)
- Python 3.12+
- Supabase account and project
- OpenAI API key (for backend)

## Step 1: Environment Setup

### 1.1 Create Environment File

```bash
cp config/env.example .env
```

### 1.2 Edit `.env` File

Open `.env` and fill in your credentials:

```bash
# Required: Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Backend URLs (defaults to localhost)
VITE_PYTHON_API_URL=http://localhost:8000
VITE_WEBSEARCH_API_URL=http://localhost:8000
```

**Important**: Do NOT add `OPENAI_API_KEY` to `.env` - it goes in backend environment only!

## Step 2: Install Dependencies

### 2.1 Frontend Dependencies

```bash
npm install
```

### 2.2 Backend Dependencies

```bash
cd backend/websearch_service
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ../..
```

## Step 3: Database Setup

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the SQL files from `sql/` folder:
   - `sql/schema.sql` (if exists)

## Step 4: Start Services

### Option A: Manual Start (Recommended for Testing)

**Terminal 1 - Backend:**
```bash
cd backend/websearch_service
source venv/bin/activate
export OPENAI_API_KEY=sk-your-key-here  # Set your OpenAI key
export PERPLEXITY_API_KEY=pplx-your-key-here  # Optional: Fallback when OpenAI hits limits
export TAVILY_API_KEY=tvly-your-key-here  # Optional, for web search
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### Option B: Docker Compose (All Services)

```bash
# Set environment variables first
export OPENAI_API_KEY=sk-your-key-here
export TAVILY_API_KEY=tvly-your-key-here  # Optional

# Start all services
docker-compose -f deployment/docker-compose.yml up
```

Or use Makefile:
```bash
make docker-up
```

## Step 5: Verify Services

### Backend Health Check

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-02-13T...",
  "uptime_seconds": 123.45,
  "version": "0.1.0",
  "environment": "development"
}
```

### Frontend Access

Open browser: http://localhost:5173 (or port shown in terminal)

## Step 6: Test Key Features

### 6.1 Authentication
- [ ] Sign up with email
- [ ] Sign in
- [ ] Sign out

### 6.2 AI Chat
- [ ] Send a message to AI advisor
- [ ] Verify response comes from backend
- [ ] Check rate limiting (should work smoothly)

### 6.3 Web Search (if configured)
```bash
curl "http://localhost:8000/api/search?query=financial+markets"
```

### 6.4 Backend API Endpoints

```bash
# Health check
curl http://localhost:8000/health

# Liveness
curl http://localhost:8000/health/live

# Readiness
curl http://localhost:8000/health/ready

# Chat endpoint (requires auth in production)
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

## Step 7: Run Tests

### Frontend Tests
```bash
npm test
```

### Backend Tests
```bash
cd backend/websearch_service
source venv/bin/activate
pytest tests/ -v
```

### E2E Tests
```bash
npm run test:e2e
```

## Troubleshooting

### Backend won't start
- Check Python version: `python3 --version` (need 3.12+)
- Verify virtual environment is activated
- Check `OPENAI_API_KEY` is set
- Check port 8000 is not in use: `lsof -i :8000`

### Frontend won't start
- Check Node.js version: `node --version` (need 20+, but 18 may work with warnings)
- Verify `.env` file exists and has correct values
- Check port 5173 is not in use: `lsof -i :5173`

### CORS errors
- Verify `VITE_PYTHON_API_URL` in `.env` matches backend URL
- Check backend CORS settings in `backend/websearch_service/app/main.py`

### Database connection errors
- Verify Supabase URL and keys in `.env`
- Check Supabase project is active
- Verify SQL schema has been run

### Rate limiting issues
- Check backend logs for rate limit messages
- Verify rate limiter is working: `curl http://localhost:8000/health`

## Quick Test Checklist

- [ ] Backend starts without errors
- [ ] Frontend starts without errors
- [ ] Backend health endpoint responds
- [ ] Frontend loads in browser
- [ ] Can sign up/login
- [ ] AI chat works
- [ ] No console errors in browser
- [ ] No errors in backend logs

## Next Steps

Once local testing passes:
1. Review `deployment/DEPLOYMENT_CHECKLIST.md`
2. Set up GitHub secrets
3. Deploy backend to Railway
4. Deploy frontend to Vercel
5. Update environment variables in production
