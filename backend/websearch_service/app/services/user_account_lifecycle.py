"""Safe admin user suspend / delete workflow with guards and audit."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .audit import AuditPersistenceError, audit_log

logger = logging.getLogger(__name__)

RECENT_AUTH_MAX_AGE_SECONDS = int(
    __import__("os").getenv("ADMIN_REAUTH_MAX_AGE_SECONDS", "900")
)
DELETE_RETENTION_HOURS = int(__import__("os").getenv("USER_DELETE_RETENTION_HOURS", "24"))
SNAPSHOT_TTL_SECONDS = 900


class UserLifecycleError(Exception):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AdminCaller:
    principal: str
    auth_user_id: str | None
    email: str | None
    jwt_iat: int | None
    is_service_role: bool


@dataclass
class DeleteRequestSnapshot:
    snapshot_id: str
    confirmation_token: str
    target_auth_id: str
    target_email: str
    expires_at: datetime


_DELETE_SNAPSHOTS: dict[str, dict[str, Any]] = {}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _mandatory_lifecycle_audit(
    event: str,
    *,
    caller: AdminCaller,
    target_auth_id: str,
    request_id: str,
    result: str,
    reason_code: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Write a durable audit record for a destructive account-lifecycle step.

    Raises ``UserLifecycleError(503)`` — not the underlying persistence
    error — so callers can safely abort a destructive operation whose audit
    trail could not be persisted, per the "fail destructive admin operations
    safely" requirement. Never includes raw emails: only the pseudonymized
    actor/target identifiers travel to the audit store.
    """
    actor_id = caller.auth_user_id if not caller.is_service_role else "service-role"
    try:
        await audit_log(
            event,
            extra or {},
            actor_type="service_role" if caller.is_service_role else "admin",
            actor_id=actor_id,
            target_type="user",
            target_id=target_auth_id,
            result=result,
            reason_code=reason_code,
            request_id=request_id,
            mandatory=True,
        )
    except AuditPersistenceError as exc:
        raise UserLifecycleError(
            "audit trail could not be durably persisted; refusing to proceed with "
            "this destructive operation until audit logging is restored",
            status_code=503,
        ) from exc


def enforce_recent_authentication(caller: AdminCaller) -> None:
    if caller.is_service_role:
        return
    if caller.jwt_iat is None:
        raise UserLifecycleError("recent authentication required", status_code=401)
    issued = datetime.fromtimestamp(caller.jwt_iat, tz=timezone.utc)
    age = (datetime.now(timezone.utc) - issued).total_seconds()
    if age > RECENT_AUTH_MAX_AGE_SECONDS:
        raise UserLifecycleError(
            "admin session is too old; sign in again before destructive actions",
            status_code=403,
        )


async def _fetch_user_row(
    http: httpx.AsyncClient,
    *,
    supabase_url: str,
    headers: dict[str, str],
    auth_id: str,
) -> dict[str, Any] | None:
    resp = await http.get(
        f"{supabase_url}/rest/v1/users",
        params={"auth_id": f"eq.{auth_id}", "select": "id,auth_id,email,userType,account_status"},
        headers={**headers, "Accept-Profile": "core"},
    )
    if resp.status_code != 200:
        raise UserLifecycleError("failed to load target user profile", status_code=502)
    rows = resp.json()
    return rows[0] if rows else None


async def _count_active_admins(
    http: httpx.AsyncClient,
    *,
    supabase_url: str,
    headers: dict[str, str],
) -> int:
    resp = await http.get(
        f"{supabase_url}/rest/v1/users",
        params={
            "userType": "eq.Admin",
            "account_status": "eq.active",
            "select": "id",
        },
        headers={**headers, "Accept-Profile": "core", "Prefer": "count=exact"},
    )
    if resp.status_code != 200:
        raise UserLifecycleError("failed to count active admins", status_code=502)
    content_range = resp.headers.get("content-range", "")
    if "/" in content_range:
        total = content_range.split("/")[-1]
        if total.isdigit():
            return int(total)
    return len(resp.json())


def _guard_delete_request(
    *,
    caller: AdminCaller,
    target_auth_id: str,
    target_row: dict[str, Any] | None,
    active_admin_count: int,
) -> str:
    if target_row is None:
        raise UserLifecycleError("target user not found", status_code=404)

    target_email = (target_row.get("email") or "").strip()
    if not caller.is_service_role and caller.auth_user_id == target_auth_id:
        raise UserLifecycleError("admins cannot delete their own account", status_code=403)

    if (
        target_row.get("userType") == "Admin"
        and target_row.get("account_status", "active") == "active"
        and active_admin_count <= 1
    ):
        raise UserLifecycleError("cannot delete the final active admin account", status_code=403)

    status = target_row.get("account_status") or "active"
    if status not in ("suspended", "pending_deletion"):
        raise UserLifecycleError(
            "user must be suspended before permanent deletion; POST suspend first",
            status_code=409,
        )
    return target_email


async def suspend_user_account(
    *,
    supabase_url: str,
    service_role_key: str,
    caller: AdminCaller,
    target_auth_id: str,
    reason: str,
    confirmation_email: str,
) -> dict[str, Any]:
    enforce_recent_authentication(caller)
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    async with httpx.AsyncClient(timeout=30.0) as http:
        target_row = await _fetch_user_row(
            http, supabase_url=supabase_url, headers=headers, auth_id=target_auth_id
        )
        if target_row is None:
            raise UserLifecycleError("target user not found", status_code=404)

        target_email = (target_row.get("email") or "").strip()
        if confirmation_email.strip().lower() != target_email.lower():
            raise UserLifecycleError("confirmation email does not match target user", status_code=400)

        if not caller.is_service_role and caller.auth_user_id == target_auth_id:
            raise UserLifecycleError("admins cannot suspend their own account", status_code=403)

        active_admins = await _count_active_admins(http, supabase_url=supabase_url, headers=headers)
        if (
            target_row.get("userType") == "Admin"
            and target_row.get("account_status", "active") == "active"
            and active_admins <= 1
        ):
            raise UserLifecycleError("cannot suspend the final active admin account", status_code=403)

        request_id = str(uuid.uuid4())
        await _mandatory_lifecycle_audit(
            "admin.user_suspend_attempted",
            caller=caller,
            target_auth_id=target_auth_id,
            request_id=request_id,
            result="pending",
            reason_code="suspend",
            extra={"reason": reason},
        )

        auth_ban_applied = False
        forced_logout_applied = False
        try:
            ban_resp = await http.put(
                f"{supabase_url}/auth/v1/admin/users/{target_auth_id}",
                headers=headers,
                json={"ban_duration": "876000h"},
            )
            if ban_resp.status_code not in (200, 201):
                raise UserLifecycleError("failed to suspend auth user", status_code=502)
            auth_ban_applied = True

            # httpx does not raise on a non-2xx response by default — a
            # failed forced logout must not pass silently, or the account
            # ends up banned and marked "suspended" below while the user's
            # existing sessions remain valid (CodeRabbit, PR #295).
            logout_resp = await http.post(
                f"{supabase_url}/auth/v1/admin/users/{target_auth_id}/logout",
                headers=headers,
                json={"scope": "global"},
            )
            if logout_resp.status_code not in (200, 204):
                raise UserLifecycleError("failed to force logout target user's sessions", status_code=502)
            forced_logout_applied = True

            patch_resp = await http.patch(
                f"{supabase_url}/rest/v1/users",
                params={"auth_id": f"eq.{target_auth_id}"},
                headers={**headers, "Accept-Profile": "core", "Prefer": "return=minimal"},
                json={
                    "account_status": "suspended",
                    "suspended_at": datetime.now(timezone.utc).isoformat(),
                    "suspension_reason": reason[:500],
                },
            )
            if patch_resp.status_code not in (200, 204):
                raise UserLifecycleError("failed to update application user status", status_code=502)
        except Exception as exc:
            # Audit the failure even when only the first of the two systems
            # (auth ban vs. core.users.account_status) succeeded — otherwise
            # a partial failure here leaves the account unable to log in
            # while core.users still reads "active" with no operator signal
            # beyond the earlier "pending" record. `auth_ban_applied` tells
            # an operator reading the audit trail exactly which half of the
            # suspend broke.
            await _mandatory_lifecycle_audit(
                "admin.user_suspend_attempted",
                caller=caller,
                target_auth_id=target_auth_id,
                request_id=request_id,
                result="failure",
                reason_code="suspend",
                extra={
                    "reason": reason,
                    "error": str(exc),
                    "auth_ban_applied": auth_ban_applied,
                    "forced_logout_applied": forced_logout_applied,
                },
            )
            raise

    logger.info(
        "User suspended actor=%s target=%s request_id=%s reason=%r",
        caller.principal,
        target_auth_id,
        request_id,
        reason,
    )
    await _mandatory_lifecycle_audit(
        "admin.user_suspended",
        caller=caller,
        target_auth_id=target_auth_id,
        request_id=request_id,
        result="success",
        reason_code="suspend",
        extra={"reason": reason},
    )
    return {
        "status": "suspended",
        "auth_id": target_auth_id,
        "email": target_email,
        "request_id": request_id,
    }


async def restore_user_account(
    *,
    supabase_url: str,
    service_role_key: str,
    caller: AdminCaller,
    target_auth_id: str,
    confirmation_email: str,
) -> dict[str, Any]:
    """Reverse a suspension: lift the auth ban and reactivate the profile."""
    enforce_recent_authentication(caller)
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    async with httpx.AsyncClient(timeout=30.0) as http:
        target_row = await _fetch_user_row(
            http, supabase_url=supabase_url, headers=headers, auth_id=target_auth_id
        )
        if target_row is None:
            raise UserLifecycleError("target user not found", status_code=404)

        target_email = (target_row.get("email") or "").strip()
        if confirmation_email.strip().lower() != target_email.lower():
            raise UserLifecycleError("confirmation email does not match target user", status_code=400)

        status = target_row.get("account_status") or "active"
        if status != "suspended":
            raise UserLifecycleError(
                "only a suspended account can be restored", status_code=409
            )

        request_id = str(uuid.uuid4())
        await _mandatory_lifecycle_audit(
            "admin.user_restore_attempted",
            caller=caller,
            target_auth_id=target_auth_id,
            request_id=request_id,
            result="pending",
            reason_code="restore",
        )

        auth_unban_applied = False
        try:
            unban_resp = await http.put(
                f"{supabase_url}/auth/v1/admin/users/{target_auth_id}",
                headers=headers,
                json={"ban_duration": "none"},
            )
            if unban_resp.status_code not in (200, 201):
                raise UserLifecycleError("failed to lift auth suspension", status_code=502)
            auth_unban_applied = True

            patch_resp = await http.patch(
                f"{supabase_url}/rest/v1/users",
                params={"auth_id": f"eq.{target_auth_id}"},
                headers={**headers, "Accept-Profile": "core", "Prefer": "return=minimal"},
                json={
                    "account_status": "active",
                    "suspended_at": None,
                    "suspension_reason": None,
                },
            )
            if patch_resp.status_code not in (200, 204):
                raise UserLifecycleError("failed to update application user status", status_code=502)
        except Exception as exc:
            # Same reasoning as suspend_user_account: a partial failure here
            # (auth unbanned but core.users still reads "suspended", or vice
            # versa) must be durably visible to an operator, not just the
            # earlier "pending" record.
            await _mandatory_lifecycle_audit(
                "admin.user_restore_attempted",
                caller=caller,
                target_auth_id=target_auth_id,
                request_id=request_id,
                result="failure",
                reason_code="restore",
                extra={
                    "error": str(exc),
                    "auth_unban_applied": auth_unban_applied,
                },
            )
            raise

    logger.info(
        "User restored actor=%s target=%s request_id=%s",
        caller.principal,
        target_auth_id,
        request_id,
    )
    await _mandatory_lifecycle_audit(
        "admin.user_restored",
        caller=caller,
        target_auth_id=target_auth_id,
        request_id=request_id,
        result="success",
        reason_code="restore",
    )
    return {
        "status": "active",
        "auth_id": target_auth_id,
        "email": target_email,
        "request_id": request_id,
    }


async def create_delete_request(
    *,
    supabase_url: str,
    service_role_key: str,
    caller: AdminCaller,
    target_auth_id: str,
) -> DeleteRequestSnapshot:
    enforce_recent_authentication(caller)
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    async with httpx.AsyncClient(timeout=30.0) as http:
        target_row = await _fetch_user_row(
            http, supabase_url=supabase_url, headers=headers, auth_id=target_auth_id
        )
        active_admins = await _count_active_admins(http, supabase_url=supabase_url, headers=headers)
        target_email = _guard_delete_request(
            caller=caller,
            target_auth_id=target_auth_id,
            target_row=target_row,
            active_admin_count=active_admins,
        )

    snapshot_id = str(uuid.uuid4())
    confirmation_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=SNAPSHOT_TTL_SECONDS)
    _DELETE_SNAPSHOTS[snapshot_id] = {
        "token_hash": _hash_token(confirmation_token),
        "target_auth_id": target_auth_id,
        "target_email": target_email,
        "actor": caller.principal,
        "expires_at": expires_at,
        "status": "pending",
    }
    return DeleteRequestSnapshot(
        snapshot_id=snapshot_id,
        confirmation_token=confirmation_token,
        target_auth_id=target_auth_id,
        target_email=target_email,
        expires_at=expires_at,
    )


async def execute_delete_request(
    *,
    supabase_url: str,
    service_role_key: str,
    caller: AdminCaller,
    snapshot_id: str,
    confirmation_token: str,
    confirmation_email: str,
    idempotency_key: str,
) -> dict[str, Any]:
    enforce_recent_authentication(caller)
    snapshot = _DELETE_SNAPSHOTS.get(snapshot_id)
    if not snapshot:
        raise UserLifecycleError("delete request not found or expired", status_code=404)
    if snapshot["status"] == "executed" and snapshot.get("idempotency_key") == idempotency_key:
        return {
            "status": "deleted",
            "auth_id": snapshot["target_auth_id"],
            "idempotent": True,
        }
    if snapshot["status"] != "pending":
        raise UserLifecycleError("delete request already consumed", status_code=409)
    if datetime.now(timezone.utc) > snapshot["expires_at"]:
        snapshot["status"] = "expired"
        raise UserLifecycleError("delete request expired; create a new request", status_code=410)
    if snapshot["actor"] != caller.principal:
        raise UserLifecycleError("delete request actor mismatch", status_code=403)
    if not hmac.compare_digest(snapshot["token_hash"], _hash_token(confirmation_token)):
        raise UserLifecycleError("invalid confirmation token", status_code=403)
    if confirmation_email.strip().lower() != snapshot["target_email"].lower():
        raise UserLifecycleError("confirmation email does not match target user", status_code=400)

    target_auth_id = snapshot["target_auth_id"]
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    async with httpx.AsyncClient(timeout=30.0) as http:
        target_row = await _fetch_user_row(
            http, supabase_url=supabase_url, headers=headers, auth_id=target_auth_id
        )
        active_admins = await _count_active_admins(http, supabase_url=supabase_url, headers=headers)
        _guard_delete_request(
            caller=caller,
            target_auth_id=target_auth_id,
            target_row=target_row,
            active_admin_count=active_admins,
        )

        await _mandatory_lifecycle_audit(
            "admin.user_delete_attempted",
            caller=caller,
            target_auth_id=target_auth_id,
            request_id=idempotency_key,
            result="pending",
            reason_code="delete",
            extra={"snapshot_id": snapshot_id, "idempotency_key": idempotency_key},
        )

        del_resp = await http.delete(
            f"{supabase_url}/auth/v1/admin/users/{target_auth_id}",
            headers=headers,
        )
        if del_resp.status_code == 404:
            # Do not mark the snapshot "executed" until the outcome audit
            # record has actually persisted — otherwise a mandatory-audit
            # failure here would still leave a retry hitting the idempotent
            # early-return path above and silently skip the missing audit.
            await _mandatory_lifecycle_audit(
                "admin.user_deleted",
                caller=caller,
                target_auth_id=target_auth_id,
                request_id=idempotency_key,
                result="success",
                reason_code="delete",
                extra={"snapshot_id": snapshot_id, "idempotency_key": idempotency_key, "already_removed": True},
            )
            snapshot["status"] = "executed"
            snapshot["idempotency_key"] = idempotency_key
            return {"status": "deleted", "auth_id": target_auth_id, "already_removed": True}
        if del_resp.status_code not in (200, 204):
            raise UserLifecycleError("failed to delete auth user", status_code=502)

    logger.info(
        "User deleted actor=%s target=%s snapshot=%s idempotency=%s",
        caller.principal,
        target_auth_id,
        snapshot_id,
        idempotency_key,
    )
    # Same ordering rationale as above: persist the outcome audit record
    # first, then mark the snapshot executed.
    await _mandatory_lifecycle_audit(
        "admin.user_deleted",
        caller=caller,
        target_auth_id=target_auth_id,
        request_id=idempotency_key,
        result="success",
        reason_code="delete",
        extra={"snapshot_id": snapshot_id, "idempotency_key": idempotency_key},
    )
    snapshot["status"] = "executed"
    snapshot["idempotency_key"] = idempotency_key
    return {"status": "deleted", "auth_id": target_auth_id, "snapshot_id": snapshot_id}
