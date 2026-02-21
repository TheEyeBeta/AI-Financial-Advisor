# Tavily Web Search Setup

## Current Status

✅ **Tavily is integrated** in the backend at `/api/search` endpoint
✅ **Code is ready** - just needs API key configuration

## Setup Instructions

### 1. Create Backend `.env` File

If you don't have a `.env` file in `backend/websearch_service/`, create it:

```bash
cd backend/websearch_service
touch .env
```

### 2. Add Your Tavily API Key

Edit `backend/websearch_service/.env` and add:

```bash
TAVILY_API_KEY=tvly-your-api-key-here
```

**Get your Tavily API key:**
- Sign up at https://tavily.com/
- Go to your dashboard
- Copy your API key (starts with `tvly-`)

### 3. Also Add Other Required Keys

While you're at it, add all backend API keys:

```bash
# Required for AI chat
OPENAI_API_KEY=sk-proj-your-key-here

# Required for web search
TAVILY_API_KEY=tvly-your-key-here

# Optional: Fallback when OpenAI hits rate limits
PERPLEXITY_API_KEY=pplx-your-key-here
```

### 4. Restart Backend

After adding the keys, restart the backend:

```bash
# Kill current backend
pkill -f "uvicorn.*app.main"

# Start fresh (it will load .env automatically)
npm run start:backend
```

## Verify Tavily is Working

### Test the Search Endpoint

```bash
curl "http://localhost:8000/api/search?query=financial+markets&max_results=3"
```

Expected response:
```json
{
  "query": "financial markets",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "..."
    }
  ]
}
```

### Check Health Endpoint

```bash
curl http://localhost:8000/health/ready
```

Should return:
```json
{
  "status": "ready",
  "dependencies": {
    "search_api": {
      "status": "connected",
      "detail": "search provider reachable"
    }
  }
}
```

If you see `"status": "down"`, check:
1. `TAVILY_API_KEY` is set in `.env`
2. API key is valid
3. Backend was restarted after adding the key

## How It Works

1. **Frontend/Agent calls**: `GET /api/search?query=your+query&max_results=5`
2. **Backend forwards to Tavily**: Uses your `TAVILY_API_KEY`
3. **Returns normalized results**: Clean JSON format for the AI to use

## API Endpoint Details

- **Endpoint**: `GET /api/search`
- **Query params**:
  - `query` (required): Search query (min 3 characters)
  - `max_results` (optional): 1-10 results (default: 5)
- **Response**: JSON with `query` and `results` array

## Troubleshooting

### "TAVILY_API_KEY is not configured"
- Make sure `.env` file exists in `backend/websearch_service/`
- Check the key is spelled correctly: `TAVILY_API_KEY` (not `TAVILY_KEY`)
- Restart backend after adding the key

### "Search provider error"
- Verify your Tavily API key is valid
- Check your Tavily account has credits/quota
- Test the key directly: https://api.tavily.com/search

### Health check shows "down"
- The `/health/ready` endpoint tests Tavily connectivity
- If it fails, check network/firewall issues
- Verify API key is correct

## Cost Considerations

Tavily offers:
- **Free tier**: Limited requests
- **Paid plans**: Based on usage

Monitor your usage in the Tavily dashboard to avoid unexpected charges.
