"""Thin wrapper around the Supabase Auth Admin API for synthetic users.

Isolated in its own module so tests can mock ``AuthAdminClient`` without
importing the real ``supabase`` SDK or touching a network socket.

Admin ``create_user``/``delete_user`` calls never send email or SMS —
that only happens via ``signUp``, ``inviteUserByEmail``, or
``resetPasswordForEmail``, none of which this module calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger("staging_seed.auth_client")

_ALREADY_REGISTERED_MARKERS = (
    "already been registered",
    "already registered",
    "already exists",
    "email_exists",
)


@dataclass(frozen=True)
class CreatedAuthUser:
    auth_id: str
    email: str
    created: bool  # False if it already existed and we resolved its id instead


class AuthAdminClient:
    """Wraps ``supabase.auth.admin`` for the seeder's narrow needs."""

    def __init__(self, supabase_url: str, service_role_key: str) -> None:
        from supabase import create_client  # local import: keep module importable without the SDK

        self._client = create_client(supabase_url, service_role_key)

    def create_user(self, *, email: str, first_name: str, last_name: str) -> CreatedAuthUser:
        try:
            response = self._client.auth.admin.create_user(
                {
                    "email": email,
                    "email_confirm": True,
                    "user_metadata": {
                        "first_name": first_name,
                        "last_name": last_name,
                        "synthetic_seed": True,
                    },
                }
            )
            user = getattr(response, "user", None) or response
            auth_id = getattr(user, "id", None) or user["id"]
            return CreatedAuthUser(auth_id=str(auth_id), email=email, created=True)
        except Exception as exc:  # noqa: BLE001 - SDK exception types vary by version
            message = str(exc).lower()
            if any(marker in message for marker in _ALREADY_REGISTERED_MARKERS):
                logger.info("Synthetic auth user %s already exists; skipping creation", email)
                raise LookupError(f"already exists: {email}") from exc
            raise

    def delete_user(self, auth_id: str) -> None:
        try:
            self._client.auth.admin.delete_user(auth_id)
        except Exception as exc:  # noqa: BLE001
            message = str(exc).lower()
            if "not found" in message or "user_not_found" in message:
                return
            raise
