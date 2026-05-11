from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, engine_from_config, inspect, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


RUNTIME_SCHEMAS = (
    "public",
    "auth",
    "core",
    "ai",
    "trading",
    "market",
    "academy",
    "meridian",
)


def _normalise_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg" not in url and "+psycopg2" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _resolve_database_url() -> str:
    configured = config.get_main_option("sqlalchemy.url")
    candidate = (
        configured
        or os.getenv("ALEMBIC_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("SUPABASE_DB_URL")
    )
    if not candidate:
        raise RuntimeError(
            "Alembic requires ALEMBIC_DATABASE_URL, DATABASE_URL, or SUPABASE_DB_URL."
        )
    return _normalise_database_url(candidate)


config.set_main_option("sqlalchemy.url", _resolve_database_url())


def include_name(name: str | None, type_: str, parent_names: dict[str, str]) -> bool:
    if type_ == "schema":
        return bool(name in RUNTIME_SCHEMAS)

    schema_name = parent_names.get("schema_name")
    if schema_name and schema_name not in RUNTIME_SCHEMAS:
        return False
    return True


def _build_reflected_metadata(connection) -> MetaData:
    # The repository is SQL-first rather than ORM-first. Reflecting the migrated
    # schema keeps `alembic check` usable as a post-upgrade smoke check in CI.
    metadata = MetaData()
    inspector = inspect(connection)
    present_schemas = set(inspector.get_schema_names())

    for schema in RUNTIME_SCHEMAS:
        if schema not in present_schemas:
            continue
        metadata.reflect(bind=connection, schema=schema)

    return metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=None,
        literal_binds=True,
        include_schemas=True,
        include_name=include_name,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    with connectable.connect() as connection:
        # Reflect the live schema, then *commit* the implicit read transaction
        # so the upgrade transaction can later commit cleanly. Without the
        # explicit commit() the reflect's open transaction holds DDL changes
        # in limbo and they silently roll back at connection close.
        target_metadata = _build_reflected_metadata(connection)
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            include_name=include_name,
            compare_type=False,
            compare_server_default=False,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
