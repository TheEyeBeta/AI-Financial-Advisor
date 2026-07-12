"""
News endpoint — serves market news from TheEyeBetaDataAPI when configured.
Returns explicit errors when the provider is unavailable.
"""
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from ..services.auth import AuthenticatedUser, optional_auth
from ..services.dataapi_client import get_dataapi_client
from ..services.rate_limit import RateLimitConfig, rate_limiter

router = APIRouter(tags=["news"])

ANONYMOUS_RATE_LIMIT = RateLimitConfig(
    requests_per_minute=10,
    requests_per_hour=600,
    requests_per_day=14400,
)
AUTHENTICATED_RATE_LIMIT = RateLimitConfig(
    requests_per_minute=60,
    requests_per_hour=3600,
    requests_per_day=86400,
    suspicious_request_threshold=120,
)


@router.get("/api/news")
async def get_news(
    raw_request: Request,
    response: Response,
    limit: int = Query(30, ge=1, le=100, description="Maximum number of news items to return"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    auth_user: Optional[AuthenticatedUser] = Depends(optional_auth),
) -> Dict[str, Any]:
    """
    Return market news from DataAPI when configured.

    Clients should use Supabase `news_articles` when this endpoint returns 503.
    """
    verified_user_id = auth_user.auth_id if auth_user else None
    rate_limit_config = AUTHENTICATED_RATE_LIMIT if verified_user_id else ANONYMOUS_RATE_LIMIT

    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/news",
        user_id=verified_user_id,
        estimated_tokens=0,
        config_override=rate_limit_config,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    def _unavailable_response(status_code: int, payload: Dict[str, Any]) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={"detail": payload},
            headers=dict(response.headers),
        )

    try:
        client = get_dataapi_client()
        if client.is_configured:
            data = await client.get_market_news(limit=limit)
            raw_news = data.get("news", [])
            items = [
                {
                    "id": i,
                    "ticker": n.get("related_tickers") or None,
                    "headline": n.get("headline") or n.get("title", ""),
                    "summary": n.get("summary"),
                    "source": n.get("source") or n.get("provider"),
                    "url": n.get("url"),
                    "published_at": n.get("published_at", ""),
                    "sentiment_score": n.get("sentiment_score"),
                }
                for i, n in enumerate(raw_news)
            ]
            return {"items": items, "next_cursor": None}

        return _unavailable_response(
            503,
            {
                "message": "News provider is not configured; use Supabase news_articles",
                "availability_status": "not_configured",
                "reason_code": "dataapi_not_configured",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        return _unavailable_response(
            502,
            {
                "message": "News provider request failed",
                "availability_status": "unavailable",
                "reason_code": "dataapi_error",
                "error": str(e) if os.getenv("ENVIRONMENT") != "production" else None,
            },
        )
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)
