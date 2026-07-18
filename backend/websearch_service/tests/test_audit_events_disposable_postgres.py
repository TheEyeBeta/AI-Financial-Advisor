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

Tests are self-contained (unique ``action`` values, filtered by id) rather
than clearing the table between tests — ``core.audit_events`` is genuinely
append-only (even ``TRUNCATE`` is rejected for the table owner), so there is
no reset path, by design.
"""
from __future__ import annotations

import os
import uuid

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


def _unique_action(prefix: str) -> str:
    return f"{prefix}.{uuid.uuid4().hex[:12]}"


def test_service_role_can_insert(conn):
    action = _unique_action("test.insert")
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result, metadata) "
            "VALUES ('admin', %s, 'success', '{}'::jsonb) RETURNING id",
            (action,),
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


def test_rls_enabled_and_forced_with_expected_policies(conn):
    """Catalog-level assertions so an accidental policy/RLS removal fails
    this suite even if grants alone happen to still deny ordinary roles."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid = 'core.audit_events'::regclass"
        )
        relrowsecurity, relforcerowsecurity = cur.fetchone()
        assert relrowsecurity is True
        assert relforcerowsecurity is True

        cur.execute(
            "SELECT policyname, cmd, roles FROM pg_policies "
            "WHERE schemaname = 'core' AND tablename = 'audit_events' "
            "ORDER BY policyname"
        )
        policies = cur.fetchall()
    policy_names = {p[0] for p in policies}
    assert "Service role inserts audit events" in policy_names
    assert "Service role reads audit events" in policy_names
    for _name, cmd, roles in policies:
        assert roles == ["service_role"]
        assert cmd in ("INSERT", "SELECT")


def _insert_as_service_role(conn, action: str) -> None:
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', %s, 'success')",
            (action,),
        )
        cur.execute("RESET ROLE")


def test_update_is_rejected_even_for_owner(conn):
    action = _unique_action("test.update")
    _insert_as_service_role(conn, action)
    with conn.cursor() as cur:
        cur.execute("SET ROLE postgres")
        with pytest.raises(Exception, match="append-only"):
            cur.execute("UPDATE core.audit_events SET result = 'failure' WHERE action = %s", (action,))
        conn.rollback()
        cur.execute("RESET ROLE")


def test_delete_is_rejected_even_for_owner(conn):
    action = _unique_action("test.delete")
    _insert_as_service_role(conn, action)
    with conn.cursor() as cur:
        cur.execute("SET ROLE postgres")
        with pytest.raises(Exception, match="append-only"):
            cur.execute("DELETE FROM core.audit_events WHERE action = %s", (action,))
        conn.rollback()
        cur.execute("RESET ROLE")


def test_truncate_is_rejected_even_for_owner(conn):
    with conn.cursor() as cur:
        cur.execute("SET ROLE postgres")
        with pytest.raises(Exception, match="append-only"):
            cur.execute("TRUNCATE core.audit_events")
        conn.rollback()
        cur.execute("RESET ROLE")


def test_integrity_hash_chain_links_rows(conn):
    action1 = _unique_action("test.chain.first")
    action2 = _unique_action("test.chain.second")
    with conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', %s, 'success') RETURNING id",
            (action1,),
        )
        first_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO core.audit_events (actor_type, action, result) "
            "VALUES ('admin', %s, 'success') RETURNING id",
            (action2,),
        )
        second_id = cur.fetchone()[0]
        cur.execute("RESET ROLE")

        cur.execute(
            "SELECT integrity_hash FROM core.audit_events WHERE id = %s", (first_id,)
        )
        first_hash = cur.fetchone()[0]
        cur.execute(
            "SELECT prev_integrity_hash, integrity_hash FROM core.audit_events WHERE id = %s",
            (second_id,),
        )
        second_prev_hash, second_hash = cur.fetchone()

    assert second_prev_hash == first_hash
    assert second_hash != first_hash


def test_concurrent_inserts_do_not_fork_the_chain(conn):
    """Regression test for the race condition where two concurrent inserts'
    BEFORE INSERT triggers could both read the same "latest" row and claim
    the same prev_integrity_hash — the chain-head SELECT ... FOR UPDATE
    design (see the migration) must serialize this correctly."""
    import threading

    prefix = f"test.concurrent.{uuid.uuid4().hex[:8]}"
    errors: list[Exception] = []

    def _insert_one(i: int) -> None:
        psycopg = pytest.importorskip("psycopg")
        try:
            with psycopg.connect(_DSN, autocommit=True) as thread_conn:
                with thread_conn.cursor() as cur:
                    cur.execute("SET ROLE service_role")
                    cur.execute(
                        "INSERT INTO core.audit_events (actor_type, action, result) "
                        "VALUES ('admin', %s, 'success')",
                        (f"{prefix}.{i}",),
                    )
                    cur.execute("RESET ROLE")
        except Exception as exc:  # pragma: no cover - surfaced via errors list
            errors.append(exc)

    threads = [threading.Thread(target=_insert_one, args=(i,)) for i in range(15)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"concurrent inserts raised: {errors}"

    with conn.cursor() as cur:
        cur.execute(
            "SELECT prev_integrity_hash, count(*) FROM core.audit_events "
            "WHERE action LIKE %s GROUP BY prev_integrity_hash HAVING count(*) > 1",
            (f"{prefix}.%",),
        )
        forked_groups = cur.fetchall()
    assert forked_groups == [], f"chain forked: {forked_groups}"
