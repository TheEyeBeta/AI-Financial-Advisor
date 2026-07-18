"""Disposable-Postgres evidence for core.audit_events (migration 0036).

Unlike ``tests/integration/`` (which exercises a real Supabase test
*project* over PostgREST), this file talks directly to Postgres over SQL so
it can assert on RLS/grants/triggers that PostgREST would otherwise hide
behind its own authorization layer. Lives outside ``tests/integration/`` on
purpose — that directory's conftest force-skips everything unless real
Supabase project credentials are configured, which is unrelated to this
file's disposable local Postgres.

Opt-in only: set ``AUDIT_INTEGRATION_DATABASE_URL`` to a disposable Postgres
instance that already has migrations applied through ``0036_core_audit_events``
(``alembic -c alembic.ini upgrade head`` from this directory, with
``ALEMBIC_DATABASE_URL`` pointed at the same database). Skipped otherwise —
this must never run against a shared or production database.
"""
from __future__ import annotations

import os

import pytest

_DSN = os.getenv("AUDIT_INTEGRATION_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not _DSN,
    reason="AUDIT_INTEGRATION_DATABASE_URL not set — disposable Postgres audit_events tests are opt-in",
)


@pytest.fixture()
def conn():
    psycopg = pytest.importorskip("psycopg")
    connection = psycopg.connect(_DSN, autocommit=True)
    try:
        yield connection
    finally:
        connection.close()


def _clear_table(conn):
    with conn.cursor() as cur:
        cur.execute("SET ROLE postgres")
        # DELETE is rejected by the append-only trigger even for the owner —
        # this is intentional; use TRUNCATE (bypasses row-level DELETE
        # triggers) purely to reset fixture state between test runs.
        cur.execute("TRUNCATE core.audit_events")
        cur.execute("RESET ROLE")


def test_service_role_can_insert(conn):
    _clear_table(conn)
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result, metadata) "
            "VALUES ('admin', 'admin.user_suspended', 'success', '{}'::jsonb) RETURNING id"
        )
        row = cur.fetchone()
        cur.execute("RESET ROLE")
    assert row is not None


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_ordinary_roles_cannot_insert(conn, role):
    with conn.cursor() as cur:
        cur.execute(f"SET ROLE {role}")
        with pytest.raises(Exception, match="permission denied"):
            cur.execute(
                "INSERT INTO core.audit_events (actor_type, action, result) "
                "VALUES ('user', 'x', 'success')"
            )
        conn.rollback()
        cur.execute("RESET ROLE")


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_ordinary_roles_cannot_select(conn, role):
    with conn.cursor() as cur:
        cur.execute(f"SET ROLE {role}")
        with pytest.raises(Exception, match="permission denied"):
            cur.execute("SELECT * FROM core.audit_events LIMIT 1")
        conn.rollback()
        cur.execute("RESET ROLE")


def test_update_is_rejected_even_for_owner(conn):
    _clear_table(conn)
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', 'admin.user_suspended', 'success')"
        )
        cur.execute("RESET ROLE")
        cur.execute("SET ROLE postgres")
        with pytest.raises(Exception, match="append-only"):
            cur.execute("UPDATE core.audit_events SET result = 'failure'")
        conn.rollback()
        cur.execute("RESET ROLE")


def test_delete_is_rejected_even_for_owner(conn):
    _clear_table(conn)
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', 'admin.user_suspended', 'success')"
        )
        cur.execute("RESET ROLE")
        cur.execute("SET ROLE postgres")
        with pytest.raises(Exception, match="append-only"):
            cur.execute("DELETE FROM core.audit_events")
        conn.rollback()
        cur.execute("RESET ROLE")


def test_integrity_hash_chain_links_rows(conn):
    _clear_table(conn)
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', 'admin.user_suspended', 'success')"
        )
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', 'admin.user_restored', 'success')"
        )
        cur.execute("RESET ROLE")
        cur.execute(
            "SELECT action, prev_integrity_hash, integrity_hash "
            "FROM core.audit_events ORDER BY created_at"
        )
        rows = cur.fetchall()
    assert len(rows) == 2
    first, second = rows
    assert first[1] is None
    assert second[1] == first[2]
    assert second[2] != first[2]
