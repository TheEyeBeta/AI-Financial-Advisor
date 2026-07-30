"""Database connection and non-sensitive identity helpers.

Mirrors ``alembic/env.py``'s URL resolution/normalisation so the seeder talks
to the same database Alembic manages, via the same env vars.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from typing import Iterator

import psycopg

from .config import SeedConfig
from .guard import hostname_from_url, project_ref_from_url


def normalise_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    return url


@contextmanager
def connect(config: SeedConfig) -> Iterator[psycopg.Connection]:
    if not config.database_url:
        raise RuntimeError(
            "No database URL configured (ALEMBIC_DATABASE_URL / DATABASE_URL / "
            "SUPABASE_DB_URL)."
        )
    conn = psycopg.connect(normalise_database_url(config.database_url))
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def project_ref_hash(config: SeedConfig) -> str:
    """Non-reversible identifier for the target project — safe to print/log."""
    ref = project_ref_from_url(config.supabase_url) or "unknown"
    return hashlib.sha256(ref.encode("utf-8")).hexdigest()[:12]


def current_schema_revision(conn: psycopg.Connection) -> str | None:
    """Read the applied Alembic revision from the target database."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT version_num FROM public.alembic_version LIMIT 1")
            row = cur.fetchone()
            return row[0] if row else None
    except psycopg.errors.UndefinedTable:
        conn.rollback()
        return None


def expected_schema_revision() -> str | None:
    """The latest local Alembic head, i.e. what staging *should* be running."""
    try:
        from pathlib import Path

        from alembic.config import Config
        from alembic.script import ScriptDirectory

        alembic_dir = Path(__file__).resolve().parent.parent / "alembic"
        cfg = Config()
        cfg.set_main_option("script_location", str(alembic_dir))
        script = ScriptDirectory.from_config(cfg)
        heads = script.get_heads()
        return heads[0] if len(heads) == 1 else ",".join(sorted(heads))
    except Exception:
        return None


def target_hostname(config: SeedConfig) -> str | None:
    return hostname_from_url(config.supabase_url) or hostname_from_url(config.database_url)


def table_columns(conn: psycopg.Connection, schema: str, table: str) -> list[dict]:
    """Introspect column metadata for a schema-qualified table.

    Returns an empty list if the table does not exist in the target
    database — callers use this to skip legacy/unformalised tables
    gracefully instead of crashing the whole seed run.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        rows = cur.fetchall()
    return [
        {
            "name": name,
            "data_type": data_type,
            "nullable": is_nullable == "YES",
            "has_default": column_default is not None,
        }
        for name, data_type, is_nullable, column_default in rows
    ]


def table_exists(conn: psycopg.Connection, schema: str, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = %s AND table_name = %s
            """,
            (schema, table),
        )
        return cur.fetchone() is not None
