"""
News endpoint stub - returns empty results since news is handled by Supabase.
This endpoint exists to prevent 404 errors when the frontend calls it.
"""
import os
from fastapi import APIRouter, Query
from typing import Dict, Any, Optional

router = APIRouter(tags=["news"])


@router.get("/api/news")
async def get_news(
    limit: int = Query(30, ge=1, le=100, description="Maximum number of news items to return"),
    cursor: Optional[str] = Query(None, description="Pagination cursor")
) -> Dict[str, Any]:
    """
    Stub endpoint for news.
    
    Note: News articles are stored in Supabase (news_articles table).
    This endpoint returns empty results to prevent 404 errors.
    The frontend should use Supabase directly for news.
    """
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
