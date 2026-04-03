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
