import os
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .routes.ai_proxy import router as ai_proxy_router
from .routes.search import check_search_provider, router as search_router
from .routes.news import router as news_router
from .routes.trade_engine import router as trade_engine_router

# Load environment variables from .env file if it exists
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)


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
        version=os.getenv("APP_VERSION", "0.1.0"),
        description=(
            "A small FastAPI microservice that provides a unified web search "
            "API for the AI Financial Advisor agent. This service should be "
            "used for general information lookup that is *not* strictly tied "
            "to the Trade Engine's quantitative market data."
        ),
        docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
        redoc_url="/redoc" if os.getenv("ENVIRONMENT") != "production" else None,
    )
    
    # CORS middleware
    # In development, allow all origins. In production, use CORS_ORIGINS env var
    cors_origins = os.getenv("CORS_ORIGINS", "*")
    is_production = os.getenv("ENVIRONMENT") == "production"
    
    if cors_origins == "*" or not is_production:
        # Development: allow all origins
        # Note: When using ["*"], allow_credentials must be False
        allowed_origins = ["*"]
        allow_creds = False
    else:
        # Production: use configured origins
        allowed_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
        allow_creds = True
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allow_creds,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=3600,  # Cache preflight requests for 1 hour
    )
    
    # Trusted host middleware (production only)
    if os.getenv("ENVIRONMENT") == "production":
        trusted_hosts = os.getenv("TRUSTED_HOSTS", "").split(",")
        if trusted_hosts and trusted_hosts[0]:
            app.add_middleware(
                TrustedHostMiddleware,
                allowed_hosts=trusted_hosts,
            )

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "AI Financial Advisor - Backend API",
            "docs": "/docs" if os.getenv("ENVIRONMENT") != "production" else "disabled in production",
        }

    @app.get("/health")
    async def health_check() -> dict[str, str | float]:
        return {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "uptime_seconds": round(time.time() - START_TIME, 2),
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
    app.include_router(news_router, prefix="")
    app.include_router(trade_engine_router, prefix="")

    return app


app = create_app()
