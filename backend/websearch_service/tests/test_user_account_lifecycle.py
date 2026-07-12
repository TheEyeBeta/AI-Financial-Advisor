"""Tests for admin user lifecycle safeguards."""

from __future__ import annotations

import time

import pytest

from app.services.user_account_lifecycle import (
    AdminCaller,
    UserLifecycleError,
    enforce_recent_authentication,
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
