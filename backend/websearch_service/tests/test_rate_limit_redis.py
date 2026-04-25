from collections import defaultdict

from fastapi import Request

from app.services.rate_limit import RateLimitConfig, RateLimitService


class FakeSharedRedisBackend:
    def __init__(self) -> None:
        self._request_counts = defaultdict(int)
        self._leases: set[tuple[str, str, str]] = set()

    def acquire(
        self,
        identifier: str,
        *,
        endpoint: str,
        config: RateLimitConfig,
        estimated_tokens: int,
        now: float,
        request_id: str,
    ):
        key = (identifier, endpoint)
        current_requests = self._request_counts[key]

        if current_requests + 1 > config.requests_per_minute:
            return False, "Rate limit exceeded", {}

        self._request_counts[key] += 1
        self._leases.add((identifier, endpoint, request_id))

        return True, None, {
            "requests_remaining_minute": max(0, config.requests_per_minute - self._request_counts[key]),
            "requests_remaining_hour": config.requests_per_hour,
            "requests_remaining_day": config.requests_per_day,
            "tokens_remaining_minute": config.tokens_per_minute - estimated_tokens,
            "tokens_remaining_hour": config.tokens_per_hour - estimated_tokens,
            "tokens_remaining_day": config.tokens_per_day - estimated_tokens,
            "reset_time_minute": int(now + config.minute_window),
            "reset_time_hour": int(now + config.hour_window),
            "reset_time_day": int(now + config.day_window),
        }

    def record_token_usage(self, identifier: str, endpoint: str, request_id: str, tokens_used: int) -> None:
        return None

    def release(self, identifier: str, endpoint: str, request_id: str) -> None:
        self._leases.discard((identifier, endpoint, request_id))

    def clear_all(self) -> None:
        self._request_counts.clear()
        self._leases.clear()


def _request(path: str, client_ip: str = "203.0.113.10") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "client": (client_ip, 443),
            "query_string": b"",
            "state": {},
        }
    )


def _config() -> RateLimitConfig:
    return RateLimitConfig(
        requests_per_minute=1,
        requests_per_hour=5,
        requests_per_day=10,
        tokens_per_minute=1000,
        tokens_per_hour=5000,
        tokens_per_day=10000,
    )


def test_redis_backend_contract_is_shared_across_service_instances():
    shared_backend = FakeSharedRedisBackend()
    first_service = RateLimitService(redis_backend=shared_backend)
    second_service = RateLimitService(redis_backend=shared_backend)

    allowed_first, _, _ = first_service.check_rate_limit(
        _request("/api/news"),
        "/api/news",
        config_override=_config(),
    )
    allowed_second, error_second, _ = second_service.check_rate_limit(
        _request("/api/news"),
        "/api/news",
        config_override=_config(),
    )

    assert allowed_first is True
    assert allowed_second is False
    assert error_second == "Rate limit exceeded"


def test_redis_backend_contract_keeps_endpoint_buckets_separate():
    shared_backend = FakeSharedRedisBackend()
    service = RateLimitService(redis_backend=shared_backend)

    allowed_news, _, _ = service.check_rate_limit(
        _request("/api/news"),
        "/api/news",
        config_override=_config(),
    )
    allowed_stocks, _, _ = service.check_rate_limit(
        _request("/api/stocks/ranking"),
        "/api/stocks/ranking",
        config_override=_config(),
    )

    assert allowed_news is True
    assert allowed_stocks is True


# ── Tests for actual RateLimitRedisBackend ────────────────────────────────────

import time
from unittest.mock import MagicMock

from app.services.rate_limit_redis import (
    RateLimitRedisBackend,
    _expiry_ms,
    _is_truthy,
    _sanitize_endpoint,
    _window_reset,
    _window_start,
    get_rate_limit_redis_client,
)


class TestIsTruthy:
    def test_true_is_truthy(self): assert _is_truthy("true") is True
    def test_one_is_truthy(self): assert _is_truthy("1") is True
    def test_yes_is_truthy(self): assert _is_truthy("yes") is True
    def test_on_is_truthy(self): assert _is_truthy("on") is True
    def test_false_not_truthy(self): assert _is_truthy("false") is False
    def test_none_not_truthy(self): assert _is_truthy(None) is False


class TestWindowHelpers:
    def test_window_start_aligned(self):
        now = 1700000070.5
        # 1700000070 % 60 = 30, so start = 1700000040
        assert _window_start(now, 60) == 1700000040

    def test_window_reset_is_start_plus_window(self):
        now = 1700000070.5
        assert _window_reset(now, 60) == 1700000040 + 60

    def test_expiry_ms_minimum(self):
        # reset_ts in the past → max(1, ...) = 1 → 1000 + 1000 = 2000
        result = _expiry_ms(int(time.time()) - 10, time.time())
        assert result == 2000

    def test_expiry_ms_future(self):
        reset_ts = int(time.time()) + 30
        result = _expiry_ms(reset_ts, time.time())
        assert result > 30000


class TestSanitizeEndpoint:
    def test_api_path(self): assert _sanitize_endpoint("/api/chat") == "api:chat"
    def test_empty_returns_root(self): assert _sanitize_endpoint("") == "root"
    def test_only_slashes_root(self): assert _sanitize_endpoint("///") == "root"
    def test_strips_whitespace(self): assert _sanitize_endpoint("  /api/test  ") == "api:test"


class TestGetRateLimitRedisClient:
    def test_no_config_returns_none(self, monkeypatch):
        monkeypatch.delenv("RATE_LIMIT_REDIS_URL", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("RATE_LIMIT_REDIS_HOST", raising=False)
        assert get_rate_limit_redis_client() is None

    def test_unreachable_url_returns_none(self, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_REDIS_URL", "redis://localhost:9999")
        assert get_rate_limit_redis_client() is None


def _mock_redis(script_result=None):
    mock = MagicMock()
    result = script_result or [1, b"", 1, 1, 1, 1700000060, 1700003600, 1700086400]
    mock.register_script.return_value = MagicMock(return_value=result)
    mock.scan_iter.return_value = []
    return mock


class TestRateLimitRedisBackendInit:
    def test_registers_three_scripts(self):
        mock = _mock_redis()
        RateLimitRedisBackend(client=mock)
        assert mock.register_script.call_count == 3

    def test_custom_key_prefix(self):
        mock = _mock_redis()
        b = RateLimitRedisBackend(client=mock, key_prefix="my:prefix")
        assert b._key_prefix == "my:prefix"

    def test_from_client_classmethod(self):
        mock = _mock_redis()
        b = RateLimitRedisBackend.from_client(mock)
        assert b._client is mock

    def test_from_env_no_redis_returns_none(self, monkeypatch):
        monkeypatch.delenv("RATE_LIMIT_REDIS_URL", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("RATE_LIMIT_REDIS_HOST", raising=False)
        assert RateLimitRedisBackend.from_env() is None


class TestRateLimitRedisBackendAcquire:
    def test_acquire_success(self):
        mock = _mock_redis([1, b"", 1, 1, 1, 1700000060, 1700003600, 1700086400])
        b = RateLimitRedisBackend(client=mock)
        allowed, error, info = b.acquire(
            "user:abc", endpoint="/api/test",
            config=RateLimitConfig(), estimated_tokens=0,
            now=time.time(), request_id="r1",
        )
        assert allowed is True
        assert error is None
        assert "limit_minute" in info

    def test_acquire_blocked(self):
        mock = _mock_redis([0, b"Account temporarily blocked. Retry after 3600 seconds."])
        b = RateLimitRedisBackend(client=mock)
        allowed, error, info = b.acquire(
            "user:blocked", endpoint="/api/test",
            config=RateLimitConfig(), estimated_tokens=0,
            now=time.time(), request_id="r2",
        )
        assert allowed is False
        assert info == {}

    def test_acquire_remaining_calculated(self):
        mock = _mock_redis([1, b"", 5, 10, 50, 1700000060, 1700003600, 1700086400])
        b = RateLimitRedisBackend(client=mock)
        cfg = RateLimitConfig(requests_per_minute=30, requests_per_hour=200, requests_per_day=1000)
        allowed, _, info = b.acquire(
            "user:test", endpoint="/api/test",
            config=cfg, estimated_tokens=0,
            now=time.time(), request_id="r3",
        )
        assert allowed is True
        assert info["remaining_minute"] == 25
        assert info["remaining_hour"] == 190


class TestRateLimitRedisBackendRecordAndRelease:
    def test_record_token_usage_no_raise(self):
        mock = _mock_redis(100)
        b = RateLimitRedisBackend(client=mock)
        b.record_token_usage("user:test", "/api/test", "r1", 500)

    def test_record_token_usage_exception_no_raise(self):
        mock = _mock_redis()
        b = RateLimitRedisBackend(client=mock)
        b._record_tokens = MagicMock(side_effect=Exception("Redis down"))
        b.record_token_usage("user:test", "/api/test", "r1", 500)

    def test_release_no_raise(self):
        mock = _mock_redis(1)
        b = RateLimitRedisBackend(client=mock)
        b.release("user:test", "/api/test", "r1")

    def test_release_exception_no_raise(self):
        mock = _mock_redis()
        b = RateLimitRedisBackend(client=mock)
        b._release = MagicMock(side_effect=Exception("Redis down"))
        b.release("user:test", "/api/test", "r1")


class TestRateLimitRedisBackendClearAll:
    def test_deletes_found_keys(self):
        mock = MagicMock()
        mock.register_script.return_value = MagicMock(return_value=[1])
        mock.scan_iter.return_value = ["k1", "k2"]
        b = RateLimitRedisBackend(client=mock)
        b.clear_all()
        mock.delete.assert_called_once_with("k1", "k2")

    def test_no_keys_no_delete(self):
        mock = MagicMock()
        mock.register_script.return_value = MagicMock(return_value=[1])
        mock.scan_iter.return_value = []
        b = RateLimitRedisBackend(client=mock)
        b.clear_all()
        mock.delete.assert_not_called()

    def test_scan_exception_no_raise(self):
        mock = MagicMock()
        mock.register_script.return_value = MagicMock(return_value=[1])
        mock.scan_iter.side_effect = Exception("Redis down")
        b = RateLimitRedisBackend(client=mock)
        b.clear_all()


class TestRegisterScriptEvalFallback:
    def test_noscript_falls_back_to_eval(self):
        script_result = [1, b"", 1, 1, 1, 1700000060, 1700003600, 1700086400]
        mock = MagicMock()
        registered = MagicMock(side_effect=Exception("NOSCRIPT No matching script"))
        mock.register_script.return_value = registered
        mock.eval.return_value = script_result
        b = RateLimitRedisBackend(client=mock)
        result = b._acquire(keys=["k1"], args=["a1"])
        assert result == script_result
        mock.eval.assert_called_once()

    def test_other_exception_re_raised(self):
        mock = MagicMock()
        registered = MagicMock(side_effect=Exception("connection refused"))
        mock.register_script.return_value = registered
        b = RateLimitRedisBackend(client=mock)
        import pytest
        with pytest.raises(Exception, match="connection refused"):
            b._acquire(keys=["k1"], args=["a1"])
