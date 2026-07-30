"""
News endpoint — cursor-paginated market news from TheEyeBetaDataAPI (#211).

Contract:
- Items are ordered deterministically by ``(published_at, id)`` descending,
  where ``id`` is a stable content hash. The opaque ``cursor`` encodes the
  last item of the previous page; pages never overlap or skip items that
  existed when pagination started.
- Provider failures are explicit: 503 (not configured), 504 (timeout),
  502 (upstream error). A legitimately empty feed is a 200 with no items.
- A short-lived in-process cache smooths provider load; on provider failure
  a bounded-age stale cache may be served with ``availability_status:
  "degraded"`` and ``stale: true`` so clients can label the data.
"""
import base64
import binascii
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..services.auth import AuthenticatedUser, optional_auth
from ..services.dataapi_client import get_dataapi_client
from ..services.rate_limit import RateLimitConfig, rate_limiter

logger = logging.getLogger(__name__)

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

DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 100
# The upstream DataAPI supports only `limit` (no offset/cursor), so pagination
# is served from the newest window of this size. Items older than the window
# are unreachable — next_cursor becomes null at the window edge.
PROVIDER_WINDOW = 100
FRESH_CACHE_TTL_SECONDS = 60
STALE_CACHE_MAX_AGE_SECONDS = 600


class NewsFeedItem(BaseModel):
    """One news article with a stable, content-derived id."""

    id: str
    ticker: Optional[str] = None
    headline: str
    summary: Optional[str] = None
    source: Optional[str] = None
    url: Optional[str] = None
    published_at: str
    sentiment_score: Optional[float] = None


class NewsFeedResponse(BaseModel):
    items: List[NewsFeedItem]
    next_cursor: Optional[str] = None
    data_source: str = "dataapi"
    availability_status: str = "ok"
    stale: bool = False
    as_of: str


# ── Cursor codec ─────────────────────────────────────────────────────────────

def encode_news_cursor(published_at: str, item_id: str) -> str:
    payload = json.dumps({"p": published_at, "i": item_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")


def decode_news_cursor(cursor: str) -> Tuple[str, str]:
    """Decode an opaque cursor; raises HTTPException(400) for anything malformed."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        published_at, item_id = payload["p"], payload["i"]
        if not isinstance(published_at, str) or not isinstance(item_id, str):
            raise ValueError("wrong cursor field types")
        return published_at, item_id
    except (KeyError, ValueError, TypeError, binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid pagination cursor",
                "reason_code": "invalid_cursor",
            },
        ) from exc


def _stable_item_id(raw: Dict[str, Any]) -> str:
    # Non-cryptographic content fingerprint; sha256 keeps bandit (B324) honest.
    basis = f"{raw.get('url') or raw.get('headline') or raw.get('title') or ''}|{raw.get('published_at') or ''}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def normalize_news_items(raw_news: List[Dict[str, Any]]) -> List[NewsFeedItem]:
    """Normalize provider rows and sort by (published_at, id) descending."""
    items = [
        NewsFeedItem(
            id=_stable_item_id(n),
            ticker=n.get("related_tickers") or None,
            headline=n.get("headline") or n.get("title", ""),
            summary=n.get("summary"),
            source=n.get("source") or n.get("provider"),
            url=n.get("url"),
            published_at=n.get("published_at", ""),
            sentiment_score=n.get("sentiment_score"),
        )
        for n in raw_news
    ]
    items.sort(key=lambda item: (item.published_at, item.id), reverse=True)
    # Content-hash ids also dedupe provider repeats within the window.
    seen: set[str] = set()
    unique: List[NewsFeedItem] = []
    for item in items:
        if item.id in seen:
            continue
        seen.add(item.id)
        unique.append(item)
    return unique


def paginate_news_items(
    items: List[NewsFeedItem],
    cursor: Optional[str],
    limit: int,
) -> Tuple[List[NewsFeedItem], Optional[str]]:
    """Slice a sorted-descending item list at the cursor; returns (page, next_cursor)."""
    if cursor is not None:
        cursor_key = decode_news_cursor(cursor)
        items = [item for item in items if (item.published_at, item.id) < cursor_key]
    page = items[:limit]
    next_cursor: Optional[str] = None
    if len(items) > limit and page:
        next_cursor = encode_news_cursor(page[-1].published_at, page[-1].id)
    return page, next_cursor


# ── Provider window cache ────────────────────────────────────────────────────

_window_cache: Dict[str, Any] = {"fetched_at": 0.0, "items": None}


def reset_news_cache() -> None:
    """Test hook."""
    _window_cache["fetched_at"] = 0.0
    _window_cache["items"] = None


def _cache_age() -> float:
    return time.monotonic() - _window_cache["fetched_at"]


def _cached_items(max_age: float) -> Optional[List[NewsFeedItem]]:
    if _window_cache["items"] is None or _cache_age() > max_age:
        return None
    return _window_cache["items"]


async def _fetch_news_window() -> Tuple[List[NewsFeedItem], bool]:
    """Return ``(items, stale)`` for the provider window, using the cache.

    Raises HTTPException 503/504/502 when the provider is unavailable and no
    acceptable stale cache exists.
    """
    fresh = _cached_items(FRESH_CACHE_TTL_SECONDS)
    if fresh is not None:
        return fresh, False

    client = get_dataapi_client()
    if not client.is_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "News provider is not configured; use Supabase market.news",
                "availability_status": "not_configured",
                "reason_code": "dataapi_not_configured",
            },
        )

    try:
        data = await client.get_market_news(limit=PROVIDER_WINDOW)
    except httpx.TimeoutException as exc:
        stale = _cached_items(STALE_CACHE_MAX_AGE_SECONDS)
        if stale is not None:
            logger.warning("News provider timed out; serving stale cache (age %.0fs)", _cache_age())
            return stale, True
        raise HTTPException(
            status_code=504,
            detail={
                "message": "News provider timed out",
                "availability_status": "unavailable",
                "reason_code": "dataapi_timeout",
            },
        ) from exc
    except Exception as exc:
        stale = _cached_items(STALE_CACHE_MAX_AGE_SECONDS)
        if stale is not None:
            logger.warning("News provider failed (%s); serving stale cache (age %.0fs)",
                           type(exc).__name__, _cache_age())
            return stale, True
        raise HTTPException(
            status_code=502,
            detail={
                "message": "News provider request failed",
                "availability_status": "unavailable",
                "reason_code": "dataapi_error",
                "error": str(exc) if os.getenv("ENVIRONMENT") != "production" else None,
            },
        ) from exc

    items = normalize_news_items(data.get("news", []))
    _window_cache["items"] = items
    _window_cache["fetched_at"] = time.monotonic()
    return items, False


@router.get("/api/news", response_model=NewsFeedResponse)
async def get_news(
    raw_request: Request,
    response: Response,
    limit: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE,
                       description="Maximum number of news items to return"),
    cursor: Optional[str] = Query(None, description=(
        "Opaque pagination cursor from a previous response's next_cursor. "
        "Ordering is (published_at, id) descending."
    )),
    auth_user: Optional[AuthenticatedUser] = Depends(optional_auth),
):
    """
    Return market news from DataAPI when configured, newest first.

    Returns 400 for invalid cursors, 503 when the provider is not configured
    (clients should use Supabase `market.news`, the canonical table — see
    sql/schema.sql; `market.news_articles` is a legacy source table only),
    504 on provider timeout,
    and 502 on provider failure. Empty feeds are a successful empty list.
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
        window, stale = await _fetch_news_window()
        page, next_cursor = paginate_news_items(window, cursor, limit)
        return NewsFeedResponse(
            items=page,
            next_cursor=next_cursor,
            data_source="dataapi",
            availability_status="degraded" if stale else "ok",
            stale=stale,
            as_of=datetime.now(timezone.utc).isoformat(),
        )
    except HTTPException as exc:
        if isinstance(exc.detail, dict):
            # Preserve rate-limit headers on structured error responses.
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=dict(response.headers),
            )
        raise
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)
