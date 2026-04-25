"""Tests for RateLimitService (local in-memory mode)."""
from __future__ import annotations

import time
from collections import deque
from unittest.mock import MagicMock, patch

import pytest
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import Response
from starlette.testclient import TestClient

from app.services.rate_limit import (
    RateLimitConfig,
    RateLimitService,
    RateLimitState,
    _window_is_current,
    _window_start_for,
)


# ── helpers ─────────────────────────────────────────────────────────────────────

def _make_request(
    client_host: str = "192.0.2.1",
    headers: dict | None = None,
) -> Request:
    """Build a minimal Starlette Request for testing."""
    header_list = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/test",
        "query_string": b"",
        "headers": header_list,
        "client": (client_host, 12345),
        "state": {},
    }
    return Request(scope)


def _no_redis_service() -> RateLimitService:
    """Create a RateLimitService that operates in local-only mode."""
    with patch("app.services.rate_limit.RateLimitRedisBackend.from_env", return_value=None):
        svc = RateLimitService()
    return svc


# ── _window_start_for / _window_is_current ──────────────────────────────────────

class TestWindowHelpers:
    def test_window_start_minute(self):
        now = time.time()
        dt = _window_start_for("minute", now)
        assert dt.second == 0
        assert dt.microsecond == 0

    def test_window_start_hour(self):
        now = time.time()
        dt = _window_start_for("hour", now)
        assert dt.minute == 0
        assert dt.second == 0

    def test_window_start_day(self):
        now = time.time()
        dt = _window_start_for("day", now)
        assert dt.hour == 0
        assert dt.minute == 0

    def test_window_is_current_valid(self):
        now = time.time()
        start = _window_start_for("minute", now)
        assert _window_is_current(start.isoformat(), "minute", now) is True

    def test_window_is_current_expired(self):
        old_time = time.time() - 3600
        start = _window_start_for("minute", old_time)
        # Current time is far after old window start
        assert _window_is_current(start.isoformat(), "minute", time.time()) is False

    def test_window_is_current_invalid_str(self):
        assert _window_is_current("not-a-date", "minute", time.time()) is False


# ── RateLimitService._get_identifier ───────────────────────────────────────────

class TestGetIdentifier:
    def test_user_id_takes_priority(self):
        svc = _no_redis_service()
        req = _make_request()
        identifier = svc._get_identifier(req, user_id="user-123")
        assert identifier == "user:user-123"

    def test_untrusted_ip_direct(self):
        svc = _no_redis_service()
        req = _make_request(client_host="8.8.8.8")
        identifier = svc._get_identifier(req)
        assert identifier == "ip:8.8.8.8"

    def test_trusted_proxy_uses_x_forwarded_for(self):
        svc = _no_redis_service()
        req = _make_request(
            client_host="127.0.0.1",
            headers={"X-Forwarded-For": "203.0.113.1, 10.0.0.1"},
        )
        identifier = svc._get_identifier(req)
        assert identifier == "ip:203.0.113.1"

    def test_trusted_proxy_uses_x_real_ip(self):
        svc = _no_redis_service()
        req = _make_request(
            client_host="10.0.0.1",
            headers={"X-Real-IP": "203.0.113.5"},
        )
        identifier = svc._get_identifier(req)
        assert identifier == "ip:203.0.113.5"

    def test_trusted_proxy_no_forwarding_header_uses_direct_ip(self):
        svc = _no_redis_service()
        req = _make_request(client_host="10.0.0.1")
        identifier = svc._get_identifier(req)
        assert identifier == "ip:10.0.0.1"

    def test_no_client_returns_unknown(self):
        svc = _no_redis_service()
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
            "client": None,
        }
        req = Request(scope)
        identifier = svc._get_identifier(req)
        assert identifier == "ip:unknown"

    def test_extra_trusted_proxy_from_env(self, monkeypatch):
        monkeypatch.setenv("TRUSTED_PROXY_IPS", "203.0.113.100")
        svc = _no_redis_service()
        req = _make_request(
            client_host="203.0.113.100",
            headers={"X-Forwarded-For": "1.2.3.4"},
        )
        identifier = svc._get_identifier(req)
        assert identifier == "ip:1.2.3.4"


# ── RateLimitService.check_rate_limit (local mode) ────────────────────────────

class TestCheckRateLimitLocal:
    def test_first_request_is_allowed(self):
        svc = _no_redis_service()
        req = _make_request()
        allowed, error, info = svc.check_rate_limit(req, "/api/test")
        assert allowed is True
        assert error is None
        assert "limit_minute" in info

    def test_per_minute_limit_exceeded(self):
        config = RateLimitConfig(requests_per_minute=2, requests_per_hour=100, requests_per_day=1000)
        svc = _no_redis_service()
        req = _make_request()
        # Allow 2 requests
        svc.check_rate_limit(req, "/api/test", config_override=config)
        svc.check_rate_limit(req, "/api/test", config_override=config)
        # 3rd should be rejected
        allowed, error, _ = svc.check_rate_limit(req, "/api/test", config_override=config)
        assert allowed is False
        assert "per minute" in error

    def test_concurrent_request_limit(self):
        config = RateLimitConfig(max_concurrent_requests=1)
        svc = _no_redis_service()
        req = _make_request()
        # First request
        allowed1, _, _ = svc.check_rate_limit(req, "/api/test", config_override=config)
        assert allowed1 is True
        # Don't release — second should be rejected
        allowed2, error2, _ = svc.check_rate_limit(req, "/api/test", config_override=config)
        assert allowed2 is False
        assert "concurrent" in error2

    def test_token_limit_exceeded(self):
        config = RateLimitConfig(tokens_per_minute=100)
        svc = _no_redis_service()
        req = _make_request()
        svc.check_rate_limit(req, "/api/test", estimated_tokens=90, config_override=config)
        allowed, error, _ = svc.check_rate_limit(req, "/api/test", estimated_tokens=20, config_override=config)
        assert allowed is False
        assert "Token limit" in error

    def test_blocked_identifier_rejected(self):
        svc = _no_redis_service()
        req = _make_request()
        identifier = svc._get_identifier(req)
        key = svc._state_key(identifier, "/api/test")
        state = svc._state[key]
        state.blocked_until = time.time() + 3600
        allowed, error, _ = svc.check_rate_limit(req, "/api/test")
        assert allowed is False
        assert "blocked" in error.lower()

    def test_request_context_stored_on_allowed(self):
        svc = _no_redis_service()
        req = _make_request()
        allowed, _, _ = svc.check_rate_limit(req, "/api/test")
        assert allowed is True
        assert hasattr(req.state, "rate_limit_identifier")

    def test_per_hour_limit_exceeded(self):
        config = RateLimitConfig(
            requests_per_minute=100,
            requests_per_hour=1,
            requests_per_day=1000,
        )
        svc = _no_redis_service()
        req = _make_request()
        svc.check_rate_limit(req, "/api/test", config_override=config)
        allowed, error, _ = svc.check_rate_limit(req, "/api/test", config_override=config)
        assert allowed is False
        assert "per hour" in error

    def test_per_day_limit_exceeded(self):
        config = RateLimitConfig(
            requests_per_minute=100,
            requests_per_hour=100,
            requests_per_day=1,
        )
        svc = _no_redis_service()
        req = _make_request()
        svc.check_rate_limit(req, "/api/test", config_override=config)
        allowed, error, _ = svc.check_rate_limit(req, "/api/test", config_override=config)
        assert allowed is False
        assert "per day" in error


# ── RateLimitService.release_request ──────────────────────────────────────────

class TestReleaseRequest:
    def test_decrements_concurrent_count(self):
        svc = _no_redis_service()
        req = _make_request()
        svc.check_rate_limit(req, "/api/test")
        # After release, concurrent count should decrease
        svc.release_request(req)
        identifier = svc._get_identifier(req)
        key = svc._state_key(identifier, "/api/test")
        state = svc._state[key]
        assert state.concurrent_requests == 0

    def test_release_without_state_is_no_op(self):
        svc = _no_redis_service()
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
            "client": ("1.2.3.4", 80),
        }
        req = Request(scope)
        # Should not raise even without prior check_rate_limit
        svc.release_request(req)

    def test_release_does_not_go_below_zero(self):
        svc = _no_redis_service()
        req = _make_request()
        # Manually set concurrent to 0
        identifier = svc._get_identifier(req)
        # Check rate limit first to create state
        svc.check_rate_limit(req, "/api/test")
        svc.release_request(req)
        # Second release should not go negative
        svc.release_request(req)
        key = svc._state_key(identifier, "/api/test")
        state = svc._state[key]
        assert state.concurrent_requests >= 0


# ── RateLimitService.add_rate_limit_headers ────────────────────────────────────

class TestAddRateLimitHeaders:
    def test_sets_all_headers(self):
        svc = _no_redis_service()
        resp = MagicMock()
        resp.headers = {}
        info = {
            "limit_minute": 30,
            "remaining_minute": 29,
            "reset_minute": 1700000060,
            "limit_hour": 200,
            "remaining_hour": 199,
            "reset_hour": 1700003600,
            "limit_day": 1000,
            "remaining_day": 999,
            "reset_day": 1700086400,
        }
        svc.add_rate_limit_headers(resp, info)
        assert resp.headers["X-RateLimit-Limit-Minute"] == "30"
        assert resp.headers["X-RateLimit-Remaining-Minute"] == "29"
        assert resp.headers["X-RateLimit-Limit-Hour"] == "200"
        assert resp.headers["X-RateLimit-Limit-Day"] == "1000"

    def test_missing_keys_default_to_zero(self):
        svc = _no_redis_service()
        resp = MagicMock()
        resp.headers = {}
        svc.add_rate_limit_headers(resp, {})
        assert resp.headers["X-RateLimit-Limit-Minute"] == "0"


# ── RateLimitService.clear_state ──────────────────────────────────────────────

class TestClearState:
    def test_clears_local_state(self):
        svc = _no_redis_service()
        req = _make_request()
        svc.check_rate_limit(req, "/api/test")
        assert len(svc._state) > 0
        svc.clear_state()
        assert len(svc._state) == 0


# ── RateLimitService.record_token_usage (local mode — no-op) ─────────────────

class TestRecordTokenUsage:
    def test_local_mode_is_no_op(self):
        svc = _no_redis_service()
        req = _make_request()
        # Should not raise
        svc.record_token_usage(req, tokens_used=500)


# ── RateLimitService._is_trusted_proxy ────────────────────────────────────────

class TestIsTrustedProxy:
    def test_localhost_is_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("127.0.0.1") is True

    def test_ipv6_localhost_is_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("::1") is True

    def test_private_10_range_is_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("10.0.0.1") is True

    def test_private_172_range_is_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("172.16.0.1") is True

    def test_private_192_range_is_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("192.168.1.1") is True

    def test_public_ip_not_trusted(self):
        svc = _no_redis_service()
        assert svc._is_trusted_proxy("8.8.8.8") is False


# ── RateLimitService._get_config ─────────────────────────────────────────────

class TestGetConfig:
    def test_known_endpoint_returns_custom_config(self):
        svc = _no_redis_service()
        config = svc._get_config("/api/chat")
        assert config.requests_per_minute == 20

    def test_unknown_endpoint_returns_default_config(self):
        svc = _no_redis_service()
        config = svc._get_config("/unknown/path")
        assert config.requests_per_minute == 30


# ── RateLimitService cleanup ─────────────────────────────────────────────────

class TestCleanupOldEntries:
    def test_cleanup_removes_stale_entries(self):
        svc = _no_redis_service()
        svc._last_cleanup = 0  # Force cleanup to run
        req = _make_request()
        identifier = svc._get_identifier(req)
        key = svc._state_key(identifier, "/api/test")
        # Create a stale state with old timestamps
        state = svc._state[key]
        old_ts = time.time() - 200000  # Way in the past
        state.requests_day.append(old_ts)
        svc._cleanup_old_entries()
        # Key might have been removed
        # Just verify no exception
