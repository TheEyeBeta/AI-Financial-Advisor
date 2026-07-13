"""Single-use WebSocket authentication tickets (issue #205, audit M-03).

Browsers cannot reliably attach an ``Authorization`` header to a WebSocket
handshake, and putting the long-lived Supabase JWT in the URL leaks it into
proxy/monitoring logs and browser history. Instead the frontend requests a
short-lived, single-use ticket over authenticated HTTPS and presents only
that opaque ticket on the WebSocket URL:

1. ``POST /api/v1/ws/ticket`` (Bearer JWT) → ``{"ticket": ..., "expires_in": ...}``
2. ``wss://.../ws/live?ticket=<ticket>`` — the backend consumes the ticket
   atomically; replaying it (or using it after expiry) fails.

Tickets are bound to the issuing user, the intended endpoint, and a nonce,
and are stored hashed (SHA-256) so the raw value never rests in the store.
Redis (shared with the rate limiter) is used when configured so tickets work
across workers/replicas; a process-local store is the dev/test fallback.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

from .rate_limit_redis import get_rate_limit_redis_client

logger = logging.getLogger(__name__)

WS_TICKET_TTL_ENV = "WS_TICKET_TTL_SECONDS"
DEFAULT_TICKET_TTL_SECONDS = 60
_KEY_PREFIX = "websearch:ws_ticket"

# Atomic read-and-delete so a ticket can never authenticate two connections,
# even when two handshakes race on different workers.
_CONSUME_SCRIPT = """
local value = redis.call("GET", KEYS[1])
if value then
    redis.call("DEL", KEYS[1])
end
return value
"""


@dataclass(frozen=True)
class WebSocketTicketClaims:
    """Verified identity carried by a consumed ticket."""

    user_id: str
    endpoint: str
    email: Optional[str] = None


def ticket_ttl_seconds() -> int:
    raw = (os.getenv(WS_TICKET_TTL_ENV) or "").strip()
    try:
        ttl = int(raw) if raw else DEFAULT_TICKET_TTL_SECONDS
    except ValueError:
        ttl = DEFAULT_TICKET_TTL_SECONDS
    return max(5, min(ttl, 300))


def _hash_ticket(ticket: str) -> str:
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


def _storage_key(ticket: str) -> str:
    return f"{_KEY_PREFIX}:{_hash_ticket(ticket)}"


class InMemoryTicketBackend:
    """Process-local fallback for development/tests (single worker only)."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def set(self, key: str, value: str, ttl_seconds: int) -> None:
        now = time.monotonic()
        with self._lock:
            # Opportunistic purge keeps the map bounded without a sweeper task.
            expired = [k for k, (exp, _) in self._entries.items() if exp <= now]
            for k in expired:
                del self._entries[k]
            self._entries[key] = (now + ttl_seconds, value)

    def consume(self, key: str) -> Optional[str]:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.pop(key, None)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= now:
            return None
        return value


class RedisTicketBackend:
    """Shared ticket storage so tickets survive multi-worker deployments."""

    def __init__(self, client: Any) -> None:
        self._client = client
        self._consume_script = client.register_script(_CONSUME_SCRIPT)

    def set(self, key: str, value: str, ttl_seconds: int) -> None:
        self._client.set(key, value, ex=ttl_seconds)

    def consume(self, key: str) -> Optional[str]:
        try:
            result = self._consume_script(keys=[key], args=[])
        except Exception as exc:
            message = str(exc).lower()
            if "unknown command 'evalsha'" not in message and "noscript" not in message:
                raise
            result = self._client.eval(_CONSUME_SCRIPT, 1, key)
        if result is None:
            return None
        return result if isinstance(result, str) else result.decode("utf-8")


class WebSocketTicketStore:
    """Issues and atomically consumes single-use WebSocket tickets."""

    def __init__(self, backend: Any) -> None:
        self._backend = backend

    def issue(self, *, user_id: str, endpoint: str, email: Optional[str] = None) -> tuple[str, int]:
        """Return ``(ticket, expires_in_seconds)`` for the given user/endpoint."""
        ticket = secrets.token_urlsafe(32)
        ttl = ticket_ttl_seconds()
        payload = json.dumps(
            {
                "user_id": user_id,
                "endpoint": endpoint,
                "email": email,
                "nonce": secrets.token_hex(8),
            }
        )
        self._backend.set(_storage_key(ticket), payload, ttl)
        return ticket, ttl

    def consume(self, ticket: str, *, endpoint: str) -> Optional[WebSocketTicketClaims]:
        """Validate and destroy a ticket. Returns None for missing/expired/replayed/mismatched tickets."""
        if not ticket or len(ticket) > 256:
            return None
        try:
            raw = self._backend.consume(_storage_key(ticket))
        except Exception as exc:
            logger.error("WebSocket ticket store unavailable: %s", type(exc).__name__)
            return None
        if raw is None:
            return None
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return None
        if data.get("endpoint") != endpoint:
            # Ticket bound to another endpoint must not authenticate here —
            # and it has already been consumed, so it cannot be retried either.
            logger.warning("WebSocket ticket endpoint mismatch (wanted %s)", endpoint)
            return None
        user_id = data.get("user_id")
        if not user_id:
            return None
        return WebSocketTicketClaims(
            user_id=str(user_id),
            endpoint=endpoint,
            email=data.get("email") or None,
        )


_store_lock = threading.Lock()
_store: WebSocketTicketStore | None = None


def get_ws_ticket_store() -> WebSocketTicketStore:
    """Singleton store: Redis-backed when available, in-memory otherwise."""
    global _store
    with _store_lock:
        if _store is None:
            client = get_rate_limit_redis_client()
            if client is not None:
                _store = WebSocketTicketStore(RedisTicketBackend(client))
                logger.info("WebSocket tickets: using Redis-backed store")
            else:
                if (os.getenv("ENVIRONMENT") or "").strip().lower() == "production":
                    logger.warning(
                        "WebSocket tickets: Redis unavailable — falling back to a "
                        "process-local store. Tickets will not validate across "
                        "workers/replicas; configure RATE_LIMIT_REDIS_URL/REDIS_URL."
                    )
                _store = WebSocketTicketStore(InMemoryTicketBackend())
        return _store


def reset_ws_ticket_store() -> None:
    """Test hook — drop the cached store so backends can be swapped."""
    global _store
    with _store_lock:
        _store = None
