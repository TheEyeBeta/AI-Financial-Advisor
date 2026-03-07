"""
Backend authentication middleware.

Validates Supabase JWTs on the backend so that:
1. Only legitimate Supabase-authenticated users can call AI/search endpoints.
2. The `user_id` claim cannot be spoofed by clients — it is extracted from the
   verified JWT, not accepted from the request body.

Design:
- The JWT is signed with the Supabase project JWT secret (shared secret HS256).
- We verify signature + expiry locally — no round-trip to Supabase on every request.
- Optional: fall back to Supabase REST validation when local secret is unavailable.
"""
from __future__ import annotations

import os
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

SUPABASE_JWT_SECRET_ENV = "SUPABASE_JWT_SECRET"
# Set AUTH_REQUIRED=false ONLY for local dev without Supabase.
# NEVER set this to false in production.
AUTH_REQUIRED_ENV = "AUTH_REQUIRED"


def _auth_required() -> bool:
    """Return True unless explicitly disabled (dev mode only)."""
    val = os.getenv(AUTH_REQUIRED_ENV, "true").strip().lower()
    return val not in ("false", "0", "no")


def _get_jwt_secret() -> Optional[str]:
    return os.getenv(SUPABASE_JWT_SECRET_ENV) or None


# ── Token extraction ───────────────────────────────────────────────────────────

def _extract_bearer_token(request: Request) -> Optional[str]:
    """Pull the raw JWT string from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        return token if token else None
    return None


# ── JWT validation ─────────────────────────────────────────────────────────────

def _verify_jwt_with_secret(token: str, secret: str) -> dict:
    """
    Verify a Supabase JWT locally using the project JWT secret.
    Raises HTTPException(401) on any failure.
    """
    try:
        import jwt as pyjwt  # PyJWT
        payload = pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "exp", "iat", "role"]},
        )
        return payload
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="JWT validation library not installed. Install PyJWT.",
        )
    except Exception as exc:
        logger.warning("JWT validation failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        ) from exc


def _verify_jwt_via_supabase_rest(token: str) -> dict:
    """
    Validate a JWT by calling Supabase's /auth/v1/user endpoint.
    Used as fallback when the JWT secret is not configured locally.
    This is slower (network call) but correct.
    """
    import httpx

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")

    if not supabase_url or not supabase_anon_key:
        raise HTTPException(
            status_code=500,
            detail="Auth configuration missing: SUPABASE_URL and SUPABASE_ANON_KEY required.",
        )

    try:
        resp = httpx.get(
            f"{supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": supabase_anon_key,
            },
            timeout=5.0,
        )
    except httpx.RequestError as exc:
        logger.error("Supabase auth validation network error: %s", exc)
        raise HTTPException(status_code=503, detail="Authentication service unavailable.") from exc

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token.")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Authentication validation failed.")

    user_data = resp.json()
    # Normalize to a payload shape that includes `sub`
    return {"sub": user_data.get("id"), "email": user_data.get("email")}


# ── FastAPI dependency ─────────────────────────────────────────────────────────

class AuthenticatedUser:
    """Holds the verified auth_id (UUID string) of the authenticated user."""

    def __init__(self, auth_id: str, email: Optional[str] = None):
        self.auth_id = auth_id
        self.email = email

    def __repr__(self) -> str:
        return f"AuthenticatedUser(auth_id={self.auth_id!r})"


async def require_auth(request: Request) -> AuthenticatedUser:
    """
    FastAPI dependency — validates the bearer JWT and returns the authenticated user.

    Usage:
        @router.post("/api/chat")
        async def chat(user: AuthenticatedUser = Depends(require_auth)):
            ...

    The verified `user.auth_id` is the Supabase auth UUID.
    Do NOT trust `user_id` fields in request bodies — use `user.auth_id` instead.
    """
    if not _auth_required():
        # Dev-mode bypass — return a placeholder user so the app still works locally.
        logger.warning(
            "AUTH_REQUIRED=false — authentication is DISABLED. "
            "This must never be set in production."
        )
        return AuthenticatedUser(auth_id="dev-mode-bypass")

    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing authentication token. Include 'Authorization: Bearer <token>' header.",
        )

    jwt_secret = _get_jwt_secret()
    if jwt_secret:
        payload = _verify_jwt_with_secret(token, jwt_secret)
        auth_id = payload.get("sub")
        email = payload.get("email")
    else:
        # Fallback: validate via Supabase REST (slower, but works without the secret)
        logger.warning(
            "SUPABASE_JWT_SECRET not set — falling back to Supabase REST validation. "
            "Set this env var for better performance and to avoid a network hop per request."
        )
        payload = _verify_jwt_via_supabase_rest(token)
        auth_id = payload.get("sub")
        email = payload.get("email")

    if not auth_id:
        raise HTTPException(status_code=401, detail="Authentication token missing subject claim.")

    return AuthenticatedUser(auth_id=str(auth_id), email=email)


async def optional_auth(request: Request) -> Optional[AuthenticatedUser]:
    """
    Like require_auth but returns None instead of raising 401.
    Use for endpoints that are accessible to anonymous users but
    track rate limits differently for authenticated ones.
    """
    try:
        return await require_auth(request)
    except HTTPException:
        return None
