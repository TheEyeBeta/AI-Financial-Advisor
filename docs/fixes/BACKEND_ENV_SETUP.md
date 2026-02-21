# Backend Environment Variables Setup

## Quick Setup

The backend now automatically loads environment variables from a `.env` file!

### 1. Create Backend .env File

```bash
cd backend/websearch_service
cp .env.example .env
```

### 2. Edit `.env` File

Open `backend/websearch_service/.env` and add your actual API keys:

```bash
# Required
OPENAI_API_KEY=sk-your-actual-openai-key-here

# Optional but Recommended
PERPLEXITY_API_KEY=pplx-your-actual-perplexity-key-here  # Fallback when OpenAI hits limits
TAVILY_API_KEY=tvly-your-actual-tavily-key-here  # For web search
```

### 3. Start Backend

The backend will automatically load variables from `.env`:

```bash
cd backend/websearch_service
source venv/bin/activate
uvicorn app.main:app --reload
```

Or use the helper script:
```bash
./scripts/start-backend.sh
```

## How It Works

- **Backend `.env`**: `backend/websearch_service/.env` (for backend API keys)
- **Frontend `.env`**: Root `.env` (for frontend VITE_* variables)
- **Auto-loading**: Backend automatically loads from `.env` on startup
- **Priority**: Environment variables set in shell override `.env` file

## Environment Variables

### Required
- `OPENAI_API_KEY` - Your OpenAI API key (starts with `sk-`)

### Optional
- `PERPLEXITY_API_KEY` - Perplexity API key for fallback (starts with `pplx-`)
- `TAVILY_API_KEY` - Tavily API key for web search (starts with `tvly-`)

### Configuration
- `APP_VERSION` - Application version (default: 0.1.0)
- `ENVIRONMENT` - Environment name (development/production)
- `LOG_LEVEL` - Logging level (info/debug/warning)
- `PORT` - Server port (default: 8000)
- `WORKERS` - Number of worker processes (default: 1 for dev)

## Security Notes

- ✅ `.env` files are in `.gitignore` - never committed
- ✅ Backend keys stay in backend `.env` (not frontend)
- ✅ Frontend `.env` only has `VITE_*` variables
- ✅ Production: Use platform environment variables (Railway/Render)

## Troubleshooting

**Backend not loading .env?**
- Make sure `.env` is in `backend/websearch_service/` directory
- Check file permissions: `chmod 600 .env`
- Verify file exists: `ls -la backend/websearch_service/.env`

**Variables not working?**
- Restart the backend server after changing `.env`
- Check for typos in variable names
- Verify no extra spaces around `=` sign

## Example .env File

```bash
# backend/websearch_service/.env
OPENAI_API_KEY=sk-proj-abc123...
PERPLEXITY_API_KEY=pplx-xyz789...
TAVILY_API_KEY=tvly-def456...
ENVIRONMENT=development
LOG_LEVEL=info
```

---

**Note**: The root `.env` file is for frontend variables only. Backend variables go in `backend/websearch_service/.env`.
