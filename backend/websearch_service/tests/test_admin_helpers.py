"""Tests for admin.py helper functions and uncovered route paths."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes.admin import (
    _check_dataapi,
    _fetch_ai_table_count,
    _fetch_recent_ai_activity,
    _gather_chat_dashboard,
    _get_admin_token,
    _get_supabase_rest_config,
    _parse_count,
    _require_admin,
    router as admin_router,
)


def _app_no_auth() -> FastAPI:
    app = FastAPI()
    app.include_router(admin_router)
    app.dependency_overrides[_require_admin] = lambda: "service-role"
    return app


def _fake_http_client(status_code: int = 200, json_data=None, raise_exc=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else []
    resp.text = "error body"
    if json_data is not None:
        resp.headers = {"content-range": f"0-9/{len(json_data) if isinstance(json_data, list) else 0}"}
    else:
        resp.headers = {}
    client = AsyncMock()
    if raise_exc:
        client.get = AsyncMock(side_effect=raise_exc)
        client.head = AsyncMock(side_effect=raise_exc)
        client.post = AsyncMock(side_effect=raise_exc)
    else:
        client.get = AsyncMock(return_value=resp)
        client.head = AsyncMock(return_value=resp)
        client.post = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client, resp


# ── _parse_count ─────────────────────────────────────────────────────────────

class TestParseCount:
    def test_valid_content_range(self):
        resp = MagicMock()
        resp.headers = {"content-range": "0-9/42"}
        assert _parse_count(resp) == 42

    def test_no_content_range_returns_zero(self):
        resp = MagicMock()
        resp.headers = {}  # empty dict, .get("content-range","") returns ""
        assert _parse_count(resp) == 0

    def test_star_total_returns_zero(self):
        resp = MagicMock()
        resp.headers = {"content-range": "0-9/*"}
        assert _parse_count(resp) == 0

    def test_invalid_total_returns_zero(self):
        resp = MagicMock()
        resp.headers = {"content-range": "0-9/notanumber"}
        assert _parse_count(resp) == 0

    def test_no_slash_returns_zero(self):
        resp = MagicMock()
        resp.headers = {"content-range": "0-9"}
        assert _parse_count(resp) == 0


# ── _check_dataapi ─────────────────────────────────────────────────────────────

class TestCheckDataapi:
    def test_not_configured_when_client_not_configured(self):
        mock_client = MagicMock()
        mock_client.is_configured = False
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(_check_dataapi())
        assert result["status"] == "not_configured"

    def test_connected_when_health_succeeds(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.check_health = AsyncMock(
            return_value={"database": True, "status": "ok"}
        )
        mock_client.base_url = "http://localhost:8080"
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(_check_dataapi())
        assert result["status"] == "connected"
        assert result["database"] is True

    def test_error_when_health_raises(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.check_health = AsyncMock(side_effect=RuntimeError("connection refused"))
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(_check_dataapi())
        assert result["status"] == "error"
        assert "connection refused" in result["message"]


# ── _fetch_ai_table_count ─────────────────────────────────────────────────────

class TestFetchAiTableCount:
    def test_returns_count_on_success(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        client, resp = _fake_http_client(status_code=200)
        resp.headers = {"content-range": "0-9/15"}
        with patch("app.routes.admin.httpx.AsyncClient", return_value=client):
            count = asyncio.get_event_loop().run_until_complete(
                _fetch_ai_table_count("chats")
            )
        assert count == 15

    def test_raises_502_on_http_error(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        client, _ = _fake_http_client(status_code=503)
        with patch("app.routes.admin.httpx.AsyncClient", return_value=client):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(
                    _fetch_ai_table_count("chats")
                )
        assert exc_info.value.status_code == 502


# ── _fetch_recent_ai_activity ─────────────────────────────────────────────────

class TestFetchRecentAiActivity:
    def test_returns_messages_on_success(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        messages = [{"id": "1", "user_id": "u1", "role": "user", "created_at": "2026-01-01"}]
        client, _ = _fake_http_client(status_code=200, json_data=messages)
        with patch("app.routes.admin.httpx.AsyncClient", return_value=client):
            result = asyncio.get_event_loop().run_until_complete(_fetch_recent_ai_activity())
        assert result == messages

    def test_raises_502_on_http_error(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        client, _ = _fake_http_client(status_code=500)
        with patch("app.routes.admin.httpx.AsyncClient", return_value=client):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(_fetch_recent_ai_activity())
        assert exc_info.value.status_code == 502


# ── _gather_chat_dashboard ───────────────────────────────────────────────────

class TestGatherChatDashboard:
    def test_returns_four_values(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        with patch("app.routes.admin._fetch_ai_table_count", new=AsyncMock(return_value=10)), \
             patch("app.routes.admin._fetch_recent_ai_activity", new=AsyncMock(return_value=[])):
            result = asyncio.get_event_loop().run_until_complete(
                _gather_chat_dashboard("2026-01-01")
            )
        assert len(result) == 4


# ── chat_dashboard route ───────────────────────────────────────────────────────

class TestChatDashboardRoute:
    def test_returns_dashboard_data(self):
        with patch(
            "app.routes.admin._gather_chat_dashboard",
            new=AsyncMock(return_value=(5, 20, 3, [
                {"id": "m1", "role": "user", "created_at": "2026-01-01"}
            ])),
        ):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/chat-dashboard")
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalChats"] == 5
        assert data["totalMessages"] == 20
        assert data["activeToday"] == 3
        assert len(data["recentActivity"]) == 1

    def test_ai_response_action_labeled_correctly(self):
        with patch(
            "app.routes.admin._gather_chat_dashboard",
            new=AsyncMock(return_value=(0, 1, 0, [
                {"id": "m2", "role": "assistant", "created_at": "2026-01-01"}
            ])),
        ):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/chat-dashboard")
        data = resp.json()
        assert "AI response" in data["recentActivity"][0]["action"]


# ── _get_admin_token ──────────────────────────────────────────────────────────

class TestGetAdminToken:
    def test_raises_503_when_credentials_missing(self, monkeypatch):
        monkeypatch.delenv("DATAAPI_ADMIN_URL", raising=False)
        monkeypatch.delenv("DATAAPI_ADMIN_CLIENT_ID", raising=False)
        monkeypatch.delenv("DATAAPI_ADMIN_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("DATAAPI_CLIENT_ID", raising=False)
        monkeypatch.delenv("DATAAPI_CLIENT_SECRET", raising=False)
        mock_client = MagicMock()
        mock_client.base_url = ""
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(_get_admin_token())
        assert exc_info.value.status_code == 503

    def test_returns_base_url_and_token_on_success(self, monkeypatch):
        monkeypatch.setenv("DATAAPI_ADMIN_URL", "http://dataapi.local")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_ID", "admin-client")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_SECRET", "admin-secret")
        mock_client = MagicMock()
        mock_client.base_url = "http://dataapi.local"
        http_client, resp = _fake_http_client(status_code=200, json_data={"access_token": "tok123"})
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client), \
             patch("app.routes.admin.httpx.AsyncClient", return_value=http_client):
            base_url, token = asyncio.get_event_loop().run_until_complete(_get_admin_token())
        assert base_url == "http://dataapi.local"
        assert token == "tok123"

    def test_raises_502_when_auth_fails(self, monkeypatch):
        monkeypatch.setenv("DATAAPI_ADMIN_URL", "http://dataapi.local")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_ID", "admin-client")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_SECRET", "admin-secret")
        mock_client = MagicMock()
        mock_client.base_url = "http://dataapi.local"
        http_client, _ = _fake_http_client(status_code=401)
        with patch("app.routes.admin.get_dataapi_client", return_value=mock_client), \
             patch("app.routes.admin.httpx.AsyncClient", return_value=http_client):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(_get_admin_token())
        assert exc_info.value.status_code == 502


# ── dataapi_query route ────────────────────────────────────────────────────────

class TestDataapiQuery:
    def test_non_select_query_returns_400(self):
        client = TestClient(_app_no_auth())
        resp = client.get("/api/admin/dataapi-query?q=DELETE+FROM+users")
        assert resp.status_code == 400

    def test_select_with_delete_in_cte_returns_400(self):
        client = TestClient(_app_no_auth())
        resp = client.get(
            "/api/admin/dataapi-query?q=SELECT+*+FROM+(DELETE+FROM+x+RETURNING+*)s"
        )
        assert resp.status_code == 400

    def test_valid_select_query_proxied(self, monkeypatch):
        monkeypatch.setenv("DATAAPI_ADMIN_URL", "http://dataapi.local")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_ID", "cid")
        monkeypatch.setenv("DATAAPI_ADMIN_CLIENT_SECRET", "csec")
        result_data = {"rows": [{"id": 1, "name": "test"}], "count": 1}
        http_client, _ = _fake_http_client(status_code=200, json_data=result_data)
        with patch("app.routes.admin._get_admin_token", new=AsyncMock(return_value=("http://dataapi.local", "token123"))), \
             patch("app.routes.admin.httpx.AsyncClient", return_value=http_client):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/dataapi-query?q=SELECT+1")
        assert resp.status_code == 200

    def test_dataapi_query_http_error_raises(self, monkeypatch):
        http_client, _ = _fake_http_client(status_code=500)
        with patch("app.routes.admin._get_admin_token", new=AsyncMock(return_value=("http://dataapi.local", "tok"))), \
             patch("app.routes.admin.httpx.AsyncClient", return_value=http_client):
            client = TestClient(_app_no_auth(), raise_server_exceptions=False)
            resp = client.get("/api/admin/dataapi-query?q=SELECT+1")
        assert resp.status_code == 500
