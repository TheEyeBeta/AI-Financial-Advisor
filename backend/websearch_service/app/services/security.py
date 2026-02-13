from __future__ import annotations

import os

from fastapi import Header, HTTPException


API_AUTH_TOKEN_ENV = "AI_PROXY_API_KEY"
ENVIRONMENT_ENV = "ENVIRONMENT"


def _is_development_env() -> bool:
    return os.getenv(ENVIRONMENT_ENV, "development").lower() in {"dev", "development", "local", "test"}


async def require_api_key(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> None:
    """Require API key auth for AI/search endpoints.

    Behavior:
    - If AI_PROXY_API_KEY is configured, requests must send either:
      - `x-api-key: <token>` OR
      - `authorization: Bearer <token>`
    - If token is not configured, only development/test environments are allowed.
    """
    configured_token = os.getenv(API_AUTH_TOKEN_ENV)

    if not configured_token:
        if _is_development_env():
            return
        raise HTTPException(
            status_code=500,
            detail=(
                f"{API_AUTH_TOKEN_ENV} is not configured. "
                "Set an API token for protected endpoints in non-development environments."
            ),
        )

    bearer_token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()

    provided_token = x_api_key or bearer_token
    if provided_token != configured_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
