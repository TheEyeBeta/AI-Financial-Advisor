"""Tests for the DataAPI client service."""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock, patch

import pytest
import httpx

from app.services.dataapi_client import DataAPIClient, CachedToken


@pytest.fixture
def client():
    return DataAPIClient(
        base_url="http://dataapi.test:7000",
        client_id="test-client",
        client_secret="teb_sk_abcd1234_testSecretValue0123456789ab",
        enabled=True,
    )


@pytest.fixture
def disabled_client():
    return DataAPIClient(
        base_url="",
        client_id="",
        client_secret="",
        enabled=False,
    )


def test_is_configured_when_enabled(client: DataAPIClient):
    assert client.is_configured is True


def test_is_configured_when_disabled(disabled_client: DataAPIClient):
    assert disabled_client.is_configured is False


def test_is_configured_missing_url():
    c = DataAPIClient(base_url="", client_id="x", client_secret="y", enabled=True)
    assert c.is_configured is False


@pytest.mark.asyncio
async def test_authenticate_caches_token(client: DataAPIClient):
    mock_response = httpx.Response(
        200,
        json={
            "access_token": "jwt-token-123",
            "token_type": "Bearer",
            "expires_minutes": 60,
            "scopes": ["market:read"],
        },
        request=httpx.Request("POST", "http://dataapi.test:7000/api/v1/auth/service-token"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
        token1 = await client._authenticate()
        token2 = await client._authenticate()

    assert token1 == "jwt-token-123"
    assert token2 == "jwt-token-123"
    # Should only call once (second call uses cache)
    assert mock_post.call_count == 1


@pytest.mark.asyncio
async def test_authenticate_refreshes_expired_token(client: DataAPIClient):
    # Pre-seed an expired token
    client._cached_token = CachedToken(
        access_token="old-token",
        expires_at=time.time() - 10,
    )

    mock_response = httpx.Response(
        200,
        json={
            "access_token": "new-token-456",
            "token_type": "Bearer",
            "expires_minutes": 60,
            "scopes": ["market:read"],
        },
        request=httpx.Request("POST", "http://dataapi.test:7000/api/v1/auth/service-token"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        token = await client._authenticate()

    assert token == "new-token-456"


@pytest.mark.asyncio
async def test_get_quotes(client: DataAPIClient):
    # Pre-seed valid token
    client._cached_token = CachedToken(
        access_token="valid-jwt",
        expires_at=time.time() + 3600,
    )

    mock_response = httpx.Response(
        200,
        json={"quotes": [{"ticker": "AAPL", "last_price": 150.0}]},
        request=httpx.Request("GET", "http://dataapi.test:7000/api/v1/market-data/quotes"),
    )

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
        result = await client.get_quotes(["AAPL"])

    assert result["quotes"][0]["ticker"] == "AAPL"
    mock_get.assert_called_once()


@pytest.mark.asyncio
async def test_get_advisor_context(client: DataAPIClient):
    client._cached_token = CachedToken(
        access_token="valid-jwt",
        expires_at=time.time() + 3600,
    )

    mock_response = httpx.Response(
        200,
        json={"tickers": [], "news": [], "ticker_snapshot": None},
        request=httpx.Request("GET", "http://dataapi.test:7000/api/v1/context"),
    )

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
        result = await client.get_advisor_context(ticker="AAPL")

    assert "tickers" in result


@pytest.mark.asyncio
async def test_place_order_includes_idempotency_key(client: DataAPIClient):
    client._cached_token = CachedToken(
        access_token="valid-jwt",
        expires_at=time.time() + 3600,
    )

    mock_response = httpx.Response(
        200,
        json={"status": "accepted", "order_ref": "ord-123"},
        request=httpx.Request("POST", "http://dataapi.test:7000/api/v1/trades/orders"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
        result = await client.place_order(
            symbol="AAPL",
            side="buy",
            quantity=10,
            idempotency_key="idem-key-001",
        )

    assert result["status"] == "accepted"
    call_kwargs = mock_post.call_args
    assert "Idempotency-Key" in call_kwargs.kwargs.get("headers", {})


@pytest.mark.asyncio
async def test_check_health_no_auth(client: DataAPIClient):
    mock_response = httpx.Response(
        200,
        json={"status": "healthy", "database": True},
        request=httpx.Request("GET", "http://dataapi.test:7000/health"),
    )

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
        result = await client.check_health()

    assert result["status"] == "healthy"
