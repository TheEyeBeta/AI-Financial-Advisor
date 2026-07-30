"""Tests for admin user lifecycle safeguards."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.services.audit import AuditPersistenceError
from app.services.user_account_lifecycle import (
    AdminCaller,
    UserLifecycleError,
    enforce_recent_authentication,
    execute_delete_request,
    restore_user_account,
    suspend_user_account,
)


def test_self_delete_forbidden():
    caller = AdminCaller(
        principal="admin@example.com",
        auth_user_id="user-1",
        email="admin@example.com",
        jwt_iat=int(time.time()),
        is_service_role=False,
    )
    with pytest.raises(UserLifecycleError, match="own account"):
        from app.services.user_account_lifecycle import _guard_delete_request

        _guard_delete_request(
            caller=caller,
            target_auth_id="user-1",
            target_row={
                "email": "admin@example.com",
                "userType": "Admin",
                "account_status": "suspended",
            },
            active_admin_count=2,
        )


def test_final_admin_delete_forbidden():
    caller = AdminCaller(
        principal="service-role",
        auth_user_id=None,
        email=None,
        jwt_iat=None,
        is_service_role=True,
    )
    with pytest.raises(UserLifecycleError, match="final active admin"):
        from app.services.user_account_lifecycle import _guard_delete_request

        _guard_delete_request(
            caller=caller,
            target_auth_id="admin-2",
            target_row={
                "email": "admin@example.com",
                "userType": "Admin",
                "account_status": "active",
            },
            active_admin_count=1,
        )


def test_stale_session_forbidden():
    caller = AdminCaller(
        principal="admin@example.com",
        auth_user_id="admin-1",
        email="admin@example.com",
        jwt_iat=int(time.time()) - 10_000,
        is_service_role=False,
    )
    with pytest.raises(UserLifecycleError, match="too old"):
        enforce_recent_authentication(caller)


class _FakeResp:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.headers = headers or {}

    def json(self):
        return self._payload


class _FakeRestoreClient:
    """Routes GET (fetch user), PUT (unban), PATCH (status update)."""

    def __init__(self, *, user_row, unban_status=200, patch_status=204):
        self._user_row = user_row
        self._unban_status = unban_status
        self._patch_status = patch_status
        self.put_calls: list[tuple[str, dict]] = []
        self.patch_calls: list[dict] = []
        self.delete_calls: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, **kw):
        return _FakeResp(200, [self._user_row] if self._user_row else [])

    async def put(self, url, **kw):
        self.put_calls.append((url, kw.get("json", {})))
        return _FakeResp(self._unban_status, {})

    async def patch(self, url, **kw):
        self.patch_calls.append(kw.get("json", {}))
        return _FakeResp(self._patch_status)

    async def post(self, url, **kw):
        return _FakeResp(200, {})

    async def delete(self, url, **kw):
        self.delete_calls.append(url)
        return _FakeResp(200, {})


class _FakeSuspendClient(_FakeRestoreClient):
    """Same routing as restore, plus POST (session logout) and admin-count GET."""

    def __init__(self, *, user_row, active_admin_count=2, logout_status=200, **kw):
        super().__init__(user_row=user_row, **kw)
        self._active_admin_count = active_admin_count
        self._logout_status = logout_status
        self.post_calls: list[str] = []

    async def get(self, url, **kw):
        params = kw.get("params", {})
        if params.get("userType") == "eq.Admin":
            return _FakeResp(200, [{"id": f"admin-{i}"} for i in range(self._active_admin_count)])
        return _FakeResp(200, [self._user_row] if self._user_row else [])

    async def post(self, url, **kw):
        self.post_calls.append(url)
        return _FakeResp(self._logout_status, {})


def _service_caller():
    return AdminCaller(
        principal="service-role",
        auth_user_id=None,
        email=None,
        jwt_iat=None,
        is_service_role=True,
    )


def test_restore_reactivates_suspended_account():
    row = {"auth_id": "user-1", "email": "user@example.com", "account_status": "suspended"}
    fake = _FakeRestoreClient(user_row=row)
    audit_mock = AsyncMock()
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
         patch("app.services.user_account_lifecycle.audit_log", audit_mock):
        result = asyncio.run(
            restore_user_account(
                supabase_url="https://test.supabase.co",
                service_role_key="key",
                caller=_service_caller(),
                target_auth_id="user-1",
                confirmation_email="user@example.com",
            )
        )
    assert result["status"] == "active"
    assert fake.put_calls == [
        ("https://test.supabase.co/auth/v1/admin/users/user-1", {"ban_duration": "none"}),
    ]
    assert fake.patch_calls[0]["account_status"] == "active"
    assert fake.patch_calls[0]["suspended_at"] is None
    # Pre-flight ("attempted", mandatory) + post-hoc ("restored") audit records.
    assert audit_mock.await_count == 2
    events = [call.args[0] for call in audit_mock.call_args_list]
    assert events == ["admin.user_restore_attempted", "admin.user_restored"]
    final_call = audit_mock.call_args_list[-1]
    assert final_call.kwargs["target_id"] == "user-1"
    assert final_call.kwargs["mandatory"] is True
    assert final_call.kwargs["result"] == "success"
    # No raw email anywhere in the call.
    assert "user@example.com" not in repr(audit_mock.call_args_list)


def test_suspend_reactivates_produces_audit_record():
    row = {
        "auth_id": "user-1",
        "email": "user@example.com",
        "userType": "User",
        "account_status": "active",
    }
    fake = _FakeSuspendClient(user_row=row)
    audit_mock = AsyncMock()
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
         patch("app.services.user_account_lifecycle.audit_log", audit_mock):
        result = asyncio.run(
            suspend_user_account(
                supabase_url="https://test.supabase.co",
                service_role_key="key",
                caller=_service_caller(),
                target_auth_id="user-1",
                reason="terms violation",
                confirmation_email="user@example.com",
            )
        )
    assert result["status"] == "suspended"
    assert fake.patch_calls[0]["account_status"] == "suspended"
    assert audit_mock.await_count == 2
    events = [call.args[0] for call in audit_mock.call_args_list]
    assert events == ["admin.user_suspend_attempted", "admin.user_suspended"]
    final_call = audit_mock.call_args_list[-1]
    assert final_call.kwargs["target_id"] == "user-1"
    assert final_call.kwargs["reason_code"] == "suspend"
    assert final_call.args[1]["reason"] == "terms violation"
    assert "user@example.com" not in repr(audit_mock.call_args_list)


def test_suspend_aborts_when_forced_logout_fails():
    """httpx does not raise on a non-2xx response by default (CodeRabbit,
    PR #295) — a failed forced logout must stop the suspend before the
    account status PATCH, not leave the user banned-but-"suspended" with
    still-valid existing sessions and no failure signal."""
    row = {
        "auth_id": "user-1",
        "email": "user@example.com",
        "userType": "User",
        "account_status": "active",
    }
    fake = _FakeSuspendClient(user_row=row, logout_status=500)
    audit_mock = AsyncMock()
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
         patch("app.services.user_account_lifecycle.audit_log", audit_mock):
        with pytest.raises(UserLifecycleError, match="force logout"):
            asyncio.run(
                suspend_user_account(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=_service_caller(),
                    target_auth_id="user-1",
                    reason="terms violation",
                    confirmation_email="user@example.com",
                )
            )

    # The auth ban was already applied, but the account status PATCH must
    # never have been reached.
    assert fake.patch_calls == []
    events = [call.args[0] for call in audit_mock.call_args_list]
    assert events == ["admin.user_suspend_attempted", "admin.user_suspend_attempted"]
    failure_call = audit_mock.call_args_list[-1]
    assert failure_call.kwargs["result"] == "failure"
    assert failure_call.args[1]["auth_ban_applied"] is True
    assert failure_call.args[1]["forced_logout_applied"] is False


def test_restore_rejects_non_suspended_account():
    row = {"auth_id": "user-1", "email": "user@example.com", "account_status": "active"}
    fake = _FakeRestoreClient(user_row=row)
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake):
        with pytest.raises(UserLifecycleError, match="only a suspended account"):
            asyncio.run(
                restore_user_account(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=_service_caller(),
                    target_auth_id="user-1",
                    confirmation_email="user@example.com",
                )
            )


def test_restore_rejects_email_mismatch():
    row = {"auth_id": "user-1", "email": "user@example.com", "account_status": "suspended"}
    fake = _FakeRestoreClient(user_row=row)
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake):
        with pytest.raises(UserLifecycleError, match="confirmation email"):
            asyncio.run(
                restore_user_account(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=_service_caller(),
                    target_auth_id="user-1",
                    confirmation_email="wrong@example.com",
                )
            )


def test_restore_rejects_missing_user():
    fake = _FakeRestoreClient(user_row=None)
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake):
        with pytest.raises(UserLifecycleError, match="not found"):
            asyncio.run(
                restore_user_account(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=_service_caller(),
                    target_auth_id="user-1",
                    confirmation_email="user@example.com",
                )
            )


def test_suspend_aborts_before_destructive_call_when_audit_persistence_fails():
    """Requirement: destructive admin ops must fail safely (not proceed)
    when the mandatory pre-flight audit record cannot be durably persisted."""
    row = {
        "auth_id": "user-1",
        "email": "user@example.com",
        "userType": "User",
        "account_status": "active",
    }
    fake = _FakeSuspendClient(user_row=row)
    audit_mock = AsyncMock(side_effect=AuditPersistenceError("db unavailable"))
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
         patch("app.services.user_account_lifecycle.audit_log", audit_mock):
        with pytest.raises(UserLifecycleError, match="audit trail") as exc_info:
            asyncio.run(
                suspend_user_account(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=_service_caller(),
                    target_auth_id="user-1",
                    reason="terms violation",
                    confirmation_email="user@example.com",
                )
            )
    assert exc_info.value.status_code == 503
    # The auth-suspend (ban) call must never have been made.
    assert fake.put_calls == []
    assert fake.patch_calls == []


def test_execute_delete_aborts_before_destructive_call_when_audit_persistence_fails():
    from app.services import user_account_lifecycle as lifecycle_module

    row = {
        "auth_id": "user-1",
        "email": "user@example.com",
        "userType": "User",
        "account_status": "suspended",
    }
    fake = _FakeSuspendClient(user_row=row)
    caller = _service_caller()
    snapshot_id = "snap-1"
    token = "tok-secret"
    lifecycle_module._DELETE_SNAPSHOTS[snapshot_id] = {
        "token_hash": lifecycle_module._hash_token(token),
        "target_auth_id": "user-1",
        "target_email": "user@example.com",
        "actor": caller.principal,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=900),
        "status": "pending",
    }
    audit_mock = AsyncMock(side_effect=AuditPersistenceError("db unavailable"))
    try:
        with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
             patch("app.services.user_account_lifecycle.audit_log", audit_mock):
            with pytest.raises(UserLifecycleError, match="audit trail") as exc_info:
                asyncio.run(
                    execute_delete_request(
                        supabase_url="https://test.supabase.co",
                        service_role_key="key",
                        caller=caller,
                        snapshot_id=snapshot_id,
                        confirmation_token=token,
                        confirmation_email="user@example.com",
                        idempotency_key="idem-key-001",
                    )
                )
        assert exc_info.value.status_code == 503
        # The auth-delete call must never have been made, and the snapshot
        # must remain unconsumed so a retry (once audit is healthy) can
        # still complete the deletion.
        assert fake.delete_calls == []
        assert lifecycle_module._DELETE_SNAPSHOTS[snapshot_id]["status"] == "pending"
    finally:
        lifecycle_module._DELETE_SNAPSHOTS.pop(snapshot_id, None)


def test_delete_completes_and_produces_no_raw_email_in_audit():
    from app.services import user_account_lifecycle as lifecycle_module

    row = {
        "auth_id": "user-1",
        "email": "user@example.com",
        "userType": "User",
        "account_status": "suspended",
    }
    fake = _FakeSuspendClient(user_row=row)
    caller = _service_caller()
    snapshot_id = "snap-2"
    token = "tok-secret-2"
    lifecycle_module._DELETE_SNAPSHOTS[snapshot_id] = {
        "token_hash": lifecycle_module._hash_token(token),
        "target_auth_id": "user-1",
        "target_email": "user@example.com",
        "actor": caller.principal,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=900),
        "status": "pending",
    }
    audit_mock = AsyncMock()
    try:
        with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake), \
             patch("app.services.user_account_lifecycle.audit_log", audit_mock):
            result = asyncio.run(
                execute_delete_request(
                    supabase_url="https://test.supabase.co",
                    service_role_key="key",
                    caller=caller,
                    snapshot_id=snapshot_id,
                    confirmation_token=token,
                    confirmation_email="user@example.com",
                    idempotency_key="idem-key-002",
                )
            )
        assert result["status"] == "deleted"
        assert fake.delete_calls == ["https://test.supabase.co/auth/v1/admin/users/user-1"]
        assert audit_mock.await_count == 2
        events = [call.args[0] for call in audit_mock.call_args_list]
        assert events == ["admin.user_delete_attempted", "admin.user_deleted"]
        for call in audit_mock.call_args_list:
            assert call.kwargs["mandatory"] is True
            assert call.kwargs["target_id"] == "user-1"
        assert "user@example.com" not in repr(audit_mock.call_args_list)
    finally:
        lifecycle_module._DELETE_SNAPSHOTS.pop(snapshot_id, None)
