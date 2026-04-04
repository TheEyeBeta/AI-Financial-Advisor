import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

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

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .routes.admin import router as admin_router
from .routes.ai_proxy import router as ai_proxy_router
from .routes.search import check_search_provider, router as search_router
from .routes.news import router as news_router
from .routes.trade_engine import router as trade_engine_router
from .routes.stock_ranking import router as stock_ranking_router
from .services.auth import validate_auth_configuration
from .services.intelligence_engine import run_intelligence_cycle
from .services.ranking_engine import run_ranking_cycle

logger = logging.getLogger(__name__)

START_TIME = time.time()

# Guard: ensures the one-time startup ranking cycle fires on the very first
# lifespan start and is skipped on any subsequent hot-reload within the same
# process (e.g. uvicorn --reload).  A fresh OS process always starts False.
_startup_ranking_done: bool = False


async def _run_scheduled_cycle() -> None:
    """Scheduler callback: run one intelligence cycle and log the summary."""
    try:
        summary = await run_intelligence_cycle()
        logger.info(
            "Scheduled intelligence cycle: users_processed=%s digests_generated=%s errors=%s%s",
            summary.get("users_processed", 0),
            summary.get("digests_generated", 0),
            len(summary.get("errors", [])),
            " [skipped — previous cycle still running]" if summary.get("skipped") else "",
        )
    except Exception as exc:
        # Belt-and-suspenders: run_intelligence_cycle() never raises, but if it
        # ever does we must not let APScheduler swallow the exception silently.
        logger.error(
            "Scheduled intelligence cycle raised an unexpected exception: %s",
            type(exc).__name__,
        )


async def _run_scheduled_ranking_cycle() -> None:
    """Scheduler callback: run one ranking cycle and log the summary."""
    try:
        summary = await run_ranking_cycle()
        if summary.get("skipped"):
            logger.info("Scheduled ranking cycle: skipped — previous cycle still running")
        else:
            logger.info(
                "Scheduled ranking cycle: tickers_scored=%s tickers_failed=%s "
                "top_50_written=%s duration=%.1fs",
                summary.get("tickers_scored", 0),
                summary.get("tickers_failed", 0),
                summary.get("top_50_written", 0),
                summary.get("cycle_duration_seconds", 0.0),
            )
    except Exception as exc:
        logger.error(
            "Scheduled ranking cycle raised an unexpected exception: %s",
            type(exc).__name__,
        )


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Start schedulers on startup; shut them down on shutdown."""
    scheduler = AsyncIOScheduler()

    # Intelligence digest cycle — every 6 hours
    scheduler.add_job(
        _run_scheduled_cycle,
        trigger="interval",
        hours=6,
        id="intelligence_cycle",
        replace_existing=True,
        # Allow up to 1 hour of lateness before skipping a missed execution.
        misfire_grace_time=3600,
    )

    # Stock ranking cycle — daily at 01:00 UTC
    # Runs after market close and before pg_cron cleanup at 02:00 UTC.
    scheduler.add_job(
        _run_scheduled_ranking_cycle,
        trigger="cron",
        hour=1,
        minute=0,
        timezone="UTC",
        id="ranking_cycle",
        replace_existing=True,
        # Allow up to 30 minutes of lateness before skipping.
        misfire_grace_time=1800,
    )

    scheduler.start()
    logger.info("Schedulers started (intelligence=6h interval, ranking=daily 01:00 UTC)")

    # Fire-and-forget: populate market.trending_stocks immediately on the
    # first deploy so the table is ready before the first user request.
    # The _startup_ranking_done flag ensures this only fires once per process
    # lifetime — hot-reloads (uvicorn --reload) won't re-trigger it.
    import asyncio as _asyncio
    global _startup_ranking_done
    if not _startup_ranking_done:
        _startup_ranking_done = True
        _asyncio.create_task(_run_scheduled_ranking_cycle())
        logger.info("Ranking cycle queued for immediate startup run (background)")

    try:
        yield
    finally:
        scheduler.shutdown(wait=False)
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
    validate_auth_configuration()

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
        # Development: use an explicit list of common local dev ports so that
        # allow_credentials=True works correctly (wildcard '*' is incompatible
        # with credentialed requests that carry an Authorization header).
        default_dev_origins = [
            "http://localhost:8080",   # Vite on custom port (this project)
            "http://localhost:5173",   # Vite default
            "http://localhost:3000",   # CRA / other
            "http://127.0.0.1:8080",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000",
        ]
        extra_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
        # dict.fromkeys preserves insertion order and deduplicates
        allowed_origins = list(dict.fromkeys(default_dev_origins + extra_origins))
        allow_creds = True

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
            "services": {
                "supabase": supabase_status,
                "openai": openai_status,
            },
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
    app.include_router(stock_ranking_router, prefix="")
    app.include_router(admin_router, prefix="")

    return app


app = create_app()
