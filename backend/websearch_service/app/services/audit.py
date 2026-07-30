"""Durable, append-only audit trail backed by ``core.audit_events``.

Production audit records must survive service restarts and redeploys —
Railway service filesystems outside a mounted volume are ephemeral, so the
previous local-JSONL-only implementation was not durable. This module now
writes to the database by default and only falls back to a local JSONL file
in development/test, where durability does not matter and Supabase
credentials are frequently stubbed out (see ``tests/conftest.py``).

Design constraints (see docs/security/AUDIT_TRAIL.md for the full write-up):

* No raw emails, prompts, tokens, secrets, or portfolio data ever reach the
  ``metadata`` column — :func:`_redact` strips known-sensitive keys and
  :func:`pseudonymize` one-way-hashes actor/target identifiers.
* Only the service role can INSERT into ``core.audit_events``; there is no
  UPDATE/DELETE grant for any role, enforced again by a DB-side trigger.
* Destructive admin operations (suspend/restore/delete) call this module
  with ``mandatory=True`` *before* performing the destructive action. If the
  audit record cannot be durably persisted, :class:`AuditPersistenceError`
  is raised so the caller aborts rather than performing an unaudited
  destructive change.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

AUDIT_LOG_PATH_ENV = "AI_AUDIT_LOG_PATH"
DEFAULT_AUDIT_LOG_PATH = "logs/audit.jsonl"

AUDIT_PEPPER_ENV = "AUDIT_PSEUDONYM_PEPPER"
_DEV_ONLY_PEPPER = "dev-only-insecure-pepper-do-not-use-in-production"

SCHEMA_VERSION = 1
VALID_RESULTS = frozenset({"success", "failure", "denied", "error", "pending"})
VALID_ACTOR_TYPES = frozenset({"admin", "service_role", "system", "user"})

# Metadata keys (case-insensitive substring match) that must never be stored
# verbatim in an audit record's metadata JSONB.
_REDACT_KEY_MARKERS = (
    "email",
    "prompt",
    "message",
    "token",
    "authorization",
    "password",
    "secret",
    "api_key",
    "apikey",
    "cookie",
    "portfolio",
    "position",
    "holding",
    "balance",
    "confirmation_email",
)

# Fields consumed structurally (promoted to dedicated columns) rather than
# left in metadata, to avoid duplicating pseudonymized identifiers.
_STRUCTURAL_KEYS = frozenset(
    {
        "actor",
        "actor_id",
        "actor_type",
        "user_id",
        "target_auth_id",
        "target_id",
        "target_type",
        "request_id",
        "result",
        "reason",
        "reason_code",
    }
)


class AuditPersistenceError(RuntimeError):
    """Raised when a mandatory audit record could not be durably persisted.

    Callers performing destructive admin operations must treat this as a
    hard stop: do not perform (or do not consider complete) the operation
    the audit record was meant to cover.
    """


def _is_dev_fallback_environment() -> bool:
    """Only development/test use the local file fallback; everything else is DB-backed.

    Deliberately does NOT default an unset/unrecognized ``ENVIRONMENT`` to
    "development" — a misconfigured deployment must fail toward the durable
    DB path (and its stricter pepper requirement), not silently fall back to
    an ephemeral local file.
    """
    env = (os.getenv("ENVIRONMENT") or "").strip().lower()
    return env in ("development", "test")


def _pepper() -> str:
    pepper = (os.getenv(AUDIT_PEPPER_ENV) or "").strip()
    if pepper:
        return pepper
    if _is_dev_fallback_environment():
        return _DEV_ONLY_PEPPER
    raise AuditPersistenceError(
        f"{AUDIT_PEPPER_ENV} is required outside development/test to pseudonymize audit identifiers."
    )


def validate_audit_configuration() -> None:
    """Fail fast at startup, not on the first audit event, when the pepper is absent.

    Without this, a deployment missing AUDIT_PSEUDONYM_PEPPER starts
    successfully and only fails later: every non-mandatory audit event
    silently vanishes (caught and logged in :func:`audit_log`) while every
    mandatory one (destructive admin actions) instead surfaces as a runtime
    503 on first use. Neither failure mode belongs at request time.
    """
    if _is_dev_fallback_environment():
        return
    if not (os.getenv(AUDIT_PEPPER_ENV) or "").strip():
        raise RuntimeError(
            f"FATAL: {AUDIT_PEPPER_ENV} is required when ENVIRONMENT is not development/test. "
            "Set it to a long random secret (see backend/websearch_service/.env.example)."
        )


def pseudonymize(value: str | None) -> str | None:
    """One-way HMAC-SHA256 of an identifier (email, auth id, ...).

    Never reversible; the same input always maps to the same output within a
    given pepper, which is what makes it useful for correlating events about
    the same actor/target without storing the raw identifier.
    """
    if not value:
        return None
    digest = hmac.new(_pepper().encode("utf-8"), str(value).strip().lower().encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()[:32]


def _redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _redact(value)
    if isinstance(value, (list, tuple)):
        return [_redact_value(item) for item in value]
    return value


def _redact(data: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in data.items():
        if key in _STRUCTURAL_KEYS:
            continue
        lowered = key.lower()
        if any(marker in lowered for marker in _REDACT_KEY_MARKERS):
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = _redact_value(value)
    return redacted


def _release_sha() -> str | None:
    return (
        (os.getenv("GIT_SHA") or "").strip()
        or (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "").strip()
        or None
    )


def _safe_uuid(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


# Correlation-id shape: hex/UUID-like tokens only, bounded length. request_id
# can come from a client-supplied X-Request-ID header — never store arbitrary
# attacker-controlled content in metadata just because it isn't a valid UUID.
_SAFE_CLIENT_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _safe_client_request_id(value: str | None) -> str | None:
    if not value or not _SAFE_CLIENT_REQUEST_ID_RE.match(str(value)):
        return None
    return str(value)


def _correlation_request_id() -> str | None:
    try:
        from ..middleware.correlation import get_correlation_id

        return get_correlation_id()
    except Exception:  # pragma: no cover - defensive only
        return None


def _infer_actor_type(event: str, actor_raw: str | None) -> str:
    if actor_raw in ("service-role", "service_role"):
        return "service_role"
    if actor_raw is None:
        return "system"
    if event.startswith("admin."):
        return "admin"
    return "user"


def _coerce_result(data: dict[str, Any], result: str | None) -> str:
    candidate = result or data.get("result")
    if candidate in VALID_RESULTS:
        return candidate
    if data.get("error") or "error" in data:
        return "failure"
    return "success"


def _append_local_fallback(row: dict[str, Any]) -> None:
    """Development/test only. Never used in production."""
    log_path = Path(os.getenv(AUDIT_LOG_PATH_ENV, DEFAULT_AUDIT_LOG_PATH))
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as file_obj:
        file_obj.write(json.dumps(row, default=str) + "\n")


def _insert_row_sync(row: dict[str, Any]) -> None:
    """Synchronous Supabase insert — called from asyncio.to_thread.

    Imported lazily so unit tests that never exercise the DB path don't need
    a real Supabase client configured.
    """
    from .supabase_client import supabase_client

    supabase_client.schema("core").table("audit_events").insert(row).execute()


async def audit_log(
    event: str,
    data: dict[str, Any],
    *,
    actor_type: str | None = None,
    actor_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    result: str | None = None,
    reason_code: str | None = None,
    request_id: str | None = None,
    mandatory: bool = False,
) -> None:
    """Record an audit event.

    ``event`` becomes ``action``. Everything in ``data`` is redacted and
    stored as ``metadata`` unless it maps to a structural column (see
    ``_STRUCTURAL_KEYS``). Set ``mandatory=True`` for destructive admin
    operations: persistence failure raises :class:`AuditPersistenceError`
    instead of being swallowed, so the caller can abort safely.
    """
    try:
        actor_raw = actor_id or data.get("actor") or data.get("actor_id") or data.get("user_id")
        target_raw = target_id or data.get("target_auth_id") or data.get("target_id")

        resolved_actor_type = actor_type or data.get("actor_type") or _infer_actor_type(event, actor_raw)
        if resolved_actor_type not in VALID_ACTOR_TYPES:
            resolved_actor_type = "system"

        metadata = _redact(data)
        raw_request_id = request_id or data.get("request_id") or _correlation_request_id()
        safe_request_id = _safe_uuid(raw_request_id)
        if raw_request_id and safe_request_id is None:
            # Non-UUID client-supplied correlation id (e.g. a free-form
            # X-Request-ID header). Only keep it if it matches a bounded,
            # plausible-id shape — never pass arbitrary attacker-controlled
            # header content into metadata unvalidated.
            safe_client_id = _safe_client_request_id(raw_request_id)
            if safe_client_id is not None:
                metadata["client_request_id"] = safe_client_id

        row = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "actor_type": resolved_actor_type,
            "actor_pseudonymous_id": pseudonymize(actor_raw) if actor_raw not in (None, "service-role", "service_role") else None,
            "action": event,
            "target_type": target_type or data.get("target_type") or ("user" if target_raw else None),
            "target_pseudonymous_id": pseudonymize(target_raw),
            "request_id": safe_request_id,
            "release_sha": _release_sha(),
            "result": _coerce_result(data, result),
            "reason_code": reason_code or data.get("reason_code") or data.get("reason"),
            "metadata": metadata,
            "schema_version": SCHEMA_VERSION,
        }
    except AuditPersistenceError as exc:
        # e.g. pseudonymize() raising because AUDIT_PSEUDONYM_PEPPER is unset
        # outside dev/test — apply the same mandatory/best-effort policy as a
        # persistence failure, so a non-mandatory caller (AI-fallback
        # telemetry, admin job enqueue, ...) is never crashed by this.
        if mandatory:
            raise
        logger.warning("audit_log: failed to build audit row for event %r: %s", event, exc)
        return

    if _is_dev_fallback_environment():
        try:
            await asyncio.to_thread(_append_local_fallback, row)
        except Exception as exc:
            logger.warning("audit_log: local fallback write failed: %s", exc)
            if mandatory:
                raise AuditPersistenceError(f"failed to persist mandatory dev-fallback audit event {event!r}") from exc
        return

    try:
        await asyncio.to_thread(_insert_row_sync, row)
    except Exception as exc:
        if mandatory:
            logger.critical(
                "audit_log: MANDATORY audit event %r could not be persisted: %s", event, exc
            )
            raise AuditPersistenceError(
                f"failed to durably persist mandatory audit event {event!r}"
            ) from exc
        logger.warning("audit_log: failed to persist audit event %r: %s", event, exc)
