import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

# Boot banner — prints to stdout regardless of logging configuration so we can
# confirm that Railway is actually running the latest code.
print(
    f"BOOT: Python {sys.version}, pid={os.getpid()}",
    flush=True,
)

# Configure Python logging BEFORE any logger is created.  Without this call
# the root logger defaults to WARNING and every logger.info() call in the
# application is silently dropped — which is why startup messages were never
# visible in Railway logs.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from dotenv import load_dotenv

# Load environment variables from .env file BEFORE importing any local modules.
# supabase_client.py (and auth.py) read env vars at import time, so dotenv must
# run first — otherwise .env values are invisible to module-level initialisation.
_env_paths = [
    Path(__file__).parent.parent / ".env",          # backend/websearch_service/.env
    Path(__file__).parent.parent.parent.parent / ".env",  # project root .env
]
for _env_path in _env_paths:
    if _env_path.exists():
        load_dotenv(_env_path)
        break

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from .config import get_app_settings, resolve_allowed_origins, validate_app_settings
from .health_checks import assess_readiness, liveness_payload, mark_startup_complete, release_info
from .middleware.correlation import CorrelationIdMiddleware
from .observability import init_observability
from .routes.admin import router as admin_router
from .routes.ai_proxy import router as ai_proxy_router
from .routes.search import router as search_router
from .routes.news import router as news_router
from .routes.trade_engine import router as trade_engine_router
from .routes.stock_ranking import router as stock_ranking_router
from .scheduler_config import (
    create_scheduler,
    is_primary_worker,
    run_startup_background_tasks,
    scheduler_enabled,
)
from .services.auth import validate_auth_configuration
from .services.admin_job_worker import run_admin_job_worker_loop
from .services.rate_limit import validate_rate_limit_configuration

logger = logging.getLogger(__name__)

START_TIME = time.time()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach hardening headers to every response."""

    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if os.getenv("ENVIRONMENT") == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )
        return response


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Web process lifecycle — scheduler runs only when SCHEDULER_ENABLED=true."""
    logger.info("STARTUP: lifespan startup block reached, pid=%s", os.getpid())

    scheduler = None
    admin_worker_stop: asyncio.Event | None = None
    admin_worker_task: asyncio.Task | None = None
    if scheduler_enabled():
        scheduler = create_scheduler()
        scheduler.start()
        logger.info(
            "Schedulers started in this process (SCHEDULER_ENABLED=true; "
            "intelligence=6h, ranking=01:00 UTC, memory=15m)"
        )
        admin_worker_stop = asyncio.Event()
        admin_worker_task = asyncio.create_task(run_admin_job_worker_loop(admin_worker_stop))
        logger.info("Admin job worker started in scheduler process")
    else:
        logger.info(
            "Schedulers disabled in this web worker. "
            "Run `python run_scheduler.py` on a single dedicated replica."
        )

    if is_primary_worker() and not scheduler_enabled():
        await run_startup_background_tasks()
    elif not is_primary_worker():
        logger.info(
            "STARTUP: skipping one-shot startup tasks — not primary worker "
            "(RAILWAY_REPLICA_ID=%s, WEB_CONCURRENCY=%s)",
            os.environ.get("RAILWAY_REPLICA_ID"),
            os.environ.get("WEB_CONCURRENCY"),
        )

    mark_startup_complete()

    try:
        yield
    finally:
        if admin_worker_stop is not None:
            admin_worker_stop.set()
        if admin_worker_task is not None:
            admin_worker_task.cancel()
            try:
                await admin_worker_task
            except asyncio.CancelledError:
                pass
        if scheduler is not None:
            scheduler.shutdown(wait=True)
            logger.info("Schedulers shut down")


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
    # Typed settings with fail-fast production validation (#210):
    # required env vars present and non-placeholder, explicit CORS origins,
    # explicit trusted-host allowlist — no unsafe production defaults.
    settings = get_app_settings()
    validate_app_settings(settings)
    validate_auth_configuration()
    validate_rate_limit_configuration()
    init_observability()

    app = FastAPI(
        title="AI Financial Advisor - Web Search Service",
        version=os.getenv("APP_VERSION", "0.1.0"),
        lifespan=_lifespan,
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
    # SECURITY: In production, CORS_ORIGINS must be set to the exact frontend
    # origin(s) — validate_app_settings() above refuses to start otherwise.
    # The same allowlist backs WebSocket Origin validation (#205), so both
    # policies can never drift apart.
    allowed_origins = resolve_allowed_origins(settings)
    allow_creds = True

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(CorrelationIdMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allow_creds,
        # SECURITY: Only allow the methods the API actually uses.
        allow_methods=["GET", "POST", "OPTIONS"],
        # SECURITY: Enumerate allowed headers instead of wildcard.
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "X-Idempotency-Key"],
        expose_headers=["X-Request-ID", "X-RateLimit-Limit-Minute", "X-RateLimit-Remaining-Minute", "X-RateLimit-Reset-Minute",
                        "X-RateLimit-Limit-Hour", "X-RateLimit-Remaining-Hour", "X-RateLimit-Reset-Hour",
                        "X-RateLimit-Limit-Day", "X-RateLimit-Remaining-Day", "X-RateLimit-Reset-Day"],
        max_age=600,  # 10 minutes — shorter preflight cache reduces stale-config window
    )
    
    # Trusted host middleware (production only). TRUSTED_HOSTS is mandatory in
    # production (#210) — validate_app_settings() already rejected empty or
    # wildcard values, so this middleware is always active there.
    if settings.is_production:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.trusted_hosts,
        )

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "AI Financial Advisor - Backend API",
            "docs": "/docs" if os.getenv("ENVIRONMENT") != "production" else "disabled in production",
        }

    @app.get("/health")
    async def health_check() -> dict[str, object]:
        import asyncio
        from .services.supabase_client import supabase_client as _sb_client

        # ── Supabase connectivity check ────────────────────────────────────
        def _ping_supabase() -> str:
            try:
                _sb_client.schema("core").table("users").select("id").limit(1).execute()
                return "ok"
            except Exception:
                return "error"

        supabase_status = await asyncio.to_thread(_ping_supabase)

        # ── OpenAI key presence check (no API call) ────────────────────────
        # SECURITY: Only check presence — never echo the key value.
        openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        _placeholders = ("sk-your", "your-key", "placeholder", "change-me", "xxxx")
        openai_status = (
            "ok"
            if openai_key and not any(openai_key.lower().startswith(p) for p in _placeholders)
            else "error"
        )

        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "release": release_info(),
            "services": {
                "supabase": supabase_status,
                "openai": openai_status,
            },
        }

    @app.get("/health/live")
    async def liveness_check() -> dict[str, str]:
        return liveness_payload()

    @app.get("/health/ready")
    async def readiness_check() -> dict[str, object]:
        report = await assess_readiness()
        if not report.get("ready"):
            raise HTTPException(status_code=503, detail=report)
        return report

    # Mount routers
    app.include_router(search_router, prefix="")
    app.include_router(ai_proxy_router, prefix="")
    app.include_router(news_router, prefix="")
    app.include_router(trade_engine_router, prefix="")
    app.include_router(stock_ranking_router, prefix="")
    app.include_router(admin_router, prefix="")

    return app


app = create_app()
