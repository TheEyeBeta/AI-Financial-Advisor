"""Global AI resource and spend circuit breaker for the controlled beta.

This module is deliberately separate from ``rate_limit.py``: that module
enforces **per-identifier** (per-user/per-IP) limits. This module enforces
**global, cross-tenant** limits and an internal USD spend budget, so a
single well-behaved-per-user burst of traffic across many users cannot
exceed what the beta is funded to spend.

Design summary (see docs/ai-budget-guard.md for the full write-up):

* All state lives in Redis; all check-and-mutate operations are single Lua
  scripts, so concurrent requests across processes/workers cannot race past
  a limit (requirement: "atomic Redis operations; no race-based overspend").
* Cost is **reserved** (optimistically deducted from the daily/monthly
  budget) before the provider call is made, **reconciled** to the actual
  token usage after the call completes, and **released/refunded** if the
  call fails or is cancelled before completion.
* A circuit breaker derives its state (``normal`` / ``warning`` /
  ``restricted`` / ``hard_stop``) purely from *our own* recorded spend —
  never from a provider-side budget signal, because OpenAI budget alerts
  are soft/advisory (see module docstring in ``ai_pricing.py``). A
  time-bounded, audited ``manual_override`` can be set by an admin to lift
  ``hard_stop``/``restricted`` gating; it is disabled by default and always
  expires.
* When Redis is unconfigured (local/dev/test), the guard runs on a
  best-effort, single-process in-memory backend so the code path still
  enforces limits without requiring Redis locally. ``validate_ai_budget_
  configuration()`` fail-fasts at production startup unless Redis is
  configured (or the operator explicitly opts into in-memory/fail-open
  beta behavior via env vars) — production is never silently downgraded.
* When Redis *was* configured but a call fails mid-flight (an outage),
  ``AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE`` controls the response: fail
  closed with a 503 (default, safe) or degrade to the in-memory backend
  for the duration of the outage (deliberate availability-over-cost choice).
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from .ai_pricing import PRICING_VERSION, estimate_cost_usd
from .rate_limit_redis import get_rate_limit_redis_client

logger = logging.getLogger(__name__)

# ─── Circuit breaker states ────────────────────────────────────────────────

STATE_NORMAL = "normal"
STATE_WARNING = "warning"
STATE_RESTRICTED = "restricted"
STATE_HARD_STOP = "hard_stop"
STATE_MANUAL_OVERRIDE = "manual_override"

# ─── Denial reason codes → (HTTP status, is retryable-soon) ────────────────
# 429 = caller can usefully retry shortly (rate/concurrency pressure).
# 503 = the service itself is protecting a budget/capacity boundary; retry
# guidance is longer and callers should expect degraded availability.
_REASON_HTTP_STATUS: dict[str, int] = {
    "hard_stop": 503,
    "restricted": 503,
    "global_concurrency": 429,
    "provider_concurrency": 429,
    "model_concurrency": 429,
    "global_requests_per_minute": 429,
    "global_tokens_per_minute": 429,
    "global_requests_per_day": 429,
    "global_tokens_per_day": 429,
    "redis_unavailable": 503,
}

_DEFAULT_RETRY_AFTER: dict[str, int] = {
    "hard_stop": 3600,
    "restricted": 120,
    "global_concurrency": 5,
    "provider_concurrency": 5,
    "model_concurrency": 5,
    "global_requests_per_minute": 60,
    "global_tokens_per_minute": 60,
    "global_requests_per_day": 3600,
    "global_tokens_per_day": 3600,
    "redis_unavailable": 30,
}


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class AIBudgetConfig:
    """Beta defaults for the global AI budget guard.

    Every field is overridable via environment variable so beta limits are
    configuration, not hard-coded constants (see .env.example). Defaults
    below are conservative starting points for a controlled beta, not
    production capacity planning.
    """

    global_requests_per_minute: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_GLOBAL_REQUESTS_PER_MINUTE", 120)
    )
    global_tokens_per_minute: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_GLOBAL_TOKENS_PER_MINUTE", 300_000)
    )
    global_requests_per_day: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_GLOBAL_REQUESTS_PER_DAY", 20_000)
    )
    global_tokens_per_day: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_GLOBAL_TOKENS_PER_DAY", 20_000_000)
    )
    global_max_concurrent: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_GLOBAL_MAX_CONCURRENT", 40)
    )
    provider_max_concurrent: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_PROVIDER_MAX_CONCURRENT", 30)
    )
    model_max_concurrent: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_MODEL_MAX_CONCURRENT", 20)
    )
    daily_budget_usd: float = field(
        default_factory=lambda: _env_float("AI_BUDGET_DAILY_USD", 50.0)
    )
    monthly_budget_usd: float = field(
        default_factory=lambda: _env_float("AI_BUDGET_MONTHLY_USD", 1000.0)
    )
    warning_threshold_pct: float = field(
        default_factory=lambda: _env_float("AI_BUDGET_WARNING_THRESHOLD_PCT", 0.60)
    )
    restricted_threshold_pct: float = field(
        default_factory=lambda: _env_float("AI_BUDGET_RESTRICTED_THRESHOLD_PCT", 0.85)
    )
    lease_ttl_seconds: int = field(
        default_factory=lambda: _env_int("AI_BUDGET_LEASE_TTL_SECONDS", 180)
    )
    key_prefix: str = field(
        default_factory=lambda: (os.getenv("AI_BUDGET_REDIS_KEY_PREFIX") or "websearch:ai_budget").strip()
    )
    allow_in_memory: bool = field(
        default_factory=lambda: _is_truthy(os.getenv("AI_BUDGET_ALLOW_IN_MEMORY"))
    )
    fail_open_on_redis_outage: bool = field(
        default_factory=lambda: _is_truthy(os.getenv("AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE"))
    )


class AIBudgetDenied(Exception):
    """Raised when the global budget guard denies a request."""

    def __init__(self, reason_code: str, state: str, retry_after: int, detail: str):
        self.reason_code = reason_code
        self.state = state
        self.retry_after = max(0, int(retry_after))
        self.http_status = _REASON_HTTP_STATUS.get(reason_code, 503)
        self.detail = detail
        super().__init__(detail)


@dataclass
class BudgetReservation:
    request_id: str
    provider: str
    model: str
    estimated_tokens: int
    estimated_cost_usd: float
    reconciled: bool = False
    released: bool = False
    used_memory_fallback: bool = False


# ─── Lua scripts (Redis-backed path) ───────────────────────────────────────

_RESERVE_SCRIPT = """
local minute_req_key = KEYS[1]
local minute_tok_key = KEYS[2]
local day_req_key = KEYS[3]
local day_tok_key = KEYS[4]
local global_leases_key = KEYS[5]
local provider_leases_key = KEYS[6]
local model_leases_key = KEYS[7]
local day_spend_key = KEYS[8]
local month_spend_key = KEYS[9]
local override_key = KEYS[10]
local reservation_key = KEYS[11]

local now = tonumber(ARGV[1])
local minute_reset = tonumber(ARGV[2])
local day_reset = tonumber(ARGV[3])
local requests_per_minute = tonumber(ARGV[4])
local tokens_per_minute = tonumber(ARGV[5])
local requests_per_day = tonumber(ARGV[6])
local tokens_per_day = tonumber(ARGV[7])
local global_max_concurrent = tonumber(ARGV[8])
local provider_max_concurrent = tonumber(ARGV[9])
local model_max_concurrent = tonumber(ARGV[10])
local estimated_tokens = tonumber(ARGV[11])
local estimated_cost = tonumber(ARGV[12])
local daily_budget = tonumber(ARGV[13])
local monthly_budget = tonumber(ARGV[14])
local warning_pct = tonumber(ARGV[15])
local restricted_pct = tonumber(ARGV[16])
local request_id = ARGV[17]
local minute_ttl_ms = tonumber(ARGV[18])
local day_ttl_ms = tonumber(ARGV[19])
local lease_ttl_ms = tonumber(ARGV[20])
local month_ttl_ms = tonumber(ARGV[21])
local is_essential = tonumber(ARGV[22])

local override_expiry = tonumber(redis.call("GET", override_key) or "0")
local override_active = override_expiry > now

redis.call("ZREMRANGEBYSCORE", global_leases_key, "-inf", tostring(now * 1000))
redis.call("ZREMRANGEBYSCORE", provider_leases_key, "-inf", tostring(now * 1000))
redis.call("ZREMRANGEBYSCORE", model_leases_key, "-inf", tostring(now * 1000))

local day_spend = tonumber(redis.call("GET", day_spend_key) or "0")
local month_spend = tonumber(redis.call("GET", month_spend_key) or "0")

local day_ratio = 0
if daily_budget > 0 then day_ratio = day_spend / daily_budget end
local month_ratio = 0
if monthly_budget > 0 then month_ratio = month_spend / monthly_budget end
local worst_ratio = math.max(day_ratio, month_ratio)

local state = "normal"
if worst_ratio >= 1.0 then
  state = "hard_stop"
elseif worst_ratio >= restricted_pct then
  state = "restricted"
elseif worst_ratio >= warning_pct then
  state = "warning"
end

if override_active then
  state = "manual_override"
end

if state == "hard_stop" and not override_active then
  return {0, "hard_stop", state, "3600", tostring(day_spend), tostring(month_spend)}
end

if state == "restricted" and is_essential == 0 and not override_active then
  return {0, "restricted", state, "120", tostring(day_spend), tostring(month_spend)}
end

local global_active = tonumber(redis.call("ZCARD", global_leases_key) or "0")
if global_max_concurrent > 0 and global_active >= global_max_concurrent then
  return {0, "global_concurrency", state, "5", tostring(day_spend), tostring(month_spend)}
end

local provider_active = tonumber(redis.call("ZCARD", provider_leases_key) or "0")
if provider_max_concurrent > 0 and provider_active >= provider_max_concurrent then
  return {0, "provider_concurrency", state, "5", tostring(day_spend), tostring(month_spend)}
end

local model_active = tonumber(redis.call("ZCARD", model_leases_key) or "0")
if model_max_concurrent > 0 and model_active >= model_max_concurrent then
  return {0, "model_concurrency", state, "5", tostring(day_spend), tostring(month_spend)}
end

local minute_requests = tonumber(redis.call("GET", minute_req_key) or "0")
local minute_tokens = tonumber(redis.call("GET", minute_tok_key) or "0")
local day_requests = tonumber(redis.call("GET", day_req_key) or "0")
local day_tokens = tonumber(redis.call("GET", day_tok_key) or "0")

if requests_per_minute > 0 and minute_requests + 1 > requests_per_minute then
  return {0, "global_requests_per_minute", state, tostring(math.max(1, minute_reset - now)), tostring(day_spend), tostring(month_spend)}
end
if tokens_per_minute > 0 and minute_tokens + estimated_tokens > tokens_per_minute then
  return {0, "global_tokens_per_minute", state, tostring(math.max(1, minute_reset - now)), tostring(day_spend), tostring(month_spend)}
end
if requests_per_day > 0 and day_requests + 1 > requests_per_day then
  return {0, "global_requests_per_day", state, tostring(math.max(1, day_reset - now)), tostring(day_spend), tostring(month_spend)}
end
if tokens_per_day > 0 and day_tokens + estimated_tokens > tokens_per_day then
  return {0, "global_tokens_per_day", state, tostring(math.max(1, day_reset - now)), tostring(day_spend), tostring(month_spend)}
end

redis.call("INCRBY", minute_req_key, 1)
redis.call("INCRBY", minute_tok_key, math.floor(estimated_tokens))
redis.call("INCRBY", day_req_key, 1)
redis.call("INCRBY", day_tok_key, math.floor(estimated_tokens))
redis.call("PEXPIRE", minute_req_key, minute_ttl_ms)
redis.call("PEXPIRE", minute_tok_key, minute_ttl_ms)
redis.call("PEXPIRE", day_req_key, day_ttl_ms)
redis.call("PEXPIRE", day_tok_key, day_ttl_ms)

redis.call("INCRBYFLOAT", day_spend_key, estimated_cost)
redis.call("INCRBYFLOAT", month_spend_key, estimated_cost)
redis.call("PEXPIRE", day_spend_key, day_ttl_ms)
redis.call("PEXPIRE", month_spend_key, month_ttl_ms)

redis.call("ZADD", global_leases_key, tostring((now * 1000) + lease_ttl_ms), request_id)
redis.call("ZADD", provider_leases_key, tostring((now * 1000) + lease_ttl_ms), request_id)
redis.call("ZADD", model_leases_key, tostring((now * 1000) + lease_ttl_ms), request_id)
redis.call("PEXPIRE", global_leases_key, lease_ttl_ms)
redis.call("PEXPIRE", provider_leases_key, lease_ttl_ms)
redis.call("PEXPIRE", model_leases_key, lease_ttl_ms)

redis.call(
  "HMSET", reservation_key,
  "estimated_cost", tostring(estimated_cost),
  "estimated_tokens", tostring(estimated_tokens),
  "day_spend_key", day_spend_key,
  "month_spend_key", month_spend_key,
  "day_tok_key", day_tok_key,
  "minute_tok_key", minute_tok_key
)
redis.call("PEXPIRE", reservation_key, lease_ttl_ms)

return {1, "", state, "0", tostring(day_spend + estimated_cost), tostring(month_spend + estimated_cost)}
"""

_RECONCILE_SCRIPT = """
local reservation_key = KEYS[1]
local actual_cost = tonumber(ARGV[1])
local actual_tokens = tonumber(ARGV[2])

local estimated_cost = tonumber(redis.call("HGET", reservation_key, "estimated_cost") or "")
if not estimated_cost then
  return 0
end
local estimated_tokens = tonumber(redis.call("HGET", reservation_key, "estimated_tokens") or "0")
local day_spend_key = redis.call("HGET", reservation_key, "day_spend_key")
local month_spend_key = redis.call("HGET", reservation_key, "month_spend_key")
local day_tok_key = redis.call("HGET", reservation_key, "day_tok_key")
local minute_tok_key = redis.call("HGET", reservation_key, "minute_tok_key")

local cost_delta = actual_cost - estimated_cost
local token_delta = actual_tokens - estimated_tokens

if cost_delta ~= 0 then
  if day_spend_key and day_spend_key ~= "" then redis.call("INCRBYFLOAT", day_spend_key, cost_delta) end
  if month_spend_key and month_spend_key ~= "" then redis.call("INCRBYFLOAT", month_spend_key, cost_delta) end
end
if token_delta ~= 0 then
  if day_tok_key and day_tok_key ~= "" then redis.call("INCRBY", day_tok_key, string.format("%d", token_delta)) end
  if minute_tok_key and minute_tok_key ~= "" then redis.call("INCRBY", minute_tok_key, string.format("%d", token_delta)) end
end

redis.call("HSET", reservation_key, "estimated_cost", tostring(actual_cost), "estimated_tokens", tostring(actual_tokens))
return 1
"""

_RELEASE_SCRIPT = """
local global_leases_key = KEYS[1]
local provider_leases_key = KEYS[2]
local model_leases_key = KEYS[3]
local reservation_key = KEYS[4]
local request_id = ARGV[1]
local refund_estimate = tonumber(ARGV[2])

redis.call("ZREM", global_leases_key, request_id)
redis.call("ZREM", provider_leases_key, request_id)
redis.call("ZREM", model_leases_key, request_id)

if refund_estimate == 1 then
  local estimated_cost = tonumber(redis.call("HGET", reservation_key, "estimated_cost") or "")
  if estimated_cost then
    local estimated_tokens = tonumber(redis.call("HGET", reservation_key, "estimated_tokens") or "0")
    local day_spend_key = redis.call("HGET", reservation_key, "day_spend_key")
    local month_spend_key = redis.call("HGET", reservation_key, "month_spend_key")
    local day_tok_key = redis.call("HGET", reservation_key, "day_tok_key")
    local minute_tok_key = redis.call("HGET", reservation_key, "minute_tok_key")
    if day_spend_key and day_spend_key ~= "" then redis.call("INCRBYFLOAT", day_spend_key, -estimated_cost) end
    if month_spend_key and month_spend_key ~= "" then redis.call("INCRBYFLOAT", month_spend_key, -estimated_cost) end
    if day_tok_key and day_tok_key ~= "" then redis.call("INCRBY", day_tok_key, -math.floor(estimated_tokens)) end
    if minute_tok_key and minute_tok_key ~= "" then redis.call("INCRBY", minute_tok_key, -math.floor(estimated_tokens)) end
  end
end

redis.call("DEL", reservation_key)
return 1
"""


def _window_start(now: float, window_seconds: int) -> int:
    now_int = int(now)
    return now_int - (now_int % window_seconds)


def _window_reset(now: float, window_seconds: int) -> int:
    return _window_start(now, window_seconds) + window_seconds


def _month_key_suffix(now: float) -> str:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    return f"{dt.year:04d}{dt.month:02d}"


def _day_key_suffix(now: float) -> str:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    return f"{dt.year:04d}{dt.month:02d}{dt.day:02d}"


def _seconds_until_next_month(now: float) -> int:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    if dt.month == 12:
        next_month = dt.replace(year=dt.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = dt.replace(month=dt.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((next_month - dt).total_seconds()))


class _RedisBackend:
    def __init__(self, client: Any, key_prefix: str):
        self._client = client
        self._prefix = key_prefix
        self._reserve = self._register(_RESERVE_SCRIPT)
        self._reconcile = self._register(_RECONCILE_SCRIPT)
        self._release = self._register(_RELEASE_SCRIPT)

    def _register(self, script: str):
        registered = self._client.register_script(script)

        def _runner(*, keys: list[str], args: list[str]):
            try:
                return registered(keys=keys, args=args)
            except Exception as exc:
                message = str(exc).lower()
                if "unknown command 'evalsha'" not in message and "noscript" not in message:
                    raise
                return self._client.eval(script, len(keys), *(list(keys) + list(args)))

        return _runner

    def _keys(self, provider: str, model: str, request_id: str, now: float) -> dict[str, str]:
        p = self._prefix
        day_suffix = _day_key_suffix(now)
        month_suffix = _month_key_suffix(now)
        return {
            "minute_req": f"{p}:global:req:minute",
            "minute_tok": f"{p}:global:tok:minute",
            "day_req": f"{p}:global:req:day",
            "day_tok": f"{p}:global:tok:day",
            "global_leases": f"{p}:leases:global",
            "provider_leases": f"{p}:leases:provider:{provider}",
            "model_leases": f"{p}:leases:model:{model}",
            "day_spend": f"{p}:spend:day:{day_suffix}",
            "month_spend": f"{p}:spend:month:{month_suffix}",
            "override": f"{p}:override",
            "reservation": f"{p}:reservation:{request_id}",
        }

    def reserve(
        self,
        *,
        config: AIBudgetConfig,
        provider: str,
        model: str,
        estimated_tokens: int,
        estimated_cost: float,
        essential: bool,
        request_id: str,
        now: float,
    ) -> tuple[bool, str, str, int, float, float]:
        keys = self._keys(provider, model, request_id, now)
        minute_reset = _window_reset(now, 60)
        day_reset = _window_reset(now, 86400)
        lease_ttl_ms = max(5_000, config.lease_ttl_seconds * 1000)

        result = self._reserve(
            keys=[
                keys["minute_req"], keys["minute_tok"], keys["day_req"], keys["day_tok"],
                keys["global_leases"], keys["provider_leases"], keys["model_leases"],
                keys["day_spend"], keys["month_spend"], keys["override"], keys["reservation"],
            ],
            args=[
                repr(float(now)), str(minute_reset), str(day_reset),
                str(config.global_requests_per_minute), str(config.global_tokens_per_minute),
                str(config.global_requests_per_day), str(config.global_tokens_per_day),
                str(config.global_max_concurrent), str(config.provider_max_concurrent),
                str(config.model_max_concurrent),
                str(int(estimated_tokens)), repr(float(estimated_cost)),
                repr(float(config.daily_budget_usd)), repr(float(config.monthly_budget_usd)),
                repr(float(config.warning_threshold_pct)), repr(float(config.restricted_threshold_pct)),
                request_id,
                str(max(60_000, (60 - int(now) % 60) * 1000 + 2000)),
                str(max(60_000, day_reset - int(now)) * 1000 + 2000),
                str(lease_ttl_ms),
                str(_seconds_until_next_month(now) * 1000 + 2000),
                "1" if essential else "0",
            ],
        )
        allowed = bool(int(result[0]))
        reason = str(result[1])
        state = str(result[2])
        retry_after = int(float(result[3]))
        day_spend = float(result[4])
        month_spend = float(result[5])
        return allowed, reason, state, retry_after, day_spend, month_spend

    def reconcile(self, request_id: str, provider: str, model: str, now: float, actual_cost: float, actual_tokens: int) -> None:
        keys = self._keys(provider, model, request_id, now)
        try:
            self._reconcile(keys=[keys["reservation"]], args=[repr(float(actual_cost)), str(int(actual_tokens))])
        except Exception as exc:
            logger.warning("AI budget reconcile failed for %s: %s", request_id, exc)

    def release(self, request_id: str, provider: str, model: str, now: float, refund_estimate: bool) -> None:
        keys = self._keys(provider, model, request_id, now)
        try:
            self._release(
                keys=[keys["global_leases"], keys["provider_leases"], keys["model_leases"], keys["reservation"]],
                args=[request_id, "1" if refund_estimate else "0"],
            )
        except Exception as exc:
            logger.warning("AI budget release failed for %s: %s", request_id, exc)

    def status(self, config: AIBudgetConfig, now: float) -> dict[str, Any]:
        keys = self._keys("_status", "_status", "_status", now)
        day_spend = float(self._client.get(keys["day_spend"]) or 0.0)
        month_spend = float(self._client.get(keys["month_spend"]) or 0.0)
        minute_requests = int(self._client.get(keys["minute_req"]) or 0)
        minute_tokens = int(self._client.get(keys["minute_tok"]) or 0)
        day_requests = int(self._client.get(keys["day_req"]) or 0)
        day_tokens = int(self._client.get(keys["day_tok"]) or 0)
        global_active = int(self._client.zcard(keys["global_leases"]) or 0)
        override_expiry = float(self._client.get(keys["override"]) or 0)
        state = _derive_state(config, day_spend, month_spend, override_expiry, now)
        return {
            "state": state,
            "day_spend_usd": round(day_spend, 4),
            "month_spend_usd": round(month_spend, 4),
            "daily_budget_usd": config.daily_budget_usd,
            "monthly_budget_usd": config.monthly_budget_usd,
            "requests_this_minute": minute_requests,
            "tokens_this_minute": minute_tokens,
            "requests_today": day_requests,
            "tokens_today": day_tokens,
            "global_concurrent_active": global_active,
            "global_max_concurrent": config.global_max_concurrent,
            "override_active": override_expiry > now,
            "override_expires_at": (
                datetime.fromtimestamp(override_expiry, tz=timezone.utc).isoformat() if override_expiry > now else None
            ),
            "pricing_version": PRICING_VERSION,
            "mode": "redis",
        }

    def set_override(self, expires_at: float) -> None:
        keys = self._keys("_override", "_override", "_override", time.time())
        ttl_ms = max(1000, int((expires_at - time.time()) * 1000) + 1000)
        self._client.set(keys["override"], repr(float(expires_at)), px=ttl_ms)

    def clear_override(self) -> None:
        keys = self._keys("_override", "_override", "_override", time.time())
        self._client.delete(keys["override"])


def _derive_state(config: AIBudgetConfig, day_spend: float, month_spend: float, override_expiry: float, now: float) -> str:
    if override_expiry > now:
        return STATE_MANUAL_OVERRIDE
    day_ratio = (day_spend / config.daily_budget_usd) if config.daily_budget_usd > 0 else 0
    month_ratio = (month_spend / config.monthly_budget_usd) if config.monthly_budget_usd > 0 else 0
    worst = max(day_ratio, month_ratio)
    if worst >= 1.0:
        return STATE_HARD_STOP
    if worst >= config.restricted_threshold_pct:
        return STATE_RESTRICTED
    if worst >= config.warning_threshold_pct:
        return STATE_WARNING
    return STATE_NORMAL


class _InMemoryBackend:
    """Best-effort, single-process fallback used only when Redis is
    unavailable and ``AI_BUDGET_ALLOW_IN_MEMORY`` is set. Not safe across
    multiple worker processes — see ``validate_ai_budget_configuration``.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._minute_requests = 0
        self._minute_tokens = 0
        self._minute_window_start = 0
        self._day_requests = 0
        self._day_tokens = 0
        self._day_key = ""
        self._day_spend = 0.0
        self._month_key = ""
        self._month_spend = 0.0
        self._global_leases: dict[str, float] = {}
        self._provider_leases: dict[str, dict[str, float]] = {}
        self._model_leases: dict[str, dict[str, float]] = {}
        self._reservations: dict[str, dict[str, Any]] = {}
        self._override_expiry = 0.0

    def _roll_windows(self, now: float) -> None:
        minute_start = _window_start(now, 60)
        if minute_start != self._minute_window_start:
            self._minute_window_start = minute_start
            self._minute_requests = 0
            self._minute_tokens = 0
        day_key = _day_key_suffix(now)
        if day_key != self._day_key:
            self._day_key = day_key
            self._day_requests = 0
            self._day_tokens = 0
            self._day_spend = 0.0
        month_key = _month_key_suffix(now)
        if month_key != self._month_key:
            self._month_key = month_key
            self._month_spend = 0.0

    def reserve(self, *, config, provider, model, estimated_tokens, estimated_cost, essential, request_id, now):
        with self._lock:
            self._roll_windows(now)
            for leases in (self._global_leases,):
                for rid in [k for k, exp in leases.items() if exp < now]:
                    del leases[rid]
            provider_leases = self._provider_leases.setdefault(provider, {})
            model_leases = self._model_leases.setdefault(model, {})
            for leases in (provider_leases, model_leases):
                for rid in [k for k, exp in leases.items() if exp < now]:
                    del leases[rid]

            override_active = self._override_expiry > now
            state = _derive_state(config, self._day_spend, self._month_spend, self._override_expiry, now)

            if state == STATE_HARD_STOP and not override_active:
                return False, "hard_stop", state, 3600, self._day_spend, self._month_spend
            if state == STATE_RESTRICTED and not essential and not override_active:
                return False, "restricted", state, 120, self._day_spend, self._month_spend
            if config.global_max_concurrent > 0 and len(self._global_leases) >= config.global_max_concurrent:
                return False, "global_concurrency", state, 5, self._day_spend, self._month_spend
            if config.provider_max_concurrent > 0 and len(provider_leases) >= config.provider_max_concurrent:
                return False, "provider_concurrency", state, 5, self._day_spend, self._month_spend
            if config.model_max_concurrent > 0 and len(model_leases) >= config.model_max_concurrent:
                return False, "model_concurrency", state, 5, self._day_spend, self._month_spend
            if config.global_requests_per_minute > 0 and self._minute_requests + 1 > config.global_requests_per_minute:
                return False, "global_requests_per_minute", state, 60, self._day_spend, self._month_spend
            if config.global_tokens_per_minute > 0 and self._minute_tokens + estimated_tokens > config.global_tokens_per_minute:
                return False, "global_tokens_per_minute", state, 60, self._day_spend, self._month_spend
            if config.global_requests_per_day > 0 and self._day_requests + 1 > config.global_requests_per_day:
                return False, "global_requests_per_day", state, 3600, self._day_spend, self._month_spend
            if config.global_tokens_per_day > 0 and self._day_tokens + estimated_tokens > config.global_tokens_per_day:
                return False, "global_tokens_per_day", state, 3600, self._day_spend, self._month_spend

            self._minute_requests += 1
            self._minute_tokens += estimated_tokens
            self._day_requests += 1
            self._day_tokens += estimated_tokens
            self._day_spend += estimated_cost
            self._month_spend += estimated_cost
            expiry = now + max(5, config.lease_ttl_seconds)
            self._global_leases[request_id] = expiry
            provider_leases[request_id] = expiry
            model_leases[request_id] = expiry
            self._reservations[request_id] = {
                "estimated_cost": estimated_cost,
                "estimated_tokens": estimated_tokens,
                "provider": provider,
                "model": model,
            }
            return True, "", state, 0, self._day_spend, self._month_spend

    def reconcile(self, request_id, provider, model, now, actual_cost, actual_tokens):
        with self._lock:
            reservation = self._reservations.get(request_id)
            if not reservation:
                return
            cost_delta = actual_cost - reservation["estimated_cost"]
            token_delta = actual_tokens - reservation["estimated_tokens"]
            self._day_spend += cost_delta
            self._month_spend += cost_delta
            self._day_tokens += token_delta
            self._minute_tokens += token_delta
            reservation["estimated_cost"] = actual_cost
            reservation["estimated_tokens"] = actual_tokens

    def release(self, request_id, provider, model, now, refund_estimate):
        with self._lock:
            self._global_leases.pop(request_id, None)
            self._provider_leases.get(provider, {}).pop(request_id, None)
            self._model_leases.get(model, {}).pop(request_id, None)
            reservation = self._reservations.pop(request_id, None)
            if refund_estimate and reservation:
                self._day_spend -= reservation["estimated_cost"]
                self._month_spend -= reservation["estimated_cost"]
                self._day_tokens -= reservation["estimated_tokens"]
                self._minute_tokens -= reservation["estimated_tokens"]

    def status(self, config: AIBudgetConfig, now: float) -> dict[str, Any]:
        with self._lock:
            self._roll_windows(now)
            state = _derive_state(config, self._day_spend, self._month_spend, self._override_expiry, now)
            return {
                "state": state,
                "day_spend_usd": round(self._day_spend, 4),
                "month_spend_usd": round(self._month_spend, 4),
                "daily_budget_usd": config.daily_budget_usd,
                "monthly_budget_usd": config.monthly_budget_usd,
                "requests_this_minute": self._minute_requests,
                "tokens_this_minute": self._minute_tokens,
                "requests_today": self._day_requests,
                "tokens_today": self._day_tokens,
                "global_concurrent_active": len(self._global_leases),
                "global_max_concurrent": config.global_max_concurrent,
                "override_active": self._override_expiry > now,
                "override_expires_at": (
                    datetime.fromtimestamp(self._override_expiry, tz=timezone.utc).isoformat()
                    if self._override_expiry > now else None
                ),
                "pricing_version": PRICING_VERSION,
                "mode": "memory",
            }

    def set_override(self, expires_at: float) -> None:
        with self._lock:
            self._override_expiry = expires_at

    def clear_override(self) -> None:
        with self._lock:
            self._override_expiry = 0.0


class AIBudgetGuard:
    """Public entry point used by AI proxy routes and admin endpoints."""

    def __init__(self, config: Optional[AIBudgetConfig] = None, redis_client: Any | None = None):
        self.config = config or AIBudgetConfig()
        self._redis_backend: Optional[_RedisBackend] = None

        client = redis_client if redis_client is not None else get_rate_limit_redis_client()
        if client is not None:
            self._redis_backend = _RedisBackend(client, self.config.key_prefix)
            logger.info("AI budget guard is using Redis-backed shared state")
        else:
            environment = (os.getenv("ENVIRONMENT") or "").strip().lower()
            if environment == "production":
                logger.error(
                    "SECURITY: Redis is not configured for the AI budget guard in production. "
                    "validate_ai_budget_configuration() should have refused to start unless "
                    "AI_BUDGET_ALLOW_IN_MEMORY or AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE is set."
                )
            logger.info("AI budget guard is using an in-memory fallback (single-process only)")

        # Always available as a fallback for local/dev/test and for a
        # transient Redis outage (see reserve()/reconcile()/release() below);
        # production correctness with multiple workers is enforced by
        # validate_ai_budget_configuration() at startup, not here.
        self._memory_backend = _InMemoryBackend()

    def uses_redis(self) -> bool:
        return self._redis_backend is not None

    def _reserve_backend(self):
        """Backend used for a *new* reservation. Redis is authoritative
        whenever configured; a mid-flight Redis outage here is handled
        explicitly in ``reserve()`` (fail-closed by default, or fail-open
        to the in-memory backend when ``AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE``
        is set) rather than silently mixing accounting backends.
        """
        return self._redis_backend if self._redis_backend is not None else self._memory_backend

    def reserve(
        self,
        *,
        provider: str,
        model: str,
        estimated_input_tokens: int,
        estimated_output_tokens: int,
        essential: bool = False,
    ) -> BudgetReservation:
        now = time.time()
        estimated_tokens = max(0, int(estimated_input_tokens)) + max(0, int(estimated_output_tokens))
        estimated_cost = estimate_cost_usd(model, estimated_input_tokens, estimated_output_tokens)
        request_id = uuid.uuid4().hex

        backend = self._reserve_backend()
        used_memory_fallback = backend is self._memory_backend
        try:
            allowed, reason, state, retry_after, _day_spend, _month_spend = backend.reserve(
                config=self.config,
                provider=provider,
                model=model,
                estimated_tokens=estimated_tokens,
                estimated_cost=estimated_cost,
                essential=essential,
                request_id=request_id,
                now=now,
            )
        except Exception as exc:
            if self._redis_backend is not None and backend is self._redis_backend:
                logger.error("AI budget guard: Redis outage during reserve(): %s", exc)
                if self.config.fail_open_on_redis_outage:
                    allowed, reason, state, retry_after = (
                        True,
                        "",
                        STATE_WARNING,
                        0,
                    )
                    used_memory_fallback = True
                    reservation = BudgetReservation(request_id, provider, model, estimated_tokens, 0.0)
                    reservation.reconciled = True  # never accounted; nothing to reconcile/refund later
                    return reservation
                raise AIBudgetDenied(
                    "redis_unavailable",
                    STATE_HARD_STOP,
                    _DEFAULT_RETRY_AFTER["redis_unavailable"],
                    "AI budget accounting is temporarily unavailable. Please retry shortly.",
                ) from exc
            raise

        if not allowed:
            retry_after = retry_after or _DEFAULT_RETRY_AFTER.get(reason, 30)
            raise AIBudgetDenied(reason, state, retry_after, _denial_detail(reason, state, retry_after))

        reservation = BudgetReservation(request_id, provider, model, estimated_tokens, estimated_cost)
        reservation.used_memory_fallback = used_memory_fallback
        return reservation

    def _backend_for(self, reservation: BudgetReservation):
        if reservation.used_memory_fallback:
            return self._memory_backend
        return self._reserve_backend()

    def reconcile(self, reservation: BudgetReservation, *, actual_input_tokens: int, actual_output_tokens: int) -> None:
        if reservation.reconciled or reservation.released:
            return
        backend = self._backend_for(reservation)
        actual_tokens = max(0, int(actual_input_tokens)) + max(0, int(actual_output_tokens))
        actual_cost = estimate_cost_usd(reservation.model, actual_input_tokens, actual_output_tokens)
        try:
            backend.reconcile(reservation.request_id, reservation.provider, reservation.model, time.time(), actual_cost, actual_tokens)
        except Exception as exc:
            logger.warning("AI budget guard: reconcile failed (non-fatal): %s", exc)
        reservation.reconciled = True

    def release(self, reservation: BudgetReservation) -> None:
        """Release the concurrency slot and, if the reservation was never
        reconciled to actual usage (failure/cancellation before completion),
        refund the full estimated cost/tokens. A reservation that already
        reconciled is left as-is — its cost has already been corrected to
        the actual amount, so refunding again would double-count.
        """
        if reservation.released:
            return
        backend = self._backend_for(reservation)
        refund_estimate = not reservation.reconciled
        try:
            backend.release(reservation.request_id, reservation.provider, reservation.model, time.time(), refund_estimate)
        except Exception as exc:
            logger.warning("AI budget guard: release failed (non-fatal): %s", exc)
        reservation.released = True

    def get_status(self) -> dict[str, Any]:
        try:
            backend = self._reserve_backend()
            return backend.status(self.config, time.time())
        except Exception as exc:
            logger.warning("AI budget guard: status read failed, falling back to in-memory view: %s", exc)
            return self._memory_backend.status(self.config, time.time())

    def compute_override_expiry(self, duration_seconds: int) -> float:
        """Pure helper so callers (e.g. the admin route) can compute and audit
        the override expiry *before* actually setting it — audit-before-action
        for a destructive/risk-widening admin operation."""
        return time.time() + max(60, min(duration_seconds, 24 * 3600))

    def set_manual_override(self, *, expires_at: float, admin_id: str, reason: str) -> float:
        try:
            self._reserve_backend().set_override(expires_at)
        except Exception as exc:
            raise AIBudgetDenied(
                "redis_unavailable", STATE_HARD_STOP, 30, "Cannot set override: budget backend unavailable."
            ) from exc
        return expires_at

    def clear_manual_override(self) -> None:
        try:
            self._reserve_backend().clear_override()
        except Exception as exc:
            logger.warning("AI budget guard: clear_manual_override failed: %s", exc)


def _denial_detail(reason: str, state: str, retry_after: int) -> str:
    messages = {
        "hard_stop": (
            "The AI service has reached its internal daily/monthly spend limit and is temporarily "
            "unavailable. This protects the beta budget; try again later or contact support."
        ),
        "restricted": (
            "The AI service is running in a restricted state due to elevated spend. "
            "Only essential requests are being served right now."
        ),
        "global_concurrency": "The AI service is at maximum global capacity. Please retry shortly.",
        "provider_concurrency": "The AI provider is at maximum concurrent capacity. Please retry shortly.",
        "model_concurrency": "This AI model is at maximum concurrent capacity. Please retry shortly.",
        "global_requests_per_minute": "Global AI request rate limit reached for this minute.",
        "global_tokens_per_minute": "Global AI token rate limit reached for this minute.",
        "global_requests_per_day": "Global AI daily request limit reached.",
        "global_tokens_per_day": "Global AI daily token limit reached.",
        "redis_unavailable": "AI budget accounting is temporarily unavailable.",
    }
    base = messages.get(reason, "The AI service is temporarily unavailable.")
    return f"{base} (state={state}, retry_after={retry_after}s)"


def _worker_count() -> int:
    for key in ("WEB_CONCURRENCY", "WORKERS"):
        raw = (os.getenv(key) or "").strip()
        if raw.isdigit():
            return max(1, int(raw))
    return 1


def validate_ai_budget_configuration() -> None:
    """Fail fast when production cannot enforce the global AI budget guard."""
    env = (os.getenv("ENVIRONMENT") or "").strip().lower()
    if env != "production":
        return

    allow_memory = _is_truthy(os.getenv("AI_BUDGET_ALLOW_IN_MEMORY"))
    fail_open = _is_truthy(os.getenv("AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE"))
    has_redis = get_rate_limit_redis_client() is not None
    workers = _worker_count()

    if fail_open:
        logger.error(
            "SECURITY: AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE is set in production. A Redis outage "
            "will allow uncapped AI spend. This should only be used as a deliberate, time-boxed "
            "availability-over-cost decision."
        )
        return

    if workers > 1 and not has_redis:
        raise RuntimeError(
            "FATAL: Production is configured with multiple workers but Redis is missing. "
            "The global AI budget guard requires Redis for correctness with multiple workers."
        )
    if not has_redis and not allow_memory:
        raise RuntimeError(
            "FATAL: Production requires Redis for the global AI budget guard, or set "
            "AI_BUDGET_ALLOW_IN_MEMORY=true for an explicit single-worker beta deployment."
        )


def ai_budget_readiness_status() -> dict[str, Any]:
    """Component status for /health/ready."""
    env = (os.getenv("ENVIRONMENT") or "").strip().lower()
    if ai_budget_guard.uses_redis():
        return {"status": "ok", "mode": "redis"}
    if env == "production":
        if ai_budget_guard.config.fail_open_on_redis_outage:
            return {"status": "degraded", "mode": "fail-open", "detail": "Redis unavailable; spend is uncapped"}
        if not ai_budget_guard.config.allow_in_memory:
            return {"status": "error", "mode": "unavailable", "detail": "Redis unavailable and in-memory fallback disabled"}
        if _worker_count() > 1:
            return {"status": "error", "mode": "memory", "detail": "multiple workers without Redis"}
    return {"status": "ok", "mode": "memory", "detail": "local fallback"}


ai_budget_guard = AIBudgetGuard()
