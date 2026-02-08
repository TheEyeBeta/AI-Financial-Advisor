from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException

from .routes.search import TAVILY_API_KEY_ENV, TAVILY_ENDPOINT, router as search_router


START_TIME = time.time()


async def check_search_api() -> bool:
    """Check whether the configured external search dependency can be reached."""
    tavily_api_key = os.getenv(TAVILY_API_KEY_ENV)
    if not tavily_api_key:
        return False

    payload = {
        "api_key": tavily_api_key,
        "query": "service health probe",
        "max_results": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(TAVILY_ENDPOINT, json=payload)
    except httpx.RequestError:
        return False

    return response.status_code == 200


def create_app() -> FastAPI:
    """
    Application factory for the Web Search service.

    This service is intentionally separate from the Trade Engine backend.
    It is responsible for generic web/knowledge search and can be called
    by your agent when it needs information that does not come from:

    - Supabase (user data, portfolio, etc.)
    - The Eye Trade Engine (live market and quantitative data)

    Typical deployment:
    - Run this service on its own URL, e.g. https://websearch.yourdomain.com
    - Point your AI orchestration logic at /api/search on this service.
    """
    app = FastAPI(
        title="AI Financial Advisor - Web Search Service",
        version="0.1.0",
        description=(
            "A small FastAPI microservice that provides a unified web search "
            "API for the AI Financial Advisor agent. This service should be "
            "used for general information lookup that is *not* strictly tied "
            "to the Trade Engine's quantitative market data."
        ),
    )

    # Mount routers
    app.include_router(search_router, prefix="")

    @app.get("/health")
    async def health_check() -> dict[str, str | float]:
        """Comprehensive service-level health information."""
        return {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "uptime_seconds": round(time.time() - START_TIME, 2),
            "version": os.getenv("APP_VERSION", "unknown"),
            "environment": os.getenv("ENVIRONMENT", "development"),
        }

    @app.get("/health/live")
    async def liveness_check() -> dict[str, str]:
        """Liveness probe for container/runtime supervision."""
        return {"status": "alive"}

    @app.get("/health/ready")
    async def readiness_check() -> dict[str, str | dict[str, str]]:
        """Readiness probe that validates critical external dependency access."""
        is_connected = await check_search_api()
        if not is_connected:
            raise HTTPException(status_code=503, detail="Search API unavailable")

        return {
            "status": "ready",
            "dependencies": {
                "search_api": "connected",
            },
        }

    return app


app = create_app()
