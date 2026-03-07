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
from .routes.stock_ranking import router as stock_ranking_router

# Load environment variables from .env file if it exists
# Check multiple locations: service directory, then project root
env_paths = [
    Path(__file__).parent.parent / ".env",  # backend/websearch_service/.env
    Path(__file__).parent.parent.parent.parent / ".env",  # project root .env
]
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break


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
    # SECURITY: In production, CORS_ORIGINS must be set to the exact frontend origin(s).
    # Wildcard CORS in production would allow any website to make credentialled requests.
    # If CORS_ORIGINS is not set in production, the app refuses to start.
    is_production = os.getenv("ENVIRONMENT") == "production"
    cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()

    if is_production:
        if not cors_origins_env or cors_origins_env == "*":
            raise RuntimeError(
                "FATAL: CORS_ORIGINS must be set to an explicit list of allowed origins in "
                "production (e.g. 'https://yourdomain.com'). Wildcard '*' is not permitted."
            )
        allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
        allow_creds = True
    else:
        # Development: allow all origins (credentials disabled to avoid CORS + cookie issues)
        allowed_origins = ["*"]
        allow_creds = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allow_creds,
        # SECURITY: Only allow the methods the API actually uses.
        allow_methods=["GET", "POST", "OPTIONS"],
        # SECURITY: Enumerate allowed headers instead of wildcard.
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-RateLimit-Limit-Minute", "X-RateLimit-Remaining-Minute", "X-RateLimit-Reset-Minute",
                        "X-RateLimit-Limit-Hour", "X-RateLimit-Remaining-Hour", "X-RateLimit-Reset-Hour",
                        "X-RateLimit-Limit-Day", "X-RateLimit-Remaining-Day", "X-RateLimit-Reset-Day"],
        max_age=600,  # 10 minutes — shorter preflight cache reduces stale-config window
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
        # SECURITY: Do not expose version or environment in production health checks.
        # These fields aid attackers in fingerprinting the deployment.
        is_production = os.getenv("ENVIRONMENT") == "production"
        response: dict[str, str | float] = {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if not is_production:
            response["uptime_seconds"] = round(time.time() - START_TIME, 2)
            response["version"] = os.getenv("APP_VERSION", "unknown")
            response["environment"] = os.getenv("ENVIRONMENT", "development")
        return response

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
    app.include_router(stock_ranking_router, prefix="")

    return app


app = create_app()
