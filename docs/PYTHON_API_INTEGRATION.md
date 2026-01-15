# Python Backend API Integration Guide

This document outlines the API endpoints that your Python backend should implement to integrate with the Advisor Ally frontend.

## Overview

The React frontend expects a Python backend API to provide:
1. AI chat responses for financial advice
2. Real-time market data (stock prices, indices, trending stocks)
3. Data processing and analytics (optional)

## Base Configuration

The frontend uses the environment variable `VITE_PYTHON_API_URL` to connect to your Python backend. Default is `http://localhost:8000`.

Set this in your `.env` file:
```
VITE_PYTHON_API_URL=http://localhost:8000
```

## Required API Endpoints

### 1. Chat API Endpoint

**Endpoint:** `POST /api/chat`

**Request Body:**
```json
{
  "message": "What is dollar-cost averaging?",
  "user_id": "uuid-string"
}
```

**Response:**
```json
{
  "response": "Dollar-cost averaging (DCA) is an investment strategy..."
}
```

**Status Codes:**
- `200 OK`: Successful response
- `400 Bad Request`: Invalid request
- `500 Internal Server Error`: Server error

**Example Python Implementation (FastAPI):**
```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    user_id: str

class ChatResponse(BaseModel):
    response: str

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    # Your AI/LLM logic here
    # This could integrate with OpenAI, Anthropic, or your own model
    response_text = await generate_ai_response(request.message, request.user_id)
    
    return ChatResponse(response=response_text)

async def generate_ai_response(message: str, user_id: str) -> str:
    # Example: Call OpenAI API
    # response = openai.ChatCompletion.create(...)
    # return response.choices[0].message.content
    
    # Fallback response
    return "I'm processing your financial question. This is a placeholder response."
```

### 2. Stock Price API Endpoint

**Endpoint:** `GET /api/stock-price/{symbol}`

**Path Parameters:**
- `symbol` (string): Stock ticker symbol (e.g., "AAPL", "MSFT")

**Response:**
```json
{
  "symbol": "AAPL",
  "price": 185.20,
  "currency": "USD",
  "updated_at": "2024-01-20T10:30:00Z"
}
```

**Status Codes:**
- `200 OK`: Successful response
- `404 Not Found`: Symbol not found
- `500 Internal Server Error`: Server error

**Example Python Implementation:**
```python
from fastapi import FastAPI, HTTPException
from typing import Optional
import yfinance as yf  # Example library for stock data

@app.get("/api/stock-price/{symbol}")
async def get_stock_price(symbol: str):
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.history(period="1d")
        
        if info.empty:
            raise HTTPException(status_code=404, detail="Symbol not found")
        
        current_price = float(info['Close'].iloc[-1])
        
        return {
            "symbol": symbol.upper(),
            "price": round(current_price, 2),
            "currency": "USD",
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

## Optional API Endpoints

### 3. Update Market Indices (For Supabase Integration)

If you want your Python backend to update market data in Supabase directly:

**Endpoint:** `POST /api/market-data/update-indices`

**Request Body:**
```json
{
  "indices": [
    {
      "symbol": "SPX",
      "name": "S&P 500",
      "value": 5234.18,
      "change_percent": 1.24,
      "is_positive": true
    },
    {
      "symbol": "IXIC",
      "name": "NASDAQ",
      "value": 16742.39,
      "change_percent": 1.58,
      "is_positive": true
    }
  ]
}
```

You can use Supabase Python client:
```python
from supabase import create_client, Client
import os

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

@app.post("/api/market-data/update-indices")
async def update_indices(indices: List[dict]):
    for index in indices:
        supabase.table("market_indices").upsert({
            "symbol": index["symbol"],
            "name": index["name"],
            "value": index["value"],
            "change_percent": index["change_percent"],
            "is_positive": index["is_positive"]
        }).execute()
    
    return {"status": "success", "updated": len(indices)}
```

### 4. Update Trending Stocks

**Endpoint:** `POST /api/market-data/update-trending`

**Request Body:**
```json
{
  "trending": [
    {
      "symbol": "NVDA",
      "name": "NVIDIA",
      "change_percent": 4.2
    },
    {
      "symbol": "TSLA",
      "name": "Tesla",
      "change_percent": -2.1
    }
  ]
}
```

## Database Schema Reference

Refer to `supabase-schema.sql` for the complete database schema. Key tables:

- `market_indices`: Market index data (S&P 500, NASDAQ, etc.)
- `trending_stocks`: Trending stock symbols and changes
- `trades`: User trade history
- `open_positions`: User's current positions
- `portfolio_history`: Portfolio value over time
- `chat_messages`: Chat conversation history
- `trade_journal`: Detailed trade notes
- `learning_topics`: User learning progress

## Authentication

The frontend uses Supabase Auth. If your Python backend needs to verify user authentication, you can:

1. **Pass JWT token from frontend:**
   ```typescript
   // In frontend API calls
   const { data: { session } } = await supabase.auth.getSession();
   const token = session?.access_token;
   
   fetch(`${PYTHON_API_URL}/api/chat`, {
     headers: {
       'Authorization': `Bearer ${token}`
     },
     // ...
   });
   ```

2. **Verify token in Python:**
   ```python
   from supabase import create_client
   import jwt
   
   def verify_token(token: str):
       # Verify JWT token with Supabase
       # Implementation depends on your setup
       pass
   ```

## Error Handling

The frontend handles API errors gracefully:

- If the Python API is unavailable, it falls back to default responses
- Network errors are logged but don't break the UI
- Use standard HTTP status codes for proper error handling

## Testing Your Python API

### Using curl:

```bash
# Test chat endpoint
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is an ETF?", "user_id": "test-user-123"}'

# Test stock price endpoint
curl http://localhost:8000/api/stock-price/AAPL
```

### Using Python requests:

```python
import requests

# Test chat
response = requests.post(
    "http://localhost:8000/api/chat",
    json={
        "message": "What is dollar-cost averaging?",
        "user_id": "test-user-123"
    }
)
print(response.json())

# Test stock price
response = requests.get("http://localhost:8000/api/stock-price/AAPL")
print(response.json())
```

## Recommended Python Libraries

- **FastAPI**: Modern web framework for building APIs
- **Supabase-py**: Official Supabase Python client
- **yfinance**: Yahoo Finance data (for market data)
- **openai**: OpenAI API client (for AI chat)
- **anthropic**: Anthropic API client (alternative AI)
- **pydantic**: Data validation (comes with FastAPI)

## Example Project Structure

```
python-backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI app
│   ├── routes/
│   │   ├── chat.py      # Chat endpoints
│   │   └── market.py    # Market data endpoints
│   ├── services/
│   │   ├── ai_service.py    # AI/LLM integration
│   │   └── market_service.py # Market data fetching
│   └── models/
│       └── schemas.py   # Pydantic models
├── requirements.txt
└── .env                 # Environment variables
```

## Next Steps

1. Set up your Python backend with FastAPI or Flask
2. Implement the chat endpoint with your AI/LLM provider
3. Implement stock price endpoint using a market data API
4. Test endpoints locally
5. Update `VITE_PYTHON_API_URL` in frontend `.env` file
6. Deploy Python backend (e.g., Railway, Render, AWS)
7. Update frontend environment variable with production URL
