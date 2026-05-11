"""Redis support for the shared rate limiter."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Tuple

try:
    import redis
except Exception:  # pragma: no cover - redis is an optional runtime dependency in dev
    redis = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_RATE_LIMIT_KEY_PREFIX = "RATE_LIMIT_REDIS_KEY_PREFIX"
_RATE_LIMIT_URL_ENV = ("RATE_LIMIT_REDIS_URL", "REDIS_URL")
_RATE_LIMIT_HOST_ENV = "RATE_LIMIT_REDIS_HOST"
_RATE_LIMIT_PORT_ENV = "RATE_LIMIT_REDIS_PORT"
_RATE_LIMIT_DB_ENV = "RATE_LIMIT_REDIS_DB"
_RATE_LIMIT_PASSWORD_ENV = "RATE_LIMIT_REDIS_PASSWORD"
_RATE_LIMIT_USERNAME_ENV = "RATE_LIMIT_REDIS_USERNAME"
_RATE_LIMIT_TLS_ENV = "RATE_LIMIT_REDIS_TLS"


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _window_start(now: float, window_seconds: int) -> int:
    now_int = int(now)
    return now_int - (now_int % window_seconds)


def _window_reset(now: float, window_seconds: int) -> int:
    return _window_start(now, window_seconds) + window_seconds


def _expiry_ms(reset_ts: int, now: float) -> int:
    remaining = max(1, reset_ts - int(now))
    return remaining * 1000 + 1000


def _sanitize_endpoint(endpoint: str) -> str:
    cleaned = endpoint.strip().strip("/")
    if not cleaned:
        return "root"
    return cleaned.replace("/", ":")


def get_rate_limit_redis_client() -> Any | None:
    """Return a configured Redis client or ``None`` if Redis is unavailable."""
    if redis is None:
        return None

    url = next(
        ((os.getenv(name) or "").strip() for name in _RATE_LIMIT_URL_ENV if (os.getenv(name) or "").strip()),
        "",
    )

    try:
        if url:
            client = redis.Redis.from_url(
                url,
                decode_responses=True,
                health_check_interval=30,
            )
        else:
            host = (os.getenv(_RATE_LIMIT_HOST_ENV) or "").strip()
            if not host:
                return None

            port_raw = (os.getenv(_RATE_LIMIT_PORT_ENV) or "6379").strip()
            db_raw = (os.getenv(_RATE_LIMIT_DB_ENV) or "0").strip()

            client = redis.Redis(
                host=host,
                port=int(port_raw),
                db=int(db_raw),
                username=(os.getenv(_RATE_LIMIT_USERNAME_ENV) or "").strip() or None,
                password=(os.getenv(_RATE_LIMIT_PASSWORD_ENV) or "").strip() or None,
                ssl=_is_truthy(os.getenv(_RATE_LIMIT_TLS_ENV)),
                decode_responses=True,
                health_check_interval=30,
            )

        client.ping()
        return client
    except Exception as exc:
        environment = (os.getenv("ENVIRONMENT") or "").strip().lower()
        if environment == "production":
            logger.warning("Redis-backed rate limiting is unavailable: %s", exc)
        else:
            logger.info("Redis-backed rate limiting unavailable, using local fallback: %s", exc)
        return None


class RateLimitRedisBackend:
    """Atomic Redis storage for distributed rate limiting."""

    _ACQUIRE_SCRIPT = """
    local minute_req_key = KEYS[1]
    local minute_tok_key = KEYS[2]
    local hour_req_key = KEYS[3]
    local hour_tok_key = KEYS[4]
    local day_req_key = KEYS[5]
    local day_tok_key = KEYS[6]
    local block_key = KEYS[7]
    local leases_key = KEYS[8]
    local reservation_key = KEYS[9]

    local now = tonumber(ARGV[1])
    local minute_reset = tonumber(ARGV[2])
    local hour_reset = tonumber(ARGV[3])
    local day_reset = tonumber(ARGV[4])
    local requests_per_minute = tonumber(ARGV[5])
    local requests_per_hour = tonumber(ARGV[6])
    local requests_per_day = tonumber(ARGV[7])
    local tokens_per_minute = tonumber(ARGV[8])
    local tokens_per_hour = tonumber(ARGV[9])
    local tokens_per_day = tonumber(ARGV[10])
    local max_concurrent = tonumber(ARGV[11])
    local estimated_tokens = tonumber(ARGV[12])
    local suspicious_threshold = tonumber(ARGV[13])
    local block_duration_seconds = tonumber(ARGV[14])
    local request_id = ARGV[15]
    local minute_ttl_ms = tonumber(ARGV[16])
    local hour_ttl_ms = tonumber(ARGV[17])
    local day_ttl_ms = tonumber(ARGV[18])
    local lease_ttl_ms = tonumber(ARGV[19])
    local block_ttl_ms = tonumber(ARGV[20])
    local token_limit_exempt = tonumber(ARGV[21])

    local blocked_until = tonumber(redis.call("GET", block_key) or "0")
    if blocked_until > now then
        return {0, "Account temporarily blocked due to suspicious activity. Retry after " .. tostring(math.max(1, blocked_until - now)) .. " seconds."}
    end

    redis.call("ZREMRANGEBYSCORE", leases_key, "-inf", tostring(now * 1000))
    local active_requests = tonumber(redis.call("ZCARD", leases_key) or "0")
    if active_requests >= max_concurrent then
        return {0, "Too many concurrent requests. Maximum: " .. tostring(max_concurrent)}
    end

    local minute_requests = tonumber(redis.call("GET", minute_req_key) or "0")
    local hour_requests = tonumber(redis.call("GET", hour_req_key) or "0")
    local day_requests = tonumber(redis.call("GET", day_req_key) or "0")
    local minute_tokens = tonumber(redis.call("GET", minute_tok_key) or "0")
    local hour_tokens = tonumber(redis.call("GET", hour_tok_key) or "0")
    local day_tokens = tonumber(redis.call("GET", day_tok_key) or "0")

    if minute_requests + 1 > requests_per_minute then
        return {0, "Rate limit exceeded: " .. tostring(requests_per_minute) .. " requests per minute. Retry after " .. tostring(math.max(1, minute_reset - now)) .. " seconds."}
    end
    if hour_requests + 1 > requests_per_hour then
        return {0, "Rate limit exceeded: " .. tostring(requests_per_hour) .. " requests per hour. Retry after " .. tostring(math.max(1, hour_reset - now)) .. " seconds."}
    end
    if day_requests + 1 > requests_per_day then
        return {0, "Rate limit exceeded: " .. tostring(requests_per_day) .. " requests per day. Retry after " .. tostring(math.max(1, day_reset - now)) .. " seconds."}
    end

    if token_limit_exempt == 0 then
        if minute_tokens + estimated_tokens > tokens_per_minute then
            return {0, "Token limit exceeded: " .. tostring(tokens_per_minute) .. " tokens per minute."}
        end
        if hour_tokens + estimated_tokens > tokens_per_hour then
            return {0, "Token limit exceeded: " .. tostring(tokens_per_hour) .. " tokens per hour."}
        end
        if day_tokens + estimated_tokens > tokens_per_day then
            return {0, "Token limit exceeded: " .. tostring(tokens_per_day) .. " tokens per day."}
        end
    end

    redis.call("INCRBY", minute_req_key, 1)
    redis.call("INCRBY", hour_req_key, 1)
    redis.call("INCRBY", day_req_key, 1)
    if token_limit_exempt == 0 then
        redis.call("INCRBY", minute_tok_key, estimated_tokens)
        redis.call("INCRBY", hour_tok_key, estimated_tokens)
        redis.call("INCRBY", day_tok_key, estimated_tokens)
    end
    redis.call("ZADD", leases_key, tostring((now * 1000) + lease_ttl_ms), request_id)
    if token_limit_exempt == 0 then
        redis.call(
            "HMSET",
            reservation_key,
            "minute_token_key", minute_tok_key,
            "hour_token_key", hour_tok_key,
            "day_token_key", day_tok_key,
            "estimated_tokens", tostring(estimated_tokens)
        )
    else
        redis.call("HMSET", reservation_key, "estimated_tokens", "")
    end

    redis.call("PEXPIRE", minute_req_key, minute_ttl_ms)
    redis.call("PEXPIRE", hour_req_key, hour_ttl_ms)
    redis.call("PEXPIRE", day_req_key, day_ttl_ms)
    if token_limit_exempt == 0 then
        redis.call("PEXPIRE", minute_tok_key, minute_ttl_ms)
        redis.call("PEXPIRE", hour_tok_key, hour_ttl_ms)
        redis.call("PEXPIRE", day_tok_key, day_ttl_ms)
    end
    redis.call("PEXPIRE", leases_key, lease_ttl_ms)
    redis.call("PEXPIRE", reservation_key, lease_ttl_ms)

    if suspicious_threshold > 0 and (minute_requests + 1) >= suspicious_threshold then
        local blocked_until_ts = now + block_duration_seconds
        redis.call("SET", block_key, tostring(blocked_until_ts), "PX", block_ttl_ms)
    end

    return {1, "", minute_requests + 1, hour_requests + 1, day_requests + 1, minute_reset, hour_reset, day_reset}
    """

    _RECORD_TOKENS_SCRIPT = """
    local reservation_key = KEYS[1]
    local actual_tokens = tonumber(ARGV[1])

    local estimated_tokens = tonumber(redis.call("HGET", reservation_key, "estimated_tokens") or "")
    if not estimated_tokens then
        return 0
    end

    local delta = actual_tokens - estimated_tokens
    if delta ~= 0 then
        local minute_key = redis.call("HGET", reservation_key, "minute_token_key")
        local hour_key = redis.call("HGET", reservation_key, "hour_token_key")
        local day_key = redis.call("HGET", reservation_key, "day_token_key")

        if minute_key and minute_key ~= "" then
            redis.call("INCRBY", minute_key, delta)
        end
        if hour_key and hour_key ~= "" then
            redis.call("INCRBY", hour_key, delta)
        end
        if day_key and day_key ~= "" then
            redis.call("INCRBY", day_key, delta)
        end

        redis.call("HSET", reservation_key, "estimated_tokens", tostring(actual_tokens))
    end

    return delta
    """

    _RELEASE_SCRIPT = """
    local leases_key = KEYS[1]
    local reservation_key = KEYS[2]
    local request_id = ARGV[1]

    redis.call("ZREM", leases_key, request_id)
    redis.call("DEL", reservation_key)
    return 1
    """

    def __init__(self, client: Any, key_prefix: Optional[str] = None):
        self._client = client
        self._key_prefix = (key_prefix or os.getenv(_RATE_LIMIT_KEY_PREFIX) or "websearch:rate_limit").strip()
        self._acquire = self._register_script(self._ACQUIRE_SCRIPT)
        self._record_tokens = self._register_script(self._RECORD_TOKENS_SCRIPT)
        self._release = self._register_script(self._RELEASE_SCRIPT)

    def _register_script(self, script: str):
        registered_script = self._client.register_script(script)

        def _runner(*, keys: list[str], args: list[str]):
            try:
                return registered_script(keys=keys, args=args)
            except Exception as exc:
                message = str(exc).lower()
                if "unknown command 'evalsha'" not in message and "noscript" not in message:
                    raise
                return self._client.eval(script, len(keys), *(list(keys) + list(args)))

        return _runner

    @classmethod
    def from_client(cls, client: Any, key_prefix: Optional[str] = None) -> "RateLimitRedisBackend":
        return cls(client=client, key_prefix=key_prefix)

    @classmethod
    def from_env(cls) -> "RateLimitRedisBackend | None":
        client = get_rate_limit_redis_client()
        if client is None:
            return None
        return cls.from_client(client)

    def _base(self, identifier: str, endpoint: str) -> str:
        return f"{self._key_prefix}:{identifier}:{_sanitize_endpoint(endpoint)}"

    def _keys(self, identifier: str, endpoint: str, request_id: str) -> Dict[str, str]:
        base = self._base(identifier, endpoint)
        return {
            "minute_requests": f"{base}:req:minute",
            "minute_tokens": f"{base}:tok:minute",
            "hour_requests": f"{base}:req:hour",
            "hour_tokens": f"{base}:tok:hour",
            "day_requests": f"{base}:req:day",
            "day_tokens": f"{base}:tok:day",
            "block_until": f"{base}:block_until",
            "leases": f"{base}:leases",
            "reservation": f"{base}:reservation:{request_id}",
        }

    def acquire(
        self,
        identifier: str,
        *,
        endpoint: str,
        config: Any,
        estimated_tokens: int,
        now: float,
        request_id: str,
        token_limit_exempt: bool = False,
    ) -> Tuple[bool, Optional[str], Dict[str, int]]:
        window_map = {
            "minute": (60, int(getattr(config, "minute_window", 60))),
            "hour": (3600, int(getattr(config, "hour_window", 3600))),
            "day": (86400, int(getattr(config, "day_window", 86400))),
        }
        minute_reset = _window_reset(now, window_map["minute"][1])
        hour_reset = _window_reset(now, window_map["hour"][1])
        day_reset = _window_reset(now, window_map["day"][1])

        keys = self._keys(identifier, endpoint, request_id)
        result = self._acquire(
            keys=[
                keys["minute_requests"],
                keys["minute_tokens"],
                keys["hour_requests"],
                keys["hour_tokens"],
                keys["day_requests"],
                keys["day_tokens"],
                keys["block_until"],
                keys["leases"],
                keys["reservation"],
            ],
            args=[
                str(int(now)),
                str(minute_reset),
                str(hour_reset),
                str(day_reset),
                str(int(getattr(config, "requests_per_minute", 30))),
                str(int(getattr(config, "requests_per_hour", 200))),
                str(int(getattr(config, "requests_per_day", 1000))),
                str(int(getattr(config, "tokens_per_minute", 50000))),
                str(int(getattr(config, "tokens_per_hour", 200000))),
                str(int(getattr(config, "tokens_per_day", 1000000))),
                str(int(getattr(config, "max_concurrent_requests", 5))),
                str(int(estimated_tokens)),
                str(int(getattr(config, "suspicious_request_threshold", 50))),
                str(int(getattr(config, "block_duration_seconds", 3600))),
                request_id,
                str(_expiry_ms(minute_reset, now)),
                str(_expiry_ms(hour_reset, now)),
                str(_expiry_ms(day_reset, now)),
                str(max(60_000, int(getattr(config, "block_duration_seconds", 3600)) * 1000 + 1000)),
                str(max(60_000, int(getattr(config, "block_duration_seconds", 3600)) * 1000 + 1000)),
                "1" if token_limit_exempt else "0",
            ],
        )

        allowed = bool(int(result[0]))
        if not allowed:
            return False, str(result[1]), {}

        info = {
            "limit_minute": int(getattr(config, "requests_per_minute", 30)),
            "remaining_minute": int(getattr(config, "requests_per_minute", 30)) - int(result[2]),
            "limit_hour": int(getattr(config, "requests_per_hour", 200)),
            "remaining_hour": int(getattr(config, "requests_per_hour", 200)) - int(result[3]),
            "limit_day": int(getattr(config, "requests_per_day", 1000)),
            "remaining_day": int(getattr(config, "requests_per_day", 1000)) - int(result[4]),
            "reset_minute": int(result[5]),
            "reset_hour": int(result[6]),
            "reset_day": int(result[7]),
        }
        return True, None, info

    def record_token_usage(self, identifier: str, endpoint: str, request_id: str, tokens_used: int) -> None:
        keys = self._keys(identifier, endpoint, request_id)
        try:
            self._record_tokens(keys=[keys["reservation"]], args=[str(int(tokens_used))])
        except Exception as exc:
            logger.warning("Failed to update Redis token usage for %s: %s", identifier, exc)

    def release(self, identifier: str, endpoint: str, request_id: str) -> None:
        keys = self._keys(identifier, endpoint, request_id)
        try:
            self._release(keys=[keys["leases"], keys["reservation"]], args=[request_id])
        except Exception as exc:
            logger.warning("Failed to release Redis rate-limit slot for %s: %s", identifier, exc)

    def clear_all(self) -> None:
        pattern = f"{self._key_prefix}:*"
        try:
            keys = list(self._client.scan_iter(match=pattern))
            if keys:
                self._client.delete(*keys)
        except Exception as exc:
            logger.warning("Failed to clear Redis rate limit keys for %s: %s", pattern, exc)
