from __future__ import annotations

import os
from typing import Any, Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query


from ..services.audit import audit_log
from ..services.security import require_api_key

router = APIRouter(tags=["search"])


TAVILY_API_KEY_ENV = "TAVILY_API_KEY"
TAVILY_ENDPOINT = "https://api.tavily.com/search"


async def check_search_provider() -> Dict[str, str]:
    """Validate that external search dependency is configured and reachable."""
    tavily_api_key = os.getenv(TAVILY_API_KEY_ENV)
    if not tavily_api_key:
        return {
            "status": "down",
            "detail": f"{TAVILY_API_KEY_ENV} is not configured",
        }

    payload = {
        "api_key": tavily_api_key,
        "query": "service health check",
        "max_results": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(TAVILY_ENDPOINT, json=payload)
    except httpx.RequestError as exc:
        return {
            "status": "down",
            "detail": f"provider connection failed: {exc}",
        }

    if resp.status_code != 200:
        return {
            "status": "down",
            "detail": f"provider returned HTTP {resp.status_code}",
        }

    return {
        "status": "connected",
        "detail": "search provider reachable",
    }


@router.get("/api/search")
async def search_web(
    query: str = Query(..., min_length=3, description="Natural language search query."),
    max_results: int = Query(
        5,
        ge=1,
        le=10,
        description="Maximum number of search results to return (1–10).",
    ),
    _auth: None = Depends(require_api_key),
) -> Dict[str, Any]:
    """
    Perform a general web search via an external provider and return
    a compact, LLM‑friendly JSON structure.

    This endpoint is designed to be called by your AI agent when it needs
    non‑financial, general knowledge or up‑to‑date information that does
    not exist in:

    - Supabase (user data, portfolio, etc.)
    - The Eye Trade Engine (market and quantitative data)

    Implementation details:
    - Uses Tavily as the default provider (https://tavily.com/)
    - Requires a TAVILY_API_KEY environment variable
    - You are free to swap Tavily for another search API later as long
      as you preserve the response shape returned from this endpoint.
    """
    tavily_api_key = os.getenv(TAVILY_API_KEY_ENV)
    if not tavily_api_key:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{TAVILY_API_KEY_ENV} is not configured. "
                "Set this environment variable on the websearch service "
                "to enable external web search."
            ),
        )

    # Call Tavily (or a compatible) search API
    payload = {
        "api_key": tavily_api_key,
        "query": query,
        "max_results": max_results,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(TAVILY_ENDPOINT, json=payload)
    except httpx.RequestError:
        await audit_log(
            "search_provider_transport_error",
            {"provider": "tavily", "query_length": len(query)},
        )
        raise HTTPException(
            status_code=502,
            detail="Search provider is currently unreachable.",
        )

    if resp.status_code != 200:
        await audit_log(
            "search_provider_http_error",
            {"provider": "tavily", "status_code": resp.status_code, "query_length": len(query)},
        )
        raise HTTPException(
            status_code=502,
            detail="Search provider returned an error.",
        )

    data = resp.json()
    raw_results: List[Dict[str, Any]] = data.get("results", []) or []

    # Normalise into a stable, compact structure the agent can consume.
    results = [
        {
            "title": item.get("title") or "",
            "url": item.get("url") or "",
            "snippet": item.get("content") or item.get("snippet") or "",
        }
        for item in raw_results
    ]

    return {
        "query": query,
        "results": results,
    }
