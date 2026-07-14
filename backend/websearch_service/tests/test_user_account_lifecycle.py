"""Tests for admin user lifecycle safeguards."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest

from app.services.user_account_lifecycle import (
    AdminCaller,
    UserLifecycleError,
    enforce_recent_authentication,
    restore_user_account,
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
        self.patch_calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, **kw):
        return _FakeResp(200, [self._user_row] if self._user_row else [])

    async def put(self, url, **kw):
        return _FakeResp(self._unban_status, {})

    async def patch(self, url, **kw):
        self.patch_calls.append(kw.get("json", {}))
        return _FakeResp(self._patch_status)


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
    with patch("app.services.user_account_lifecycle.httpx.AsyncClient", return_value=fake):
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
    assert fake.patch_calls[0]["account_status"] == "active"
    assert fake.patch_calls[0]["suspended_at"] is None


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
