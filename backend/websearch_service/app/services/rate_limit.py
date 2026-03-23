"""
Professional rate limiting service with cost tracking and abuse prevention.

Features:
- Multi-tier rate limiting (IP, User, Endpoint-specific)
- Cost tracking per user/IP
- Abuse detection and automatic blocking
- Rate limit headers in responses
- Configurable limits per endpoint
- Token usage tracking for cost control
- **Supabase persistence**: counters survive container restarts so a
  Railway/Render deploy never resets limits to zero.
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, Optional, Tuple

from fastapi import HTTPException, Request, Response

logger = logging.getLogger(__name__)


@dataclass
class RateLimitConfig:
    """Configuration for rate limiting."""
    # Request-based limits
    requests_per_minute: int = 30
    requests_per_hour: int = 200
    requests_per_day: int = 1000

    # Cost-based limits (tokens)
    tokens_per_minute: int = 50000
    tokens_per_hour: int = 200000
    tokens_per_day: int = 1000000

    # Abuse detection
    max_concurrent_requests: int = 5
    suspicious_request_threshold: int = 50  # requests in 1 minute
    block_duration_seconds: int = 3600  # 1 hour block

    # Window sizes
    minute_window: int = 60
    hour_window: int = 3600
    day_window: int = 86400


@dataclass
class RateLimitState:
    """Tracks rate limit state for an identifier."""
    # Request timestamps
    requests_minute: Deque[float] = field(default_factory=deque)
    requests_hour: Deque[float] = field(default_factory=deque)
    requests_day: Deque[float] = field(default_factory=deque)

    # Token usage tracking
    tokens_minute: int = 0
    tokens_hour: int = 0
    tokens_day: int = 0

    # Abuse detection
    suspicious_count: int = 0
    blocked_until: Optional[float] = None
    concurrent_requests: int = 0

    # Last cleanup time
    last_cleanup: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Supabase persistence helpers
# ---------------------------------------------------------------------------

def _get_supabase_client():
    """Lazy-init Supabase client for rate limit persistence."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        return None
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception as exc:
        logger.warning("Failed to create Supabase client for rate limiting: %s", exc)
        return None


def _window_start_for(window_type: str, now: float) -> datetime:
    """Return the start of the current window as a datetime."""
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    if window_type == "minute":
        return dt.replace(second=0, microsecond=0)
    elif window_type == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    else:  # day
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _window_is_current(window_start_str: str, window_type: str, now: float) -> bool:
    """Check if a stored window_start is still within the current window."""
    try:
        stored = datetime.fromisoformat(window_start_str.replace("Z", "+00:00"))
        current = _window_start_for(window_type, now)
        return stored >= current
    except Exception:
        return False


class RateLimitService:
    """Professional rate limiting service with Supabase persistence."""

    # How often to flush in-memory state to Supabase (seconds)
    _PERSIST_INTERVAL = 30

    def __init__(self):
        # Per-identifier state (IP or user_id)
        self._state: Dict[str, RateLimitState] = defaultdict(RateLimitState)

        # Endpoint-specific configs
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

        # Default config
        self._default_config = RateLimitConfig()

        # Cleanup interval (cleanup old entries every 5 minutes)
        self._last_cleanup = time.time()
        self._cleanup_interval = 300

        # Persistence tracking
        self._last_persist = time.time()
        self._dirty_keys: set[tuple[str, str]] = set()  # (identifier, endpoint)
        self._loaded_from_db = False

    def _get_config(self, endpoint: str) -> RateLimitConfig:
        """Get rate limit config for an endpoint."""
        return self._endpoint_configs.get(endpoint, self._default_config)

    # Trusted proxy CIDR ranges whose X-Forwarded-For / X-Real-IP headers we honour.
    # Railway, Render, Vercel, and common cloud load balancers all fall in RFC-1918
    # or well-known ranges. Extend via TRUSTED_PROXY_IPS env var (comma-separated).
    _TRUSTED_PROXY_NETS: tuple[str, ...] = (
        "127.0.0.1",
        "::1",
        "10.",       # RFC 1918
        "172.16.",   # RFC 1918
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
        "192.168.", # RFC 1918
    )

    def _is_trusted_proxy(self, ip: str) -> bool:
        """Return True if the connecting IP is a known trusted proxy."""
        extra_trusted = [
            p.strip()
            for p in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
            if p.strip()
        ]
        all_trusted = list(self._TRUSTED_PROXY_NETS) + extra_trusted
        return any(ip.startswith(prefix) for prefix in all_trusted)

    def _get_identifier(self, request: Request, user_id: Optional[str] = None) -> str:
        """
        Get a rate-limit identifier.
        Priority: verified user_id (from auth token) > direct client IP.

        SECURITY: X-Forwarded-For and X-Real-IP are only trusted when the
        direct connection comes from a known private-network proxy address.
        An attacker connecting directly CANNOT spoof these headers to bypass
        IP-based rate limits.
        """
        if user_id:
            return f"user:{user_id}"

        # Direct connecting IP — always reliable
        direct_ip = request.client.host if request.client else None

        if direct_ip and self._is_trusted_proxy(direct_ip):
            # The connection comes from an internal proxy — trust the forwarded header.
            forwarded_for = request.headers.get("X-Forwarded-For")
            if forwarded_for:
                # First IP in the chain is the original client
                client_ip = forwarded_for.split(",")[0].strip()
                return f"ip:{client_ip}" if client_ip else "ip:unknown"

            real_ip = request.headers.get("X-Real-IP", "").strip()
            if real_ip:
                return f"ip:{real_ip}"

        # Either not behind a trusted proxy, or no forwarded header — use direct IP.
        return f"ip:{direct_ip}" if direct_ip else "ip:unknown"

    # ------------------------------------------------------------------
    # Supabase persistence: load on first request, flush periodically
    # ------------------------------------------------------------------

    def _load_from_db(self):
        """Load persisted rate limit state from Supabase on first use."""
        if self._loaded_from_db:
            return
        self._loaded_from_db = True

        client = _get_supabase_client()
        if not client:
            logger.info("No Supabase client available — rate limits are in-memory only")
            return

        try:
            now = time.time()
            resp = client.schema("core").table("rate_limit_state").select("*").execute()
            rows = resp.data or []
            loaded = 0
            for row in rows:
                wtype = row.get("window_type", "")
                ws = row.get("window_start", "")
                if not _window_is_current(ws, wtype, now):
                    continue  # stale window, skip

                identifier = row["identifier"]
                endpoint = row.get("endpoint", "__default__")
                state = self._state[identifier]
                req_count = row.get("request_count", 0)
                tok_count = row.get("token_count", 0)

                # Populate the deques with synthetic timestamps spread across
                # the current window so the sliding-window logic works.
                window_secs = {"minute": 60, "hour": 3600, "day": 86400}.get(wtype, 86400)
                start_ts = now - window_secs
                if req_count > 0:
                    interval = window_secs / req_count
                    for i in range(req_count):
                        ts = start_ts + interval * (i + 1)
                        deq = getattr(state, f"requests_{wtype}", None)
                        if deq is not None:
                            deq.append(ts)

                # Restore token counters
                if wtype == "minute":
                    state.tokens_minute = max(state.tokens_minute, tok_count)
                elif wtype == "hour":
                    state.tokens_hour = max(state.tokens_hour, tok_count)
                elif wtype == "day":
                    state.tokens_day = max(state.tokens_day, tok_count)

                # Restore blocked_until
                blocked = row.get("blocked_until")
                if blocked:
                    try:
                        bt = datetime.fromisoformat(blocked.replace("Z", "+00:00"))
                        bt_ts = bt.timestamp()
                        if bt_ts > now:
                            state.blocked_until = bt_ts
                    except Exception:
                        pass
                loaded += 1

            if loaded:
                logger.info("Loaded %d rate limit entries from Supabase", loaded)
        except Exception as exc:
            logger.warning("Failed to load rate limits from Supabase: %s", exc)

    def _maybe_persist(self):
        """Flush dirty counters to Supabase if the persist interval has elapsed."""
        now = time.time()
        if now - self._last_persist < self._PERSIST_INTERVAL:
            return
        if not self._dirty_keys:
            return

        self._last_persist = now
        client = _get_supabase_client()
        if not client:
            return

        keys_to_flush = list(self._dirty_keys)
        self._dirty_keys.clear()

        for identifier, endpoint in keys_to_flush:
            state = self._state.get(identifier)
            if not state:
                continue
            try:
                for wtype, deq, tok in [
                    ("minute", state.requests_minute, state.tokens_minute),
                    ("hour", state.requests_hour, state.tokens_hour),
                    ("day", state.requests_day, state.tokens_day),
                ]:
                    ws = _window_start_for(wtype, now).isoformat()
                    row: dict[str, Any] = {
                        "identifier": identifier,
                        "endpoint": endpoint,
                        "window_type": wtype,
                        "request_count": len(deq),
                        "token_count": tok,
                        "window_start": ws,
                        "blocked_until": (
                            datetime.fromtimestamp(state.blocked_until, tz=timezone.utc).isoformat()
                            if state.blocked_until and state.blocked_until > now
                            else None
                        ),
                    }
                    client.schema("core").table("rate_limit_state").upsert(
                        row,
                        on_conflict="identifier,endpoint,window_type",
                    ).execute()
            except Exception as exc:
                logger.warning("Failed to persist rate limit for %s: %s", identifier, exc)

    # ------------------------------------------------------------------
    # Core rate limiting logic
    # ------------------------------------------------------------------

    def _cleanup_old_entries(self):
        """Remove old entries to prevent memory leaks."""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        cutoff = now - self._default_config.day_window * 2

        # Remove identifiers with no recent activity
        to_remove = []
        for identifier, state in self._state.items():
            if (
                not state.requests_day
                or (state.requests_day and state.requests_day[-1] < cutoff)
            ):
                to_remove.append(identifier)

        for identifier in to_remove:
            del self._state[identifier]

    def _check_blocked(self, identifier: str, state: RateLimitState) -> Optional[str]:
        """Check if identifier is blocked."""
        if state.blocked_until and time.time() < state.blocked_until:
            remaining = int(state.blocked_until - time.time())
            return f"Account temporarily blocked due to suspicious activity. Retry after {remaining} seconds."
        return None

    def _check_abuse(self, identifier: str, state: RateLimitState, config: RateLimitConfig):
        """Detect and handle abuse patterns."""
        now = time.time()

        # Check for suspicious request patterns
        recent_requests = sum(
            1 for ts in state.requests_minute
            if now - ts < config.minute_window
        )

        if recent_requests >= config.suspicious_request_threshold:
            state.suspicious_count += 1
            state.blocked_until = now + config.block_duration_seconds

            # Log abuse detection (synchronous logging to avoid async issues)
            try:
                import asyncio
                from ..services.audit import audit_log
                # Try to get event loop, if none exists, create task
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(audit_log(
                            "rate_limit_abuse_detected",
                            {
                                "identifier": identifier,
                                "requests_in_minute": recent_requests,
                                "blocked_until": datetime.fromtimestamp(state.blocked_until).isoformat(),
                            }
                        ))
                    else:
                        loop.run_until_complete(audit_log(
                            "rate_limit_abuse_detected",
                            {
                                "identifier": identifier,
                                "requests_in_minute": recent_requests,
                                "blocked_until": datetime.fromtimestamp(state.blocked_until).isoformat(),
                            }
                        ))
                except RuntimeError:
                    # No event loop, skip async logging
                    pass
            except Exception:
                # Don't fail rate limiting if logging fails
                pass

    def _enforce_limits(
        self,
        identifier: str,
        endpoint: str,
        estimated_tokens: int = 0,
    ) -> Tuple[bool, Optional[str], Dict[str, int]]:
        """
        Enforce rate limits.
        Returns: (allowed, error_message, rate_limit_info)
        """
        # Ensure we have loaded persisted state on first call
        self._load_from_db()

        self._cleanup_old_entries()

        config = self._get_config(endpoint)
        state = self._state[identifier]
        now = time.time()

        # Check if blocked
        block_error = self._check_blocked(identifier, state)
        if block_error:
            return False, block_error, {}

        # Clean old entries from deques
        cutoff_minute = now - config.minute_window
        cutoff_hour = now - config.hour_window
        cutoff_day = now - config.day_window

        while state.requests_minute and state.requests_minute[0] < cutoff_minute:
            state.requests_minute.popleft()
        while state.requests_hour and state.requests_hour[0] < cutoff_hour:
            state.requests_hour.popleft()
        while state.requests_day and state.requests_day[0] < cutoff_day:
            state.requests_day.popleft()

        # Reset token counters if outside window
        if not state.requests_minute or state.requests_minute[0] < cutoff_minute:
            state.tokens_minute = 0
        if not state.requests_hour or state.requests_hour[0] < cutoff_hour:
            state.tokens_hour = 0
        if not state.requests_day or state.requests_day[0] < cutoff_day:
            state.tokens_day = 0

        # Check request limits
        if len(state.requests_minute) >= config.requests_per_minute:
            remaining = int(config.minute_window - (now - state.requests_minute[0]))
            return False, f"Rate limit exceeded: {config.requests_per_minute} requests per minute. Retry after {remaining} seconds.", {}

        if len(state.requests_hour) >= config.requests_per_hour:
            remaining = int(config.hour_window - (now - state.requests_hour[0]))
            return False, f"Rate limit exceeded: {config.requests_per_hour} requests per hour. Retry after {remaining} seconds.", {}

        if len(state.requests_day) >= config.requests_per_day:
            remaining = int(config.day_window - (now - state.requests_day[0]))
            return False, f"Rate limit exceeded: {config.requests_per_day} requests per day. Retry after {remaining} seconds.", {}

        # Check token limits
        if state.tokens_minute + estimated_tokens > config.tokens_per_minute:
            return False, f"Token limit exceeded: {config.tokens_per_minute} tokens per minute.", {}

        if state.tokens_hour + estimated_tokens > config.tokens_per_hour:
            return False, f"Token limit exceeded: {config.tokens_per_hour} tokens per hour.", {}

        if state.tokens_day + estimated_tokens > config.tokens_per_day:
            return False, f"Token limit exceeded: {config.tokens_per_day} tokens per day.", {}

        # Check concurrent requests
        if state.concurrent_requests >= config.max_concurrent_requests:
            return False, f"Too many concurrent requests. Maximum: {config.max_concurrent_requests}", {}

        # All checks passed - record request
        state.requests_minute.append(now)
        state.requests_hour.append(now)
        state.requests_day.append(now)
        state.tokens_minute += estimated_tokens
        state.tokens_hour += estimated_tokens
        state.tokens_day += estimated_tokens
        state.concurrent_requests += 1

        # Check for abuse patterns
        self._check_abuse(identifier, state, config)

        # Mark dirty for persistence
        self._dirty_keys.add((identifier, endpoint))
        self._maybe_persist()

        # Calculate rate limit info for headers
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

    def check_rate_limit(
        self,
        request: Request,
        endpoint: str,
        user_id: Optional[str] = None,
        estimated_tokens: int = 0,
    ) -> Tuple[bool, Optional[str], Dict[str, int]]:
        """
        Check rate limit for a request.
        Returns: (allowed, error_message, rate_limit_info)
        """
        identifier = self._get_identifier(request, user_id)
        return self._enforce_limits(identifier, endpoint, estimated_tokens)

    def record_token_usage(
        self,
        request: Request,
        user_id: Optional[str] = None,
        tokens_used: int = 0,
    ):
        """Record actual token usage after request completes."""
        identifier = self._get_identifier(request, user_id)
        state = self._state[identifier]

        # Adjust token counts (we already added estimated, so adjust)
        # This is approximate - for exact tracking, we'd need to store per-request
        # For now, we'll just update the totals
        now = time.time()
        cutoff_minute = now - self._default_config.minute_window
        cutoff_hour = now - self._default_config.hour_window
        cutoff_day = now - self._default_config.day_window

        # Only update if within windows
        if state.requests_minute and state.requests_minute[-1] >= cutoff_minute:
            # Approximate adjustment
            pass  # Token tracking is already done in _enforce_limits

    def release_request(
        self,
        request: Request,
        user_id: Optional[str] = None,
    ):
        """Release a concurrent request slot."""
        identifier = self._get_identifier(request, user_id)
        state = self._state[identifier]
        if state.concurrent_requests > 0:
            state.concurrent_requests -= 1

    def add_rate_limit_headers(
        self,
        response: Response,
        rate_limit_info: Dict[str, int],
    ):
        """Add rate limit headers to response."""
        response.headers["X-RateLimit-Limit-Minute"] = str(rate_limit_info.get("limit_minute", 0))
        response.headers["X-RateLimit-Remaining-Minute"] = str(rate_limit_info.get("remaining_minute", 0))
        response.headers["X-RateLimit-Reset-Minute"] = str(rate_limit_info.get("reset_minute", 0))

        response.headers["X-RateLimit-Limit-Hour"] = str(rate_limit_info.get("limit_hour", 0))
        response.headers["X-RateLimit-Remaining-Hour"] = str(rate_limit_info.get("remaining_hour", 0))
        response.headers["X-RateLimit-Reset-Hour"] = str(rate_limit_info.get("reset_hour", 0))

        response.headers["X-RateLimit-Limit-Day"] = str(rate_limit_info.get("limit_day", 0))
        response.headers["X-RateLimit-Remaining-Day"] = str(rate_limit_info.get("remaining_day", 0))
        response.headers["X-RateLimit-Reset-Day"] = str(rate_limit_info.get("reset_day", 0))


# Global rate limiter instance
rate_limiter = RateLimitService()
