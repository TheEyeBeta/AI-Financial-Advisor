"""Client for TheEyeBetaDataAPI service authentication and data access.

Handles service credential authentication, JWT caching, and typed API calls
to the centralized DataAPI gateway.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("advisor.dataapi_client")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATAAPI_URL = os.getenv("DATAAPI_URL", "").rstrip("/")
DATAAPI_CLIENT_ID = os.getenv("DATAAPI_CLIENT_ID", "")
DATAAPI_CLIENT_SECRET = os.getenv("DATAAPI_CLIENT_SECRET", "")
DATAAPI_ENABLED = os.getenv("DATAAPI_ENABLED", "false").lower() in ("true", "1", "yes")

# Refresh JWT when less than this many seconds remain before expiry.
_TOKEN_REFRESH_MARGIN_SECONDS = 120


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class CachedToken:
    """Cached service JWT with expiry tracking."""

    access_token: str
    expires_at: float  # epoch seconds


@dataclass
class DataAPIClient:
    """Authenticated client for TheEyeBetaDataAPI.

    Usage::

        client = DataAPIClient()
        if client.is_configured:
            quotes = await client.get_quotes(["AAPL", "MSFT"])
    """

    base_url: str = field(default_factory=lambda: DATAAPI_URL)
    client_id: str = field(default_factory=lambda: DATAAPI_CLIENT_ID)
    client_secret: str = field(default_factory=lambda: DATAAPI_CLIENT_SECRET)
    enabled: bool = field(default_factory=lambda: DATAAPI_ENABLED)
    timeout: float = 15.0

    _cached_token: CachedToken | None = field(default=None, init=False, repr=False)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_configured(self) -> bool:
        """Return True if all required settings are present and feature is enabled."""
        return bool(self.enabled and self.base_url and self.client_id and self.client_secret)

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    async def _authenticate(self) -> str:
        """Obtain a service JWT from DataAPI, caching until near-expiry."""
        if self._cached_token and self._cached_token.expires_at > time.time() + _TOKEN_REFRESH_MARGIN_SECONDS:
            return self._cached_token.access_token

        url = f"{self.base_url}/api/v1/auth/service-token"
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            resp = await http.post(
                url,
                auth=(self.client_id, self.client_secret),
                json={"requested_scopes": []},  # request all granted scopes
            )
            resp.raise_for_status()

        body = resp.json()
        access_token = body["access_token"]
        expires_minutes = body.get("expires_minutes", 60)
        self._cached_token = CachedToken(
            access_token=access_token,
            expires_at=time.time() + (expires_minutes * 60),
        )
        logger.info("DataAPI service token obtained (expires in %d min)", expires_minutes)
        return access_token

    async def _headers(self) -> dict[str, str]:
        token = await self._authenticate()
        return {"Authorization": f"Bearer {token}"}

    # ------------------------------------------------------------------
    # API methods
    # ------------------------------------------------------------------

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        headers = await self._headers()
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            resp = await http.get(f"{self.base_url}{path}", headers=headers, params=params)
            resp.raise_for_status()
        return resp.json()

    async def _post(self, path: str, json_body: dict[str, Any] | None = None, extra_headers: dict[str, str] | None = None) -> Any:
        headers = await self._headers()
        if extra_headers:
            headers.update(extra_headers)
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            resp = await http.post(f"{self.base_url}{path}", headers=headers, json=json_body)
            resp.raise_for_status()
        return resp.json()

    # -- Market Data --

    async def get_quotes(self, symbols: list[str]) -> dict[str, Any]:
        """GET /api/v1/market-data/quotes?symbols=AAPL,MSFT"""
        return await self._get("/api/v1/market-data/quotes", {"symbols": ",".join(symbols)})

    async def search_symbols(self, query: str, limit: int = 25) -> dict[str, Any]:
        """GET /api/v1/symbols/search?q=...&limit=..."""
        return await self._get("/api/v1/symbols/search", {"q": query, "limit": limit})

    # -- Analytics --

    async def get_analytics_snapshot(self, ticker: str) -> dict[str, Any]:
        """GET /api/v1/analytics/snapshots/{ticker}"""
        return await self._get(f"/api/v1/analytics/snapshots/{ticker}")

    # -- Context & Chat --

    async def get_advisor_context(
        self,
        ticker: str | None = None,
        ticker_limit: int = 25,
        news_limit: int = 10,
    ) -> dict[str, Any]:
        """GET /api/v1/context"""
        params: dict[str, Any] = {"ticker_limit": ticker_limit, "news_limit": news_limit}
        if ticker:
            params["ticker"] = ticker
        return await self._get("/api/v1/context", params)

    # -- Signals --

    async def get_latest_signals(self, ticker: str | None = None, limit: int = 20) -> dict[str, Any]:
        """GET /api/v1/signals/latest"""
        params: dict[str, Any] = {"limit": limit}
        if ticker:
            params["ticker"] = ticker
        return await self._get("/api/v1/signals/latest", params)

    # -- Portfolio --

    async def get_portfolio_state(self, owner_subject: str, position_limit: int = 50) -> dict[str, Any]:
        """GET /api/v1/portfolio/state"""
        return await self._get(
            "/api/v1/portfolio/state",
            {"owner_subject": owner_subject, "position_limit": position_limit},
        )

    # -- Trades --

    async def place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        idempotency_key: str,
        limit_price: float | None = None,
    ) -> dict[str, Any]:
        """POST /api/v1/trades/orders"""
        body: dict[str, Any] = {"symbol": symbol, "side": side, "quantity": quantity}
        if limit_price is not None:
            body["limit_price"] = limit_price
        return await self._post(
            "/api/v1/trades/orders",
            json_body=body,
            extra_headers={"Idempotency-Key": idempotency_key},
        )

    # -- Health --

    async def check_health(self) -> dict[str, Any]:
        """GET /health (no auth required)."""
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            resp = await http.get(f"{self.base_url}/health")
            resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------

_client: DataAPIClient | None = None


def get_dataapi_client() -> DataAPIClient:
    """Return the global DataAPIClient instance."""
    global _client
    if _client is None:
        _client = DataAPIClient()
    return _client
