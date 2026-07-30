"""Environment-derived configuration for the staging seeder.

Every value here comes from environment variables already used elsewhere in
this backend (``ENVIRONMENT``, ``SUPABASE_URL``, ``SUPABASE_SERVICE_ROLE_KEY``,
``ALEMBIC_DATABASE_URL`` / ``DATABASE_URL`` / ``SUPABASE_DB_URL``) plus a
small set of seeder-specific flags. Nothing here invents a new secret name —
it reuses the app's existing env var vocabulary.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

TRUTHY_VALUES = {"1", "true", "yes", "on"}


def is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in TRUTHY_VALUES


def _parse_csv(value: str | None) -> list[str]:
    return [item.strip().lower() for item in (value or "").split(",") if item.strip()]


@dataclass(frozen=True)
class SeedConfig:
    environment: str
    allow_synthetic_seed: bool
    supabase_url: str
    supabase_service_role_key: str
    database_url: str | None
    production_denylist: list[str] = field(default_factory=list)
    random_seed: int = 424242
    user_count: int = 200

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


def load_config() -> SeedConfig:
    environment = (os.getenv("ENVIRONMENT", "development").strip().lower() or "development")

    database_url = (
        os.getenv("ALEMBIC_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("SUPABASE_DB_URL")
    )

    seed_raw = os.getenv("STAGING_SEED_RANDOM_SEED", "424242").strip()
    try:
        random_seed = int(seed_raw)
    except ValueError:
        random_seed = 424242

    count_raw = os.getenv("STAGING_SEED_USER_COUNT", "200").strip()
    try:
        user_count = int(count_raw)
    except ValueError:
        user_count = 200
    user_count = max(user_count, 200)

    return SeedConfig(
        environment=environment,
        allow_synthetic_seed=is_truthy(os.getenv("ALLOW_SYNTHETIC_SEED")),
        supabase_url=(os.getenv("SUPABASE_URL") or "").strip(),
        supabase_service_role_key=(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip(),
        database_url=database_url,
        production_denylist=_parse_csv(os.getenv("STAGING_SEED_PRODUCTION_DENYLIST")),
        random_seed=random_seed,
        user_count=user_count,
    )
