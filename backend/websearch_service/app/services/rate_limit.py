"""
Shared rate limiting service with Redis-backed counters and a local fallback.

The public API remains stable:
- check_rate_limit
- add_rate_limit_headers
- record_token_usage
- release_request
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional, Tuple

from fastapi import Request, Response

from .rate_limit_redis import RateLimitRedisBackend

logger = logging.getLogger(__name__)


@dataclass
class RateLimitConfig:
    """Configuration for rate limiting."""

    requests_per_minute: int = 30
    requests_per_hour: int = 200
    requests_per_day: int = 1000

    tokens_per_minute: int = 50000
    tokens_per_hour: int = 200000
    tokens_per_day: int = 1000000

    max_concurrent_requests: int = 5
    suspicious_request_threshold: int = 50
    block_duration_seconds: int = 3600

    minute_window: int = 60
    hour_window: int = 3600
    day_window: int = 86400


@dataclass
class RateLimitState:
    """Tracks rate limit state for an identifier."""

    requests_minute: Deque[float] = field(default_factory=deque)
    requests_hour: Deque[float] = field(default_factory=deque)
    requests_day: Deque[float] = field(default_factory=deque)

    tokens_minute: int = 0
    tokens_hour: int = 0
    tokens_day: int = 0

    suspicious_count: int = 0
    blocked_until: Optional[float] = None
    concurrent_requests: int = 0

    last_cleanup: float = field(default_factory=time.time)


class RateLimitStateCache(defaultdict):
    """Compatibility cache for local fallback and test helpers."""

    def __init__(self, owner: "RateLimitService | None" = None):
        super().__init__(RateLimitState)
        self._owner = owner

    def bind(self, owner: "RateLimitService") -> None:
        self._owner = owner

    def _clear_local(self) -> None:
        super().clear()

    def clear(self) -> None:  # type: ignore[override]
        if self._owner is not None:
            self._owner._clear_rate_limit_state()
        else:
            super().clear()


def _window_start_for(window_type: str, now: float) -> datetime:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    if window_type == "minute":
        return dt.replace(second=0, microsecond=0)
    if window_type == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _window_is_current(window_start_str: str, window_type: str, now: float) -> bool:
    try:
        stored = datetime.fromisoformat(window_start_str.replace("Z", "+00:00"))
        return stored >= _window_start_for(window_type, now)
    except Exception:
        return False


class RateLimitService:
    """Rate limiter with Redis-backed shared state and in-memory fallback."""

    _TRUSTED_PROXY_NETS: tuple[str, ...] = (
        "127.0.0.1",
        "::1",
        "10.",
        "172.16.",
        "172.17.",
        "172.18.",
        "172.19.",
        "172.20.",
        "172.21.",
        "172.22.",
        "172.23.",
        "172.24.",
        "172.25.",
        "172.26.",
        "172.27.",
        "172.28.",
        "172.29.",
        "172.30.",
        "172.31.",
        "192.168.",
    )

    def __init__(
        self,
        redis_client: Any | None = None,
        redis_backend: RateLimitRedisBackend | None = None,
    ) -> None:
        self._state = RateLimitStateCache(self)

        self._endpoint_configs: Dict[str, RateLimitConfig] = {
            "/api/chat": RateLimitConfig(
                requests_per_minute=20,
                requests_per_hour=150,
                requests_per_day=500,
                tokens_per_minute=40000,
                tokens_per_hour=150000,
                tokens_per_day=800000,
            ),
            "/api/chat/title": RateLimitConfig(
                requests_per_minute=60,
                requests_per_hour=500,
                requests_per_day=2000,
                tokens_per_minute=40000,
                tokens_per_hour=150000,
                tokens_per_day=600000,
            ),
            "/api/ai/analyze-quantitative": RateLimitConfig(
                requests_per_minute=30,
                requests_per_hour=200,
                requests_per_day=1000,
                tokens_per_minute=30000,
                tokens_per_hour=100000,
                tokens_per_day=500000,
            ),
        }
        self._default_config = RateLimitConfig()

        self._last_cleanup = time.time()
        self._cleanup_interval = 300
        self._redis_backend = redis_backend
        self._allow_backend_clear = (os.getenv("ENVIRONMENT") or "").strip().lower() != "production"
        self._redis_mode = False

        if self._redis_backend is None and redis_client is not None:
            self._redis_backend = RateLimitRedisBackend.from_client(redis_client)
        elif self._redis_backend is None:
            self._redis_backend = RateLimitRedisBackend.from_env()

        if self._redis_backend is not None:
            self._redis_mode = True
            logger.info("Rate limiting is using Redis-backed shared state")
        else:
            if (os.getenv("ENVIRONMENT") or "").strip().lower() == "production":
                logger.warning("Redis is not configured; rate limiting is running in local fallback mode")
            else:
                logger.info("Redis is not configured; rate limiting is running in local fallback mode")

    def _get_config(self, endpoint: str) -> RateLimitConfig:
        return self._endpoint_configs.get(endpoint, self._default_config)

    def _state_key(self, identifier: str, endpoint: str) -> str:
        return f"{identifier}|{endpoint}"

    def _is_trusted_proxy(self, ip: str) -> bool:
        extra_trusted = [
            p.strip()
            for p in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
            if p.strip()
        ]
        all_trusted = list(self._TRUSTED_PROXY_NETS) + extra_trusted
        return any(ip.startswith(prefix) for prefix in all_trusted)

    def _get_identifier(self, request: Request, user_id: Optional[str] = None) -> str:
        if user_id:
            return f"user:{user_id}"

        direct_ip = request.client.host if request.client else None
        if direct_ip and self._is_trusted_proxy(direct_ip):
            forwarded_for = request.headers.get("X-Forwarded-For")
            if forwarded_for:
                client_ip = forwarded_for.split(",")[0].strip()
                return f"ip:{client_ip}" if client_ip else "ip:unknown"

            real_ip = request.headers.get("X-Real-IP", "").strip()
            if real_ip:
                return f"ip:{real_ip}"

        return f"ip:{direct_ip}" if direct_ip else "ip:unknown"

    def _check_blocked(self, state: RateLimitState) -> Optional[str]:
        if state.blocked_until and time.time() < state.blocked_until:
            remaining = int(state.blocked_until - time.time())
            return (
                "Account temporarily blocked due to suspicious activity. "
                f"Retry after {remaining} seconds."
            )
        return None

    def _check_abuse(self, identifier: str, state: RateLimitState, config: RateLimitConfig) -> None:
        now = time.time()
        recent_requests = sum(1 for ts in state.requests_minute if now - ts < config.minute_window)
        if recent_requests < config.suspicious_request_threshold:
            return

        state.suspicious_count += 1
        state.blocked_until = now + config.block_duration_seconds

        try:
            import asyncio
            from .audit import audit_log

            try:
                loop = asyncio.get_event_loop()
                payload = {
                    "identifier": identifier,
                    "requests_in_minute": recent_requests,
                    "blocked_until": datetime.fromtimestamp(state.blocked_until).isoformat(),
                }
                if loop.is_running():
                    asyncio.create_task(audit_log("rate_limit_abuse_detected", payload))
                else:
                    loop.run_until_complete(audit_log("rate_limit_abuse_detected", payload))
            except RuntimeError:
                pass
        except Exception:
            pass

    def _cleanup_old_entries(self) -> None:
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        cutoff = now - self._default_config.day_window * 2

        to_remove = []
        for identifier, state in self._state.items():
            if not state.requests_day or state.requests_day[-1] < cutoff:
                to_remove.append(identifier)

        for identifier in to_remove:
            del self._state[identifier]

    def _clear_rate_limit_state(self) -> None:
        if self._redis_backend is not None and self._allow_backend_clear:
            try:
                self._redis_backend.clear_all()
            except Exception as exc:
                logger.warning("Failed to clear Redis rate limit state: %s", exc)

        self._state._clear_local()

    def clear_state(self) -> None:
        """Clear the local cache and Redis namespace used by this limiter."""
        self._clear_rate_limit_state()

    def _enforce_limits_local(
        self,
        identifier: str,
        endpoint: str,
        estimated_tokens: int = 0,
        config_override: Optional[RateLimitConfig] = None,
    ) -> Tuple[bool, Optional[str], Dict[str, int]]:
        self._cleanup_old_entries()

        config = config_override or self._get_config(endpoint)
        state = self._state[self._state_key(identifier, endpoint)]
        now = time.time()

        block_error = self._check_blocked(state)
        if block_error:
            return False, block_error, {}

        cutoff_minute = now - config.minute_window
        cutoff_hour = now - config.hour_window
        cutoff_day = now - config.day_window

        while state.requests_minute and state.requests_minute[0] < cutoff_minute:
            state.requests_minute.popleft()
        while state.requests_hour and state.requests_hour[0] < cutoff_hour:
            state.requests_hour.popleft()
        while state.requests_day and state.requests_day[0] < cutoff_day:
            state.requests_day.popleft()

        if not state.requests_minute or state.requests_minute[0] < cutoff_minute:
            state.tokens_minute = 0
        if not state.requests_hour or state.requests_hour[0] < cutoff_hour:
            state.tokens_hour = 0
        if not state.requests_day or state.requests_day[0] < cutoff_day:
            state.tokens_day = 0

        if len(state.requests_minute) >= config.requests_per_minute:
            remaining = int(config.minute_window - (now - state.requests_minute[0]))
            return False, (
                f"Rate limit exceeded: {config.requests_per_minute} requests per minute. "
                f"Retry after {remaining} seconds."
            ), {}

        if len(state.requests_hour) >= config.requests_per_hour:
            remaining = int(config.hour_window - (now - state.requests_hour[0]))
            return False, (
                f"Rate limit exceeded: {config.requests_per_hour} requests per hour. "
                f"Retry after {remaining} seconds."
            ), {}

        if len(state.requests_day) >= config.requests_per_day:
            remaining = int(config.day_window - (now - state.requests_day[0]))
            return False, (
                f"Rate limit exceeded: {config.requests_per_day} requests per day. "
                f"Retry after {remaining} seconds."
            ), {}

        if state.tokens_minute + estimated_tokens > config.tokens_per_minute:
            return False, f"Token limit exceeded: {config.tokens_per_minute} tokens per minute.", {}
        if state.tokens_hour + estimated_tokens > config.tokens_per_hour:
            return False, f"Token limit exceeded: {config.tokens_per_hour} tokens per hour.", {}
        if state.tokens_day + estimated_tokens > config.tokens_per_day:
            return False, f"Token limit exceeded: {config.tokens_per_day} tokens per day.", {}

        if state.concurrent_requests >= config.max_concurrent_requests:
            return False, (
                f"Too many concurrent requests. Maximum: {config.max_concurrent_requests}"
            ), {}

        state.requests_minute.append(now)
        state.requests_hour.append(now)
        state.requests_day.append(now)
        state.tokens_minute += estimated_tokens
        state.tokens_hour += estimated_tokens
        state.tokens_day += estimated_tokens
        state.concurrent_requests += 1

        self._check_abuse(identifier, state, config)

        rate_limit_info = {
            "limit_minute": config.requests_per_minute,
            "remaining_minute": config.requests_per_minute - len(state.requests_minute),
            "limit_hour": config.requests_per_hour,
            "remaining_hour": config.requests_per_hour - len(state.requests_hour),
            "limit_day": config.requests_per_day,
            "remaining_day": config.requests_per_day - len(state.requests_day),
            "reset_minute": int(state.requests_minute[0] + config.minute_window) if state.requests_minute else int(now + config.minute_window),
            "reset_hour": int(state.requests_hour[0] + config.hour_window) if state.requests_hour else int(now + config.hour_window),
            "reset_day": int(state.requests_day[0] + config.day_window) if state.requests_day else int(now + config.day_window),
        }
        return True, None, rate_limit_info

    def _store_request_context(
        self,
        request: Request,
        identifier: str,
        endpoint: str,
        request_id: str,
        estimated_tokens: int,
    ) -> None:
        try:
            request.state.rate_limit_identifier = identifier
            request.state.rate_limit_endpoint = endpoint
            request.state.rate_limit_request_id = request_id
            request.state.rate_limit_estimated_tokens = estimated_tokens
        except Exception:
            pass

    def check_rate_limit(
        self,
        request: Request,
        endpoint: str,
        user_id: Optional[str] = None,
        estimated_tokens: int = 0,
        config_override: Optional[RateLimitConfig] = None,
    ) -> Tuple[bool, Optional[str], Dict[str, int]]:
        identifier = self._get_identifier(request, user_id)
        request_id = uuid.uuid4().hex

        if self._redis_backend is not None:
            config = config_override or self._get_config(endpoint)
            allowed, error_message, rate_limit_info = self._redis_backend.acquire(
                identifier,
                endpoint=endpoint,
                config=config,
                estimated_tokens=estimated_tokens,
                now=time.time(),
                request_id=request_id,
            )
        else:
            allowed, error_message, rate_limit_info = self._enforce_limits_local(
                identifier,
                endpoint,
                estimated_tokens,
                config_override=config_override,
            )

        if allowed:
            self._store_request_context(request, identifier, endpoint, request_id, estimated_tokens)

        return allowed, error_message, rate_limit_info

    def record_token_usage(
        self,
        request: Request,
        user_id: Optional[str] = None,
        tokens_used: int = 0,
    ) -> None:
        identifier = self._get_identifier(request, user_id)
        endpoint = getattr(getattr(request, "state", object()), "rate_limit_endpoint", "")
        request_id = getattr(getattr(request, "state", object()), "rate_limit_request_id", None)
        if self._redis_backend is not None and request_id and endpoint:
            self._redis_backend.record_token_usage(identifier, endpoint, request_id, tokens_used)

    def release_request(
        self,
        request: Request,
        user_id: Optional[str] = None,
    ) -> None:
        identifier = self._get_identifier(request, user_id)
        endpoint = getattr(getattr(request, "state", object()), "rate_limit_endpoint", "")
        request_id = getattr(getattr(request, "state", object()), "rate_limit_request_id", None)

        if self._redis_backend is not None and request_id and endpoint:
            self._redis_backend.release(identifier, endpoint, request_id)
            return

        if not endpoint:
            return

        state = self._state[self._state_key(identifier, endpoint)]
        if state.concurrent_requests > 0:
            state.concurrent_requests -= 1

    def add_rate_limit_headers(
        self,
        response: Response,
        rate_limit_info: Dict[str, int],
    ) -> None:
        response.headers["X-RateLimit-Limit-Minute"] = str(rate_limit_info.get("limit_minute", 0))
        response.headers["X-RateLimit-Remaining-Minute"] = str(rate_limit_info.get("remaining_minute", 0))
        response.headers["X-RateLimit-Reset-Minute"] = str(rate_limit_info.get("reset_minute", 0))

        response.headers["X-RateLimit-Limit-Hour"] = str(rate_limit_info.get("limit_hour", 0))
        response.headers["X-RateLimit-Remaining-Hour"] = str(rate_limit_info.get("remaining_hour", 0))
        response.headers["X-RateLimit-Reset-Hour"] = str(rate_limit_info.get("reset_hour", 0))

        response.headers["X-RateLimit-Limit-Day"] = str(rate_limit_info.get("limit_day", 0))
        response.headers["X-RateLimit-Remaining-Day"] = str(rate_limit_info.get("remaining_day", 0))
        response.headers["X-RateLimit-Reset-Day"] = str(rate_limit_info.get("reset_day", 0))


rate_limiter = RateLimitService()
