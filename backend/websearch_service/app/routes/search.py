from __future__ import annotations

import logging
import os
from typing import Any, Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from ..services.audit import audit_log
from ..services.auth import AuthenticatedUser, require_auth
from ..services.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

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
    raw_request: Request,
    response: Response,
    query: str = Query(..., min_length=3, max_length=500, description="Natural language search query."),
    max_results: int = Query(
        5,
        ge=1,
        le=10,
        description="Maximum number of search results to return (1-10).",
    ),
    auth_user: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    """
    Perform a general web search via an external provider and return
    a compact, LLM-friendly JSON structure.

    Requires: authenticated Supabase JWT in the Authorization header.
    Rate-limited per authenticated user.
    """
    verified_user_id = auth_user.auth_id

    tavily_api_key = os.getenv(TAVILY_API_KEY_ENV)
    if not tavily_api_key:
        raise HTTPException(
            status_code=500,
            detail="Search functionality is not available.",
        )

    # Rate limiting using the verified user ID
    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/search",
        user_id=verified_user_id,
        estimated_tokens=0,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        await audit_log(
            "search_request",
            {
                "user_id": verified_user_id,
                "query_length": len(query),
                "max_results": max_results,
            },
        )

        payload = {
            "api_key": tavily_api_key,
            "query": query,
            "max_results": max_results,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(TAVILY_ENDPOINT, json=payload)
        except httpx.RequestError as exc:
            logger.error("Search provider connection error: %s", type(exc).__name__)
            raise HTTPException(
                status_code=502,
                detail="Search provider is temporarily unavailable.",
            ) from exc

        if resp.status_code != 200:
            logger.warning("Search provider returned HTTP %d", resp.status_code)
            raise HTTPException(
                status_code=502,
                detail="Search provider returned an error.",
            )

        data = resp.json()
        raw_results: List[Dict[str, Any]] = data.get("results", []) or []

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
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)
