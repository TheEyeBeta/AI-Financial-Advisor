"""Tests for app.services.rate_limit_redis using fakeredis."""
from __future__ import annotations

import time

import fakeredis
import pytest

from app.services.rate_limit import RateLimitConfig
from app.services.rate_limit_redis import (
    RateLimitRedisBackend,
    _expiry_ms,
    _is_truthy,
    _sanitize_endpoint,
    _window_reset,
    _window_start,
    get_rate_limit_redis_client,
)


# ─── helpers ───────────────────────────────────────────────────────────────

def test_is_truthy_matches_expected_strings():
    assert _is_truthy("1") is True
    assert _is_truthy("True") is True
    assert _is_truthy("on") is True
    assert _is_truthy("no") is False
    assert _is_truthy(None) is False


def test_window_start_aligns_to_boundary():
    now = 1_700_000_123.5
    # minute boundary = now - (now % 60)
    assert _window_start(now, 60) == int(now) - (int(now) % 60)


def test_window_reset_is_window_start_plus_window():
    now = 1_700_000_123.5
    assert _window_reset(now, 60) == _window_start(now, 60) + 60


def test_expiry_ms_floors_to_one_second_minimum():
    now = 100.0
    # reset already passed → expiry_ms must still be at least 1s + 1000ms = 2000
    assert _expiry_ms(reset_ts=50, now=now) == 1000 + 1000


def test_expiry_ms_scales_with_remaining_window():
    now = 100.0
    assert _expiry_ms(reset_ts=110, now=now) == 10 * 1000 + 1000


def test_sanitize_endpoint_strips_slashes_and_replaces_internal():
    assert _sanitize_endpoint("/api/chat") == "api:chat"
    assert _sanitize_endpoint("/api/chat/title") == "api:chat:title"
    assert _sanitize_endpoint("/") == "root"
    assert _sanitize_endpoint("   ") == "root"


# ─── get_rate_limit_redis_client ───────────────────────────────────────────

def test_get_rate_limit_redis_client_returns_none_when_no_env_configured(monkeypatch):
    for name in (
        "RATE_LIMIT_REDIS_URL",
        "REDIS_URL",
        "RATE_LIMIT_REDIS_HOST",
    ):
        monkeypatch.delenv(name, raising=False)

    # Ensure redis module thinks nothing is configured.
    assert get_rate_limit_redis_client() is None


def test_get_rate_limit_redis_client_returns_none_on_connection_error(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://nonexistent.invalid:6379/0")
    # The test must not raise; real redis fails → None returned.
    result = get_rate_limit_redis_client()
    assert result is None


# ─── RateLimitRedisBackend acquire / release ───────────────────────────────

@pytest.fixture
def fake_redis():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def backend(fake_redis):
    return RateLimitRedisBackend.from_client(fake_redis, key_prefix="test:rl")


def _config() -> RateLimitConfig:
    return RateLimitConfig(
        requests_per_minute=2,
        requests_per_hour=20,
        requests_per_day=200,
        tokens_per_minute=1000,
        tokens_per_hour=5000,
        tokens_per_day=10000,
        max_concurrent_requests=5,
        suspicious_request_threshold=0,  # disable auto-block in tests
    )


def test_acquire_allows_up_to_limit_then_blocks(backend):
    now = time.time()
    allowed1, error1, info1 = backend.acquire(
        "ip:1.1.1.1",
        endpoint="/api/news",
        config=_config(),
        estimated_tokens=10,
        now=now,
        request_id="req-1",
    )
    assert allowed1 is True
    assert error1 is None
    assert info1["limit_minute"] == 2
    assert info1["remaining_minute"] == 1

    # Second request still OK.
    allowed2, _, info2 = backend.acquire(
        "ip:1.1.1.1",
        endpoint="/api/news",
        config=_config(),
        estimated_tokens=10,
        now=now,
        request_id="req-2",
    )
    assert allowed2 is True
    assert info2["remaining_minute"] == 0

    # Third request → over quota.
    allowed3, error3, _ = backend.acquire(
        "ip:1.1.1.1",
        endpoint="/api/news",
        config=_config(),
        estimated_tokens=10,
        now=now,
        request_id="req-3",
    )
    assert allowed3 is False
    assert "per minute" in error3


def test_acquire_token_budget_exhaustion_blocks(backend):
    now = time.time()
    cfg = RateLimitConfig(
        requests_per_minute=100,
        tokens_per_minute=50,
        tokens_per_hour=5000,
        tokens_per_day=10000,
        max_concurrent_requests=100,
        suspicious_request_threshold=0,
    )

    allowed, error, _ = backend.acquire(
        "ip:x",
        endpoint="/api/chat",
        config=cfg,
        estimated_tokens=100,
        now=now,
        request_id="r-1",
    )
    assert allowed is False
    assert "Token limit exceeded" in error


def test_release_frees_concurrency_slot(backend):
    now = time.time()
    cfg = RateLimitConfig(
        requests_per_minute=100,
        tokens_per_minute=1000,
        tokens_per_hour=10000,
        tokens_per_day=100000,
        max_concurrent_requests=1,
        suspicious_request_threshold=0,
    )

    # Acquire the sole slot.
    allowed, _, _ = backend.acquire(
        "ip:c", endpoint="/api/chat", config=cfg, estimated_tokens=1,
        now=now, request_id="c-1",
    )
    assert allowed is True

    # Second attempt hits concurrency limit.
    allowed2, error2, _ = backend.acquire(
        "ip:c", endpoint="/api/chat", config=cfg, estimated_tokens=1,
        now=now, request_id="c-2",
    )
    assert allowed2 is False
    assert "concurrent" in error2.lower()

    backend.release("ip:c", "/api/chat", "c-1")

    allowed3, _, _ = backend.acquire(
        "ip:c", endpoint="/api/chat", config=cfg, estimated_tokens=1,
        now=now, request_id="c-3",
    )
    assert allowed3 is True


def test_record_token_usage_adjusts_counters(backend, fake_redis):
    now = time.time()
    cfg = _config()
    backend.acquire(
        "ip:t", endpoint="/api/chat", config=cfg, estimated_tokens=10,
        now=now, request_id="rec-1",
    )

    # Key used by the acquire script — verify counter is at 10.
    keys = backend._keys("ip:t", "/api/chat", "rec-1")
    assert int(fake_redis.get(keys["minute_tokens"]) or 0) == 10

    # Record higher actual usage.
    backend.record_token_usage("ip:t", "/api/chat", "rec-1", 25)
    assert int(fake_redis.get(keys["minute_tokens"]) or 0) == 25


def test_clear_all_removes_keys_in_namespace(backend, fake_redis):
    now = time.time()
    backend.acquire(
        "ip:del", endpoint="/api/chat", config=_config(), estimated_tokens=1,
        now=now, request_id="del-1",
    )
    # Key namespace contains at least one entry.
    keys_before = list(fake_redis.scan_iter(match="test:rl:*"))
    assert keys_before

    backend.clear_all()

    keys_after = list(fake_redis.scan_iter(match="test:rl:*"))
    assert keys_after == []
