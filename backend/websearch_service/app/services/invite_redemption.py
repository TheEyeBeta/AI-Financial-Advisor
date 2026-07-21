"""Atomic invite-redemption primitive (Part 7).

TheEye currently gates its capped beta with usage caps (rate limiter + global
concurrency + AI budget guard — all tested). It does NOT yet have an
invite-code system. This module provides the *race-safe redemption core* for
that system: a single-use / N-use consumer that guarantees no oversubscription
of the final available use under concurrency.

The reference ``InMemoryInviteLedger`` uses a lock so its behaviour can be
proven with real threads in tests. The production adapter should back
``redeem`` with an atomic database statement — e.g.::

    UPDATE core.invites
       SET used = used + 1
     WHERE code = :code
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > now())
       AND used < max_uses
       AND (email_binding IS NULL OR email_binding = :email)
    RETURNING id;

A zero-row result means "already exhausted / invalid" — the same contract this
primitive enforces. This keeps the race decision in the database (or a Redis
Lua script), never in read-modify-write application code.
"""
from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Optional


class RedeemReason(str, Enum):
    OK = "ok"
    NOT_FOUND = "not_found"
    REVOKED = "revoked"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"
    EMAIL_MISMATCH = "email_mismatch"


@dataclass
class RedeemResult:
    success: bool
    reason: str
    code: str = ""

    @property
    def user_message(self) -> str:
        return {
            RedeemReason.OK: "Invite accepted.",
            RedeemReason.NOT_FOUND: "That invite code is not valid.",
            RedeemReason.REVOKED: "That invite has been revoked.",
            RedeemReason.EXPIRED: "That invite has expired.",
            RedeemReason.EXHAUSTED: "That invite has already been used.",
            RedeemReason.EMAIL_MISMATCH: "That invite is registered to a different email.",
        }.get(self.reason, "That invite could not be redeemed.")


@dataclass
class Invite:
    code: str
    max_uses: int = 1
    used: int = 0
    revoked: bool = False
    expires_at: Optional[datetime] = None
    email_binding: Optional[str] = None
    role: str = "user"
    cohort: Optional[str] = None

    @property
    def remaining(self) -> int:
        return max(0, self.max_uses - self.used)


def generate_invite_code(nbytes: int = 16) -> str:
    """Cryptographically strong, URL-safe invite token."""
    return secrets.token_urlsafe(nbytes)


class InMemoryInviteLedger:
    """Reference ledger with lock-guarded atomic redemption + an audit trail."""

    def __init__(self) -> None:
        self._invites: Dict[str, Invite] = {}
        self._lock = threading.Lock()
        self.audit: list[dict] = []

    def create(self, **kwargs) -> Invite:
        code = kwargs.pop("code", None) or generate_invite_code()
        invite = Invite(code=code, **kwargs)
        with self._lock:
            self._invites[code] = invite
        return invite

    def revoke(self, code: str) -> bool:
        with self._lock:
            inv = self._invites.get(code)
            if not inv:
                return False
            inv.revoked = True
            return True

    def redeem(self, code: str, *, email: Optional[str] = None,
               now: Optional[datetime] = None) -> RedeemResult:
        """Atomically consume one use of ``code``. Thread-safe; the entire
        check-and-decrement runs under the lock so concurrent callers can never
        over-consume the final use."""
        now = now or datetime.now(timezone.utc)
        with self._lock:
            inv = self._invites.get(code)
            if inv is None:
                result = RedeemResult(False, RedeemReason.NOT_FOUND, code)
            elif inv.revoked:
                result = RedeemResult(False, RedeemReason.REVOKED, code)
            elif inv.expires_at is not None and _aware(inv.expires_at) <= now:
                result = RedeemResult(False, RedeemReason.EXPIRED, code)
            elif inv.email_binding is not None and (
                email is None or inv.email_binding.lower() != email.lower()
            ):
                result = RedeemResult(False, RedeemReason.EMAIL_MISMATCH, code)
            elif inv.remaining <= 0:
                result = RedeemResult(False, RedeemReason.EXHAUSTED, code)
            else:
                inv.used += 1
                result = RedeemResult(True, RedeemReason.OK, code)
            self.audit.append({
                "code": code, "email": email, "success": result.success,
                "reason": result.reason, "at": now.isoformat(),
            })
            return result


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
