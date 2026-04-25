"""Tests for app.services.rate_limit — local fallback limiter and header writer."""
from __future__ import annotations

import time
from fastapi import Request, Response

import pytest

from app.services.rate_limit import RateLimitConfig, RateLimitService


def _make_request(
    client_ip: str = "203.0.113.10",
    path: str = "/api/chat",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": headers or [],
            "client": (client_ip, 443),
            "query_string": b"",
            "state": {},
        }
    )


# ─── Identifier resolution ──────────────────────────────────────────────────

def test_identifier_prefers_user_id_over_ip():
    svc = RateLimitService()
    req = _make_request(client_ip="1.2.3.4")
    assert svc._get_identifier(req, user_id="user-42") == "user:user-42"


def test_identifier_uses_direct_ip_when_not_trusted_proxy():
    svc = RateLimitService()
    req = _make_request(
        client_ip="203.0.113.10",  # public ip, not trusted proxy
        headers=[(b"x-forwarded-for", b"9.9.9.9")],
    )
    # Direct IP used because 203.0.113.10 is not in trusted proxy range.
    assert svc._get_identifier(req) == "ip:203.0.113.10"


def test_identifier_trusts_x_forwarded_for_from_private_proxy():
    svc = RateLimitService()
    req = _make_request(
        client_ip="10.0.0.1",  # private / trusted proxy
        headers=[(b"x-forwarded-for", b"9.9.9.9, 8.8.8.8")],
    )
    assert svc._get_identifier(req) == "ip:9.9.9.9"


def test_identifier_falls_back_to_x_real_ip_when_forwarded_for_absent():
    svc = RateLimitService()
    req = _make_request(
        client_ip="127.0.0.1",
        headers=[(b"x-real-ip", b"5.5.5.5")],
    )
    assert svc._get_identifier(req) == "ip:5.5.5.5"


# ─── Local fallback enforcement ────────────────────────────────────────────

def test_check_rate_limit_allows_first_request_and_populates_info(monkeypatch):
    # Force local fallback mode (no Redis) — identical to how tests run today.
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    allowed, error, info = svc.check_rate_limit(
        _make_request(),
        endpoint="/api/chat",
    )
    assert allowed is True
    assert error is None
    assert info["limit_minute"] == 20  # from endpoint config
    assert info["remaining_minute"] == 19


def test_check_rate_limit_blocks_after_minute_quota_exhausted():
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    config = RateLimitConfig(requests_per_minute=2, requests_per_hour=10, requests_per_day=100)

    req = _make_request()
    svc.check_rate_limit(req, "/api/chat", config_override=config)
    svc.check_rate_limit(req, "/api/chat", config_override=config)
    allowed, error, _ = svc.check_rate_limit(req, "/api/chat", config_override=config)

    assert allowed is False
    assert error is not None
    assert "per minute" in error


def test_check_rate_limit_blocks_on_concurrent_request_ceiling():
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    config = RateLimitConfig(
        requests_per_minute=100,
        requests_per_hour=1000,
        requests_per_day=10000,
        max_concurrent_requests=1,
    )
    req = _make_request()
    svc.check_rate_limit(req, "/api/chat", config_override=config)
    # Second concurrent request (without release) must hit concurrency ceiling.
    allowed, error, _ = svc.check_rate_limit(req, "/api/chat", config_override=config)
    assert allowed is False
    assert "concurrent" in error.lower()


def test_release_decrements_concurrent_count():
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    config = RateLimitConfig(max_concurrent_requests=1)
    req = _make_request()
    svc.check_rate_limit(req, "/api/chat", config_override=config)
    svc.release_request(req)
    # After release, a second call should succeed.
    allowed, _, _ = svc.check_rate_limit(req, "/api/chat", config_override=config)
    assert allowed is True


def test_token_limit_exceeded_returns_descriptive_error():
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    config = RateLimitConfig(
        requests_per_minute=100,
        tokens_per_minute=10,
        tokens_per_hour=1000,
        tokens_per_day=10000,
    )
    req = _make_request()
    allowed, error, _ = svc.check_rate_limit(
        req, "/api/chat", estimated_tokens=100, config_override=config
    )
    assert allowed is False
    assert "Token limit exceeded" in error


def test_blocked_until_rejects_further_requests():
    svc = RateLimitService()
    svc._redis_backend = None
    svc.clear_state()

    # Directly mark the identifier as blocked to exercise _check_blocked branch.
    state = svc._state[svc._state_key("ip:203.0.113.10", "/api/chat")]
    state.blocked_until = time.time() + 60

    allowed, error, _ = svc.check_rate_limit(_make_request(), "/api/chat")
    assert allowed is False
    assert "temporarily blocked" in error.lower()


# ─── Header writer ──────────────────────────────────────────────────────────

def test_add_rate_limit_headers_writes_all_expected_keys():
    svc = RateLimitService()
    resp = Response()
    svc.add_rate_limit_headers(
        resp,
        {
            "limit_minute": 20,
            "remaining_minute": 10,
            "reset_minute": 60,
            "limit_hour": 200,
            "remaining_hour": 180,
            "reset_hour": 3600,
            "limit_day": 1000,
            "remaining_day": 900,
            "reset_day": 86400,
        },
    )
    assert resp.headers["X-RateLimit-Limit-Minute"] == "20"
    assert resp.headers["X-RateLimit-Remaining-Minute"] == "10"
    assert resp.headers["X-RateLimit-Reset-Minute"] == "60"
    assert resp.headers["X-RateLimit-Limit-Hour"] == "200"
    assert resp.headers["X-RateLimit-Limit-Day"] == "1000"


def test_add_rate_limit_headers_defaults_to_zero_when_info_missing():
    svc = RateLimitService()
    resp = Response()
    svc.add_rate_limit_headers(resp, {})
    assert resp.headers["X-RateLimit-Limit-Minute"] == "0"
    assert resp.headers["X-RateLimit-Limit-Day"] == "0"


# ─── Endpoint config lookup ────────────────────────────────────────────────

def test_get_config_returns_endpoint_override_when_present():
    svc = RateLimitService()
    cfg = svc._get_config("/api/chat")
    assert cfg.requests_per_minute == 20


def test_get_config_returns_default_for_unknown_endpoint():
    svc = RateLimitService()
    cfg = svc._get_config("/totally/unmapped")
    # Default is RateLimitConfig() with requests_per_minute=30.
    assert cfg.requests_per_minute == 30


# ─── clear_state ────────────────────────────────────────────────────────────

def test_clear_state_removes_local_counters():
    svc = RateLimitService()
    svc._redis_backend = None

    req = _make_request()
    svc.check_rate_limit(req, "/api/chat")
    assert len(svc._state) >= 1
    svc.clear_state()
    assert len(svc._state) == 0
