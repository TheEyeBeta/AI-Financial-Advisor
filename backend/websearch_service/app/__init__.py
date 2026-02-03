"""
Web Search Service package for the AI Financial Advisor project.

This FastAPI service is intentionally kept separate from the Trade Engine
backend. It is responsible for general web / knowledge search features
that are *not* specific to markets or trading.

Usage overview:

- The frontend (Vite/React) or an AI-orchestration backend sends queries
  to this service, e.g. `GET /api/search?query=...`.
- This service calls an external search provider (e.g. Tavily, SerpAPI,
  Bing, etc.), normalises the results, and returns a compact JSON shape
  that is easy to feed into a language model.

By keeping this in a separate service, you ensure:
- Trade Engine remains focused purely on trading/quantitative data.
- Web search and other general tools can evolve independently.
"""

