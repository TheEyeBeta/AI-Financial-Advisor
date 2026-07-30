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
- SEC-B2-04: each verification path only accepts algorithms from its own
  explicit allowlist (SUPABASE_JWT_HS_ALGORITHMS / SUPABASE_JWT_ASYMMETRIC_ALGORITHMS,
  default HS256 / ES256,RS256). The allowlist is enforced both at dispatch
  (which path to use) and inside each path itself, so an HMAC-family token
  can never be verified via JWKS key material and vice versa.
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
# Real UUID for dev-bypass so Meridian cache reads work locally (never used in production).
DEV_BYPASS_USER_ID = "43245b18-2feb-49a4-9958-44fa5c17881e"
# Superset of algorithms this codebase knows how to route (symmetric vs
# asymmetric verification path). These are NOT the accepted allowlist by
# themselves — see SUPABASE_JWT_HS_ALGORITHMS_ENV / _ASYMMETRIC_ below
# (SEC-B2-04). "none" is deliberately absent from both sets.
HMAC_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})
ASYMMETRIC_JWT_ALGORITHMS = frozenset({"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EDDSA"})

# SEC-B2-04: explicit, narrow algorithm allowlists, independent of the
# broader "known algorithm families" sets above. Each verification path only
# ever accepts algorithms configured here, closing the algorithm-confusion
# hardening gap (a declared alg picks the verification path, but the path
# itself now also refuses to run with an algorithm outside its allowlist).
SUPABASE_JWT_HS_ALGORITHMS_ENV = "SUPABASE_JWT_HS_ALGORITHMS"
SUPABASE_JWT_ASYMMETRIC_ALGORITHMS_ENV = "SUPABASE_JWT_ASYMMETRIC_ALGORITHMS"
_DEFAULT_HS_ALGORITHMS = "HS256"
_DEFAULT_ASYMMETRIC_ALGORITHMS = "ES256,RS256"


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


def _parse_algorithm_allowlist(
    env_name: str, default: str, allowed_superset: frozenset[str]
) -> frozenset[str]:
    """Parse a comma-separated algorithm allowlist env var.

    Configured values must be a subset of ``allowed_superset`` (the families
    this module knows how to verify) — this prevents an operator from
    accidentally configuring ``none`` or an algorithm with no verification
    path at all. Raises at call time (not import time) so misconfiguration
    surfaces as a clear 500/FATAL rather than a silent bypass.
    """
    raw = _trimmed_env(env_name) or default
    configured = frozenset(a.strip().upper() for a in raw.split(",") if a.strip())
    if not configured:
        raise RuntimeError(f"FATAL: {env_name} must not be empty.")
    invalid = configured - allowed_superset
    if invalid:
        raise RuntimeError(
            f"FATAL: {env_name} contains unsupported algorithm(s) {sorted(invalid)}. "
            f"Allowed values: {sorted(allowed_superset)}."
        )
    return configured


def _allowed_hs_algorithms() -> frozenset[str]:
    return _parse_algorithm_allowlist(
        SUPABASE_JWT_HS_ALGORITHMS_ENV, _DEFAULT_HS_ALGORITHMS, HMAC_JWT_ALGORITHMS
    )


def _allowed_asymmetric_algorithms() -> frozenset[str]:
    return _parse_algorithm_allowlist(
        SUPABASE_JWT_ASYMMETRIC_ALGORITHMS_ENV,
        _DEFAULT_ASYMMETRIC_ALGORITHMS,
        ASYMMETRIC_JWT_ALGORITHMS,
    )


# ── Token extraction ───────────────────────────────────────────────────────────

def _extract_bearer_token(request: Request) -> Optional[str]:
    """Pull the raw JWT string from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        return token if token else None
    return None


def _extract_websocket_token(websocket: WebSocket) -> Optional[str]:
    """Pull a JWT from the websocket Authorization header.

    SECURITY (#205): bearer JWTs are no longer accepted via ``?token=`` /
    ``?access_token=`` query parameters — URLs leak into proxy logs, browser
    history, and monitoring. Browser clients use single-use tickets instead
    (see ``app/services/ws_tickets.py``).
    """
    auth_header = websocket.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        return token if token else None
    return None


def _extract_websocket_ticket(websocket: WebSocket) -> Optional[str]:
    """Pull a single-use connection ticket from the websocket query string."""
    ticket = (websocket.query_params.get("ticket") or "").strip()
    return ticket or None


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


def _get_expected_issuer() -> Optional[str]:
    """Return the expected JWT issuer derived from SUPABASE_URL, or None if not set."""
    url = get_backend_supabase_url()
    if not url:
        return None
    return f"{url.rstrip('/')}/auth/v1"


def _verify_issuer(payload: dict) -> None:
    """Reject tokens whose iss claim doesn't match the configured Supabase project."""
    expected = _get_expected_issuer()
    if not expected:
        return
    iss = payload.get("iss")
    if not iss or iss.rstrip("/") != expected.rstrip("/"):
        logger.warning("JWT issuer mismatch: got=%r expected=%r", iss, expected)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )


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
    if algorithm.upper() not in _allowed_hs_algorithms():
        # SEC-B2-04: refuse even if a caller (or a future refactor) routes an
        # asymmetric-family or unconfigured algorithm into the symmetric
        # path — never let the HMAC secret be used to "verify" a signature
        # produced under a different algorithm.
        logger.warning(
            "Rejected JWT: alg=%r is not in the configured HMAC allowlist", algorithm
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )
    try:
        import jwt as pyjwt  # PyJWT
        payload = pyjwt.decode(
            token,
            secret,
            algorithms=[algorithm],
            options={"require": list(required_claims), "verify_aud": False},
        )
        _verify_issuer(payload)
        return payload
    except HTTPException:
        raise
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
    if algorithm.upper() not in _allowed_asymmetric_algorithms():
        # SEC-B2-04: refuse even if a caller routes an HMAC or unconfigured
        # algorithm into the JWKS path — a JWKS public key must never be
        # used as an HMAC secret (classic RS/ES→HS confusion attack).
        logger.warning(
            "Rejected JWT: alg=%r is not in the configured asymmetric allowlist", algorithm
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )
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
        payload = pyjwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            options={"require": list(required_claims), "verify_aud": False},
        )
        _verify_issuer(payload)
        return payload
    except HTTPException:
        raise
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
    required_role: Optional[str] = None,
) -> dict:
    """
    Verify a Supabase JWT using the correct strategy for its declared algorithm.

    - HS* tokens: verify with SUPABASE_JWT_SECRET when available.
    - RS*/ES*/EdDSA tokens: verify against Supabase JWKS.
    - User tokens may fall back to Supabase REST validation when a symmetric
      secret is not configured locally or when JWKS retrieval is temporarily
      unavailable.

    SEC-B2-05: when ``required_role`` is set, the verified payload's ``role``
    claim must equal it EXACTLY (no case-folding) or the token is rejected
    with 401. This is what stops an otherwise-validly-signed anon/service_role/
    unknown-role token from reaching an endpoint that expects an authenticated
    user — presence of a ``role`` claim was already enforced via
    ``required_claims``, but its VALUE was never checked. The REST-fallback
    path (``_verify_jwt_via_supabase_rest``) doesn't return a ``role`` claim,
    so when ``required_role`` is set and verification falls back to it, the
    request is rejected rather than trusted blindly — fail closed on
    ambiguity rather than silently skip the role check.
    """
    payload = _dispatch_jwt_verification(
        token,
        required_claims=required_claims,
        allow_rest_fallback=allow_rest_fallback,
    )
    if required_role is not None and payload.get("role") != required_role:
        logger.warning(
            "Rejected JWT: role=%r does not match required role %r.",
            payload.get("role"), required_role,
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )
    return payload


def _dispatch_jwt_verification(
    token: str,
    *,
    required_claims: Sequence[str],
    allow_rest_fallback: bool,
) -> dict:
    """Route JWT verification to the correct strategy for its declared algorithm."""
    algorithm = _jwt_algorithm(token)
    normalized_algorithm = algorithm.upper()
    hs_allowed = _allowed_hs_algorithms()
    asymmetric_allowed = _allowed_asymmetric_algorithms()

    if normalized_algorithm in hs_allowed:
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

    if normalized_algorithm in asymmetric_allowed:
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

    logger.warning(
        "Rejected JWT: alg=%r not in configured allowlist (hs=%s asymmetric=%s)",
        algorithm, sorted(hs_allowed), sorted(asymmetric_allowed),
    )
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
        # Dev-mode bypass — return a real UUID so Meridian cache reads work locally.
        logger.warning(
            "AUTH_REQUIRED=false — authentication is DISABLED. "
            "This must never be set in production."
        )
        return AuthenticatedUser(auth_id=DEV_BYPASS_USER_ID)

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
        required_role="authenticated",
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


# WebSocket close codes (4000-4999 are application-defined).
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_FORBIDDEN_ORIGIN = 4403


def validate_websocket_origin(websocket: WebSocket) -> None:
    """
    Reject browser websocket handshakes from unapproved origins (#205).

    Browsers always send an ``Origin`` header on WebSocket handshakes; when
    present it must match the CORS allowlist. Handshakes without an Origin
    header come from non-browser clients, which cannot be victims of
    cross-site WebSocket hijacking, so they pass this check and still must
    authenticate.
    """
    origin = (websocket.headers.get("Origin") or "").strip()
    if not origin:
        return

    from ..config import resolve_allowed_origins

    allowed = resolve_allowed_origins()
    if origin.rstrip("/") not in {o.rstrip("/") for o in allowed}:
        logger.warning("WebSocket handshake rejected: origin %r not in allowlist", origin)
        raise HTTPException(status_code=403, detail="Origin not allowed.")


async def require_websocket_auth(
    websocket: WebSocket,
    *,
    endpoint: str = "/ws/live",
) -> AuthenticatedUser:
    """
    Validate websocket auth for browsers and API clients (#205).

    Accepted credentials, in order:
    1. ``Authorization: Bearer <jwt>`` header (non-browser clients).
    2. ``?ticket=<single-use ticket>`` issued by ``POST /api/v1/ws/ticket``
       over authenticated HTTPS. Tickets are short-lived, bound to the user
       and endpoint, and consumed atomically — replay or expiry fails.

    Supabase JWTs in ``?token=`` / ``?access_token=`` query parameters are no
    longer accepted. The Origin header, when present, must match the CORS
    allowlist (raises 403; callers close with WS_CLOSE_FORBIDDEN_ORIGIN).
    """
    validate_websocket_origin(websocket)

    if not _auth_required():
        logger.warning(
            "AUTH_REQUIRED=false — websocket authentication is DISABLED. "
            "This must never be set in production."
        )
        return AuthenticatedUser(auth_id=DEV_BYPASS_USER_ID)

    token = _extract_websocket_token(websocket)
    if token:
        payload = _verify_supabase_jwt(
            token,
            required_claims=("sub", "exp", "iat", "role"),
            allow_rest_fallback=True,
            required_role="authenticated",
        )
        auth_id = payload.get("sub")
        if not auth_id:
            raise HTTPException(status_code=401, detail="Authentication token missing subject claim.")
        return AuthenticatedUser(auth_id=str(auth_id), email=payload.get("email"))

    ticket = _extract_websocket_ticket(websocket)
    if ticket:
        from .ws_tickets import get_ws_ticket_store

        claims = get_ws_ticket_store().consume(ticket, endpoint=endpoint)
        if claims is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid, expired, or already-used websocket ticket.",
            )
        return AuthenticatedUser(auth_id=claims.user_id, email=claims.email)

    raise HTTPException(
        status_code=401,
        detail=(
            "Missing websocket credentials. Obtain a single-use ticket from "
            "POST /api/v1/ws/ticket and connect with ?ticket=<ticket>."
        ),
    )


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
