# Web Search Service (FastAPI)

This is a small, standalone FastAPI microservice that gives your AI Financial
Advisor agent the ability to look up **general information on the web**.

It is intentionally separate from the Trade Engine backend:

- **Trade Engine**: provides *quantitative* / market data (prices, signals,
  indicators, portfolio‑level stats).
- **Web Search Service (this)**: provides *general knowledge* and up‑to‑date
  information that is not in the Trade Engine or Supabase.

The agent can call this service when a user asks questions like:

- “What are the latest tax rules for ISAs in the UK?”
- “Explain what a SPAC is.”
- “What happened in the markets today?” (high‑level, news‑style)

## Structure

```text
backend/websearch_service/
  app/
    __init__.py
    main.py          # FastAPI app factory
    routes/
      search.py      # /api/search endpoint (Tavily‑backed)
  requirements.txt
```

## Running locally

From the `backend/websearch_service` directory:

```bash
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

pip install -r requirements.txt

export TAVILY_API_KEY=your_api_key_here  # or set via your shell/env manager

uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

This will start the service on `http://localhost:8001`.

### Environment variables

- `TAVILY_API_KEY` – API key for the Tavily search API
  (see https://tavily.com/).  
  You can replace Tavily with another provider later as long as the
  `/api/search` response shape remains the same.

## API Overview

### `GET /api/search`

Perform a general web search and return a compact, LLM‑friendly JSON shape.

**Query parameters:**

- `query` (string, required): The natural language search query.
- `max_results` (int, optional, 1–10, default 5): How many results to return.

**Example response:**

```json
{
  "query": "what is a bond etf",
  "results": [
    {
      "title": "What Is a Bond ETF?",
      "url": "https://example.com/article/bond-etf",
      "snippet": "A bond ETF is an exchange‑traded fund that invests in bonds..."
    }
  ]
}
```

This JSON can be injected into your agent’s prompt, for example:

```text
User asked: "{user question}"

Here are search results from the web:
- {title}: {snippet}
...

Using only the information above plus your general financial knowledge,
answer the user's question.
```

## How this fits into the overall architecture

1. **Frontend (Vite/React)** sends the user’s message to an AI/chat endpoint
   (either in the Trade Engine backend or a separate coordinator backend).
2. The AI/chat backend decides:
   - “Can I answer this from Trade Engine / Supabase?”  
     – use existing context only.
   - “Do I need general web info?”  
     – call `GET /api/search` on this service, then feed the results into the
       language model as additional context.
3. The backend returns the final, synthesized answer to the frontend.

By keeping this service separate, you avoid mixing generic web search logic
into your trading engine and keep a clear boundary between:

- **Quantitative** data (Trade Engine + Supabase)
- **Qualitative / external** data (this Web Search Service)

