"""
News endpoint stub - returns empty results since news is handled by Supabase.
This endpoint exists to prevent 404 errors when the frontend calls it.
"""
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from ..services.auth import AuthenticatedUser, optional_auth
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
    Stub endpoint for news.
    
    Note: News articles are stored in Supabase (news_articles table).
    This endpoint returns empty results to prevent 404 errors.
    The frontend should use Supabase directly for news.
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

    try:
        return {
            "items": [],
            "next_cursor": None,
            "message": "News is available via Supabase news_articles table"
        }
    except Exception as e:
        # Log error but return empty results gracefully
        return {
            "items": [],
            "next_cursor": None,
            "error": str(e) if os.getenv("ENVIRONMENT") != "production" else None
        }
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)
