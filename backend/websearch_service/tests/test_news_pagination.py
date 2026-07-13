"""Tests for app.routes.news — cursor pagination and honest failure states (#211)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import news as news_route
from app.routes.news import (
    decode_news_cursor,
    encode_news_cursor,
    normalize_news_items,
    paginate_news_items,
    reset_news_cache,
)
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _fresh_cache():
    reset_news_cache()
    yield
    reset_news_cache()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _raw_article(i: int, published_at: str) -> dict:
    return {
        "headline": f"Headline {i}",
        "summary": f"Summary {i}",
        "source": "TestWire",
        "url": f"https://news.test/{i}",
        "published_at": published_at,
        "sentiment_score": 0.1,
    }


def _dataset(count: int) -> list[dict]:
    # Distinct, descending-friendly timestamps.
    return [_raw_article(i, f"2026-07-{(i % 28) + 1:02d}T{i % 24:02d}:00:00Z") for i in range(count)]


def _provider(articles: list[dict]) -> MagicMock:
    fake = MagicMock()
    fake.is_configured = True
    fake.get_market_news = AsyncMock(return_value={"news": articles})
    return fake


# ── Cursor codec ─────────────────────────────────────────────────────────────

def test_cursor_roundtrip():
    cursor = encode_news_cursor("2026-07-01T00:00:00Z", "abc123")
    assert decode_news_cursor(cursor) == ("2026-07-01T00:00:00Z", "abc123")


@pytest.mark.parametrize("bad", ["not-base64!!!", "aGVsbG8", "", "eyJ4IjoxfQ"])
def test_invalid_cursor_raises_400(bad):
    with pytest.raises(HTTPException) as exc_info:
        decode_news_cursor(bad)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["reason_code"] == "invalid_cursor"


# ── Pagination over a fixed dataset ──────────────────────────────────────────

def test_paging_returns_every_item_exactly_once():
    items = normalize_news_items(_dataset(25))
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        page, cursor = paginate_news_items(items, cursor, 10)
        seen.extend(item.id for item in page)
        pages += 1
        if cursor is None:
            break
    assert pages == 3
    assert len(seen) == 25
    assert len(set(seen)) == 25  # no duplicates
    # Deterministic descending order across pages.
    keys = [(item.published_at, item.id) for item in items]
    assert keys == sorted(keys, reverse=True)


def test_final_page_has_no_next_cursor():
    items = normalize_news_items(_dataset(10))
    page, cursor = paginate_news_items(items, None, 10)
    assert len(page) == 10
    assert cursor is None


def test_new_records_do_not_shift_established_pages():
    original = normalize_news_items(_dataset(20))
    first_page, cursor = paginate_news_items(original, None, 10)
    assert cursor is not None

    # A newer article arrives mid-pagination.
    newer = normalize_news_items(_dataset(20) + [_raw_article(99, "2026-07-30T00:00:00Z")])
    second_page, _ = paginate_news_items(newer, cursor, 10)

    first_ids = {item.id for item in first_page}
    # Page 2 never repeats page-1 items and never skips the untouched tail.
    assert first_ids.isdisjoint({item.id for item in second_page})
    expected_tail = [item.id for item in original[10:20]]
    assert [item.id for item in second_page] == expected_tail


def test_duplicate_provider_rows_are_deduped():
    rows = _dataset(5) + [_raw_article(0, "2026-07-01T00:00:00Z")] * 2
    # Same URL + published_at → same stable id → single item.
    items = normalize_news_items(rows)
    ids = [item.id for item in items]
    assert len(ids) == len(set(ids))


# ── HTTP behaviour ───────────────────────────────────────────────────────────

def test_endpoint_paginates_with_next_cursor(client):
    with patch.object(news_route, "get_dataapi_client", return_value=_provider(_dataset(25))):
        first = client.get("/api/news", params={"limit": 10})
        assert first.status_code == 200
        body = first.json()
        assert len(body["items"]) == 10
        assert body["next_cursor"]
        assert body["availability_status"] == "ok"
        assert body["stale"] is False
        assert body["data_source"] == "dataapi"
        assert body["as_of"]

        second = client.get("/api/news", params={"limit": 10, "cursor": body["next_cursor"]})
        assert second.status_code == 200
        second_body = second.json()
        first_ids = {i["id"] for i in body["items"]}
        assert first_ids.isdisjoint({i["id"] for i in second_body["items"]})


def test_endpoint_rejects_invalid_cursor(client):
    with patch.object(news_route, "get_dataapi_client", return_value=_provider(_dataset(5))):
        resp = client.get("/api/news", params={"cursor": "garbage!!"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["reason_code"] == "invalid_cursor"


def test_endpoint_bounds_page_size(client):
    resp = client.get("/api/news", params={"limit": 500})
    assert resp.status_code == 422  # ge/le validation


def test_zero_results_is_success_with_metadata(client):
    with patch.object(news_route, "get_dataapi_client", return_value=_provider([])):
        resp = client.get("/api/news")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["next_cursor"] is None
    assert body["availability_status"] == "ok"


def test_not_configured_returns_503(client):
    fake = MagicMock()
    fake.is_configured = False
    with patch.object(news_route, "get_dataapi_client", return_value=fake):
        resp = client.get("/api/news")
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason_code"] == "dataapi_not_configured"


def test_provider_error_returns_502(client):
    fake = MagicMock()
    fake.is_configured = True
    fake.get_market_news = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(news_route, "get_dataapi_client", return_value=fake):
        resp = client.get("/api/news")
    assert resp.status_code == 502
    assert resp.json()["detail"]["reason_code"] == "dataapi_error"


def test_provider_timeout_returns_504(client):
    fake = MagicMock()
    fake.is_configured = True
    fake.get_market_news = AsyncMock(side_effect=httpx.ReadTimeout("slow"))
    with patch.object(news_route, "get_dataapi_client", return_value=fake):
        resp = client.get("/api/news")
    assert resp.status_code == 504
    assert resp.json()["detail"]["reason_code"] == "dataapi_timeout"


def test_stale_cache_served_as_degraded_on_provider_failure(client):
    # Warm the cache…
    with patch.object(news_route, "get_dataapi_client", return_value=_provider(_dataset(5))):
        warm = client.get("/api/news")
        assert warm.status_code == 200

    # …then break the provider and age the cache past the fresh TTL.
    news_route._window_cache["fetched_at"] -= news_route.FRESH_CACHE_TTL_SECONDS + 1
    fake = MagicMock()
    fake.is_configured = True
    fake.get_market_news = AsyncMock(side_effect=httpx.ReadTimeout("slow"))
    with patch.object(news_route, "get_dataapi_client", return_value=fake):
        resp = client.get("/api/news")

    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["availability_status"] == "degraded"
    assert len(body["items"]) == 5


def test_stale_cache_expires_and_timeout_surfaces(client):
    with patch.object(news_route, "get_dataapi_client", return_value=_provider(_dataset(5))):
        client.get("/api/news")

    # Age the cache beyond the stale allowance.
    news_route._window_cache["fetched_at"] -= news_route.STALE_CACHE_MAX_AGE_SECONDS + 1
    fake = MagicMock()
    fake.is_configured = True
    fake.get_market_news = AsyncMock(side_effect=httpx.ReadTimeout("slow"))
    with patch.object(news_route, "get_dataapi_client", return_value=fake):
        resp = client.get("/api/news")
    assert resp.status_code == 504
