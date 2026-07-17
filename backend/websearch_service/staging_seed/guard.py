"""Production-refusal guard.

Every mutating entry point (seed / cleanup / reset) MUST call
``assert_safe_to_mutate`` before touching the database. Read-only entry
points (preflight / verify) call the lighter ``assert_safe_to_inspect``,
which still refuses a suspected-production target but does not require
``ALLOW_SYNTHETIC_SEED`` since it never writes.
"""

from __future__ import annotations

from urllib.parse import urlparse

from .config import SeedConfig


class SeedGuardError(RuntimeError):
    """Raised when it is not safe to run against the configured target."""


def project_ref_from_url(supabase_url: str) -> str | None:
    """Extract the Supabase project ref (subdomain) from a project URL."""
    if not supabase_url:
        return None
    try:
        host = urlparse(supabase_url).hostname
    except ValueError:
        return None
    if not host:
        return None
    if host.endswith(".supabase.co"):
        return host[: -len(".supabase.co")]
    # Self-hosted / custom-domain Supabase: fall back to the full hostname
    # so a denylist entry can still match it.
    return host


def hostname_from_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return urlparse(url).hostname
    except ValueError:
        return None


def _denylist_hits(config: SeedConfig) -> list[str]:
    if not config.production_denylist:
        return []

    candidates = {
        c.strip().lower()
        for c in (
            project_ref_from_url(config.supabase_url),
            hostname_from_url(config.supabase_url),
            hostname_from_url(config.database_url),
        )
        if c
    }
    return sorted(candidates & set(config.production_denylist))


def assert_safe_to_inspect(config: SeedConfig) -> None:
    """Refuse even read-only identity inspection against a denylisted target."""
    if config.is_production:
        raise SeedGuardError(
            "Refusing: ENVIRONMENT=production. This toolkit only inspects "
            "or seeds non-production environments."
        )

    hits = _denylist_hits(config)
    if hits:
        raise SeedGuardError(
            "Refusing: target matches the production denylist "
            f"({len(hits)} identifier(s) matched)."
        )


def assert_safe_to_mutate(config: SeedConfig) -> None:
    """Refuse to seed/cleanup/reset unless every safety gate passes.

    Gates, all of which must pass:
      1. ENVIRONMENT is not "production".
      2. The Supabase project ref / hostname is not on the production denylist.
      3. ALLOW_SYNTHETIC_SEED=true was explicitly set.
    """
    assert_safe_to_inspect(config)

    if not config.allow_synthetic_seed:
        raise SeedGuardError(
            "Refusing: ALLOW_SYNTHETIC_SEED=true was not set. This is a "
            "required, explicit opt-in for any command that writes synthetic "
            "data."
        )

    if not config.supabase_url or not config.supabase_service_role_key:
        raise SeedGuardError(
            "Refusing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required "
            "to seed via the Supabase Auth Admin API."
        )

    if not config.database_url:
        raise SeedGuardError(
            "Refusing: ALEMBIC_DATABASE_URL, DATABASE_URL, or SUPABASE_DB_URL "
            "must be set to the staging database."
        )
