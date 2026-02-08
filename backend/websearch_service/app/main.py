import os
import time
from datetime import datetime

from fastapi import FastAPI, HTTPException

from .routes.ai_proxy import router as ai_proxy_router
from .routes.search import check_search_provider, router as search_router


START_TIME = time.time()


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

    @app.get("/health")
    async def health_check() -> dict[str, str | float]:
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "uptime_seconds": time.time() - START_TIME,
            "version": os.getenv("APP_VERSION", "unknown"),
            "environment": os.getenv("ENVIRONMENT", "development"),
        }

    @app.get("/health/live")
    async def liveness_check() -> dict[str, str]:
        return {"status": "alive"}

    @app.get("/health/ready")
    async def readiness_check() -> dict[str, object]:
        dependency = await check_search_provider()
        if dependency.get("status") != "connected":
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "not_ready",
                    "dependencies": {"search_api": dependency},
                },
            )

        return {
            "status": "ready",
            "dependencies": {"search_api": dependency},
        }

    # Mount routers
    app.include_router(search_router, prefix="")
    app.include_router(ai_proxy_router, prefix="")

    return app


app = create_app()
