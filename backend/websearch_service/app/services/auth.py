"""
Backend authentication middleware.

Validates Supabase JWTs on the backend so that:
1. Only legitimate Supabase-authenticated users can call AI/search endpoints.
2. The `user_id` claim cannot be spoofed by clients — it is extracted from the
   verified JWT, not accepted from the request body.

Design:
- Legacy projects may still use symmetric HS* JWTs signed with the project's
  JWT secret.
- Modern Supabase projects can issue asymmetric RS*/ES* JWTs verified via the
  project's JWKS endpoint.
- Optional: user-token auth can fall back to Supabase REST validation when a
  local symmetric secret is unavailable.
"""
from __future__ import annotations

from functools import lru_cache
import os
import logging
from typing import Optional, Sequence

from fastapi import Depends, HTTPException, Request, WebSocket

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

SUPABASE_JWT_SECRET_ENV = "SUPABASE_JWT_SECRET"
SUPABASE_URL_ENV = "SUPABASE_URL"
SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"
SUPABASE_ANON_KEY_ENV = "SUPABASE_ANON_KEY"
# Set AUTH_REQUIRED=false ONLY for local dev without Supabase.
# NEVER set this to false in production.
AUTH_REQUIRED_ENV = "AUTH_REQUIRED"
ENVIRONMENT_ENV = "ENVIRONMENT"
PRODUCTION_ENV = "production"
HMAC_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})
ASYMMETRIC_JWT_ALGORITHMS = frozenset({"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EDDSA"})


def _environment() -> str:
    return (os.getenv(ENVIRONMENT_ENV, "development").strip().lower() or "development")


def _is_production() -> bool:
    return _environment() == PRODUCTION_ENV


def _trimmed_env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _get_backend_env(primary_name: str, legacy_name: str) -> str:
    value = _trimmed_env(primary_name)
    if value:
        return value

    if not _is_production():
        legacy_value = _trimmed_env(legacy_name)
        if legacy_value:
            logger.warning(
                "Using %s on the backend in %s mode. Set %s instead.",
                legacy_name,
                _environment(),
                primary_name,
            )
            return legacy_value

    return ""


def get_backend_supabase_url() -> str:
    return _get_backend_env(SUPABASE_URL_ENV, "VITE_SUPABASE_URL")


def get_backend_service_role_key() -> str:
    return _get_backend_env(SUPABASE_SERVICE_ROLE_KEY_ENV, "VITE_SUPABASE_SERVICE_ROLE_KEY")


def get_backend_anon_key() -> str:
    return _get_backend_env(SUPABASE_ANON_KEY_ENV, "VITE_SUPABASE_ANON_KEY")


def validate_auth_configuration() -> None:
    auth_required = os.getenv(AUTH_REQUIRED_ENV, "true").strip().lower()
    if _is_production() and auth_required in ("false", "0", "no"):
        raise RuntimeError(
            "FATAL: AUTH_REQUIRED=false is not allowed when ENVIRONMENT=production. "
            "Production authentication is always enforced."
        )
    if _is_production() and _trimmed_env("VITE_SUPABASE_SERVICE_ROLE_KEY"):
        raise RuntimeError(
            "FATAL: VITE_SUPABASE_SERVICE_ROLE_KEY must not be configured on the backend in production. "
            "Use SUPABASE_SERVICE_ROLE_KEY instead."
        )


def _auth_required() -> bool:
    """Return True unless explicitly disabled (dev mode only)."""
    if _is_production():
        return True

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


def _extract_websocket_token(websocket: WebSocket) -> Optional[str]:
    """Pull a JWT from websocket headers or query params."""
    auth_header = websocket.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        return token if token else None

    for key in ("token", "access_token"):
        token = (websocket.query_params.get(key) or "").strip()
        if token:
            return token

    return None


# ── JWT validation ─────────────────────────────────────────────────────────────

def _get_unverified_jwt_header(token: str) -> dict:
    """Read the JWT header without verifying the signature."""
    try:
        import jwt as pyjwt  # PyJWT
        header = pyjwt.get_unverified_header(token)
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="JWT validation library not installed. Install PyJWT.",
        )
    except Exception as exc:
        logger.warning("JWT header parsing failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        ) from exc

    if not isinstance(header, dict):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )

    return header


def _jwt_algorithm(token: str) -> str:
    """Extract the declared JWT algorithm from the token header."""
    algorithm = _get_unverified_jwt_header(token).get("alg")
    if not isinstance(algorithm, str) or not algorithm.strip():
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )
    return algorithm.strip()


def _verify_jwt_with_secret(
    token: str,
    secret: str,
    algorithm: str,
    *,
    required_claims: Sequence[str],
) -> dict:
    """
    Verify a symmetric Supabase JWT locally using the project JWT secret.
    Raises HTTPException(401) on any failure.
    """
    try:
        import jwt as pyjwt  # PyJWT
        payload = pyjwt.decode(
            token,
            secret,
            algorithms=[algorithm],
            options={"require": list(required_claims), "verify_aud": False},
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


@lru_cache(maxsize=4)
def _jwks_client(jwks_url: str):
    """Return a cached PyJWT JWKS client for the given Supabase project."""
    try:
        import jwt as pyjwt  # PyJWT
        return pyjwt.PyJWKClient(jwks_url)
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="JWT validation library not installed. Install PyJWT and cryptography.",
        )


def _verify_jwt_with_supabase_jwks(
    token: str,
    algorithm: str,
    *,
    required_claims: Sequence[str],
) -> dict:
    """
    Verify an asymmetric Supabase JWT against the project's JWKS endpoint.
    """
    try:
        import jwt as pyjwt  # PyJWT
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="JWT validation library not installed. Install PyJWT and cryptography.",
        )

    supabase_url = get_backend_supabase_url()
    if not supabase_url:
        raise HTTPException(
            status_code=500,
            detail="Auth configuration missing: SUPABASE_URL required for asymmetric JWT verification.",
        )

    jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token)
        return pyjwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            options={"require": list(required_claims), "verify_aud": False},
        )
    except Exception as exc:
        exc_name = type(exc).__name__
        if exc_name == "PyJWKClientConnectionError":
            logger.error("Supabase JWKS fetch failed: %s", exc)
            raise HTTPException(status_code=503, detail="Authentication service unavailable.") from exc
        if exc_name == "InvalidAlgorithmError":
            raise HTTPException(
                status_code=500,
                detail="Asymmetric JWT validation requires PyJWT crypto support. Install cryptography.",
            ) from exc

        logger.warning("JWT JWKS validation failed: %s", exc_name)
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

    supabase_url = get_backend_supabase_url()
    supabase_anon_key = get_backend_anon_key()

    if not supabase_url or not supabase_anon_key:
        raise HTTPException(
            status_code=500,
            detail="Auth configuration missing: SUPABASE_URL and SUPABASE_ANON_KEY required.",
        )

    # Strip the token to remove any trailing whitespace/newlines that would
    # cause httpx to reject the header value as "Illegal header value".
    clean_token = token.strip()

    try:
        resp = httpx.get(
            f"{supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {clean_token}",
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


def _verify_supabase_jwt(
    token: str,
    *,
    required_claims: Sequence[str],
    allow_rest_fallback: bool,
) -> dict:
    """
    Verify a Supabase JWT using the correct strategy for its declared algorithm.

    - HS* tokens: verify with SUPABASE_JWT_SECRET when available.
    - RS*/ES*/EdDSA tokens: verify against Supabase JWKS.
    - User tokens may fall back to Supabase REST validation when a symmetric
      secret is not configured locally or when JWKS retrieval is temporarily
      unavailable.
    """
    algorithm = _jwt_algorithm(token)
    normalized_algorithm = algorithm.upper()

    if normalized_algorithm in HMAC_JWT_ALGORITHMS:
        jwt_secret = _get_jwt_secret()
        if jwt_secret:
            return _verify_jwt_with_secret(
                token,
                jwt_secret,
                algorithm,
                required_claims=required_claims,
            )
        if allow_rest_fallback:
            logger.warning(
                "SUPABASE_JWT_SECRET not set for %s token — falling back to Supabase REST validation. "
                "Set this env var for better performance and to avoid a network hop per request.",
                algorithm,
            )
            return _verify_jwt_via_supabase_rest(token)
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_JWT_SECRET is not configured on the backend. Cannot verify symmetric JWTs.",
        )

    if normalized_algorithm in ASYMMETRIC_JWT_ALGORITHMS:
        try:
            return _verify_jwt_with_supabase_jwks(
                token,
                algorithm,
                required_claims=required_claims,
            )
        except HTTPException as exc:
            if allow_rest_fallback and exc.status_code == 503:
                logger.warning(
                    "Supabase JWKS validation unavailable for %s token — "
                    "falling back to Supabase REST validation.",
                    algorithm,
                )
                return _verify_jwt_via_supabase_rest(token)
            raise

    logger.warning("Unsupported JWT algorithm: %s", algorithm)
    raise HTTPException(
        status_code=401,
        detail="Invalid or expired authentication token.",
    )


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

    payload = _verify_supabase_jwt(
        token,
        required_claims=("sub", "exp", "iat", "role"),
        allow_rest_fallback=True,
    )
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


async def require_websocket_auth(websocket: WebSocket) -> AuthenticatedUser:
    """
    Validate websocket auth using the same Supabase JWT rules as HTTP endpoints.

    Browsers cannot set arbitrary websocket Authorization headers reliably, so
    a bearer token may also be supplied as ``?token=...`` or
    ``?access_token=...`` on the websocket URL.
    """
    if not _auth_required():
        logger.warning(
            "AUTH_REQUIRED=false — websocket authentication is DISABLED. "
            "This must never be set in production."
        )
        return AuthenticatedUser(auth_id="dev-mode-bypass")

    token = _extract_websocket_token(websocket)
    if not token:
        raise HTTPException(status_code=401, detail="Missing websocket authentication token.")

    payload = _verify_supabase_jwt(
        token,
        required_claims=("sub", "exp", "iat", "role"),
        allow_rest_fallback=True,
    )
    auth_id = payload.get("sub")
    email = payload.get("email")

    if not auth_id:
        raise HTTPException(status_code=401, detail="Authentication token missing subject claim.")

    return AuthenticatedUser(auth_id=str(auth_id), email=email)


# ── Service-role JWT dependency (replaces static X-Admin-Key) ─────────────────

async def verify_service_role(request: Request) -> dict:
    """
    FastAPI dependency — validates a Supabase service-role JWT.

    This replaces the old static X-Admin-Key authentication for admin/automated
    endpoints.  The caller must present a JWT (``Authorization: Bearer <token>``)
    signed with the project's JWT secret whose ``role`` claim is
    ``service_role``.

    Returns the full decoded JWT payload on success.
    Raises ``HTTPException(401/403)`` on failure.
    """
    if not _auth_required():
        logger.warning(
            "AUTH_REQUIRED=false — service-role verification is DISABLED. "
            "This must never be set in production."
        )
        return {"sub": "dev-mode-bypass", "role": "service_role"}

    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing authentication token. Include 'Authorization: Bearer <service-role-jwt>' header.",
        )

    try:
        payload = _verify_supabase_jwt(
            token,
            required_claims=("role", "iat"),
            allow_rest_fallback=False,
        )
    except HTTPException as exc:
        if exc.status_code == 401:
            logger.warning("Service-role JWT validation failed: %s", exc.detail)
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired service-role token.",
            ) from exc
        raise

    role = payload.get("role")
    if role != "service_role":
        logger.warning("JWT role=%s is not service_role — access denied.", role)
        raise HTTPException(
            status_code=403,
            detail="This endpoint requires a service_role JWT.",
        )

    return payload
