"""Evidence for migration 0039 — the pgcrypto schema-resolution fix for
``core.audit_events_set_integrity()``.

Two tiers:

* Unit tests (always run) exercise ``_resolve_pgcrypto_schema`` in isolation
  against fake connections, proving the "fail clearly" requirement without
  needing real Postgres.
* Real-Postgres integration tests (opt-in, see below) prove the actual
  regression: an ``extensions``-schema pgcrypto placement — the live staging
  shape that broke account suspend/delete — now works end to end, while a
  ``public``-schema placement (the shape that always worked locally, which is
  why this bug shipped unnoticed) keeps working too.

Opt-in only: set ``AUDIT_SCHEMA_FIX_ADMIN_DSN`` to a disposable Postgres
*server* DSN (not a specific database — e.g.
``postgresql://postgres:postgres@localhost:5432/postgres``) whose role can
``CREATE DATABASE``/``DROP DATABASE``. Each test creates and drops its own
throwaway database so different pgcrypto placements never collide. Skipped
otherwise — this must never run against a shared or production server.
"""
from __future__ import annotations

import importlib.util
import os
import pathlib
import subprocess
import sys
import uuid

import pytest

_ADMIN_DSN = os.getenv("AUDIT_SCHEMA_FIX_ADMIN_DSN", "")

pytestmark = pytest.mark.skipif(
    not _ADMIN_DSN,
    reason="AUDIT_SCHEMA_FIX_ADMIN_DSN not set — disposable Postgres schema-fix tests are opt-in",
)

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
_MIGRATION_PATH = (
    BACKEND_DIR / "alembic" / "versions" / "0039_audit_digest_schema_fix.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location(
        "audit_digest_schema_fix_migration", _MIGRATION_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


# ── Unit tests: _resolve_pgcrypto_schema, no real Postgres needed ──────────


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, rows):
        self._results = iter(_FakeResult(row) for row in rows)

    def exec_driver_sql(self, _sql, _params=None):
        return next(self._results)


def test_missing_pgcrypto_extension_raises_clear_error():
    module = _load_migration_module()
    conn = _FakeConn([None])
    with pytest.raises(RuntimeError, match="pgcrypto extension is not installed"):
        module._resolve_pgcrypto_schema(conn)


def test_missing_digest_function_raises_clear_error():
    module = _load_migration_module()
    conn = _FakeConn([("extensions",), None])
    with pytest.raises(RuntimeError, match=r"digest\(text, text\) was not found"):
        module._resolve_pgcrypto_schema(conn)


def test_non_identifier_schema_name_is_rejected():
    module = _load_migration_module()
    conn = _FakeConn([("evil; DROP TABLE x",), (1,)])
    with pytest.raises(RuntimeError, match="not a plain identifier"):
        module._resolve_pgcrypto_schema(conn)


def test_happy_path_returns_schema_name():
    module = _load_migration_module()
    conn = _FakeConn([("extensions",), (1,)])
    assert module._resolve_pgcrypto_schema(conn) == "extensions"


# ── Integration tests: real disposable Postgres ─────────────────────────────


@pytest.fixture()
def fresh_database():
    """Creates a throwaway database on the admin server, yields its DSN plus
    a superuser DSN scoped to it (for setup like pre-installing pgcrypto),
    and drops it afterwards."""
    psycopg = pytest.importorskip("psycopg")

    db_name = f"audit_digest_fix_{uuid.uuid4().hex[:12]}"
    admin_conn = psycopg.connect(_ADMIN_DSN, autocommit=True)
    try:
        with admin_conn.cursor() as cur:
            cur.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        admin_conn.close()

    base = _ADMIN_DSN.rsplit("/", 1)[0]
    db_dsn = f"{base}/{db_name}"
    # env.py normalises postgres://→postgresql:// and adds +psycopg itself,
    # but subprocess env vars go straight through, so normalise here too.
    alembic_dsn = db_dsn
    if alembic_dsn.startswith("postgres://"):
        alembic_dsn = "postgresql://" + alembic_dsn[len("postgres://") :]

    try:
        yield db_dsn, alembic_dsn
    finally:
        admin_conn = psycopg.connect(_ADMIN_DSN, autocommit=True)
        try:
            with admin_conn.cursor() as cur:
                cur.execute(
                    f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'
                )
        finally:
            admin_conn.close()


def _install_pgcrypto_in_extensions_schema(db_dsn: str) -> None:
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS extensions")
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions")
    finally:
        conn.close()


def _run_alembic(alembic_dsn: str, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["ALEMBIC_DATABASE_URL"] = alembic_dsn
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, (
        f"alembic {' '.join(args)} failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    return result


def _pgcrypto_schema(db_dsn: str) -> str:
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT n.nspname FROM pg_extension e "
                "JOIN pg_namespace n ON n.oid = e.extnamespace "
                "WHERE e.extname = 'pgcrypto'"
            )
            row = cur.fetchone()
    finally:
        conn.close()
    assert row is not None
    return row[0]


def _function_definition(db_dsn: str) -> str:
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pg_get_functiondef('core.audit_events_set_integrity()'::regprocedure)"
            )
            (definition,) = cur.fetchone()
    finally:
        conn.close()
    return definition


def _insert_audit_row(db_dsn: str, action: str) -> tuple[str, str | None]:
    """Inserts as service_role, returns (integrity_hash, prev_integrity_hash)."""
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SET ROLE service_role")
            cur.execute(
                "INSERT INTO core.audit_events (actor_type, action, result) "
                "VALUES ('admin', %s, 'success') "
                "RETURNING integrity_hash, prev_integrity_hash",
                (action,),
            )
            integrity_hash, prev_integrity_hash = cur.fetchone()
            cur.execute("RESET ROLE")
    finally:
        conn.close()
    assert integrity_hash, "integrity_hash was not generated"
    return integrity_hash, prev_integrity_hash


@pytest.mark.parametrize("pre_install_extensions_schema", [False, True], ids=["public", "extensions"])
def test_migration_upgrades_cleanly_from_0038(fresh_database, pre_install_extensions_schema):
    db_dsn, alembic_dsn = fresh_database
    if pre_install_extensions_schema:
        _install_pgcrypto_in_extensions_schema(db_dsn)

    _run_alembic(alembic_dsn, "upgrade", "0038_academy_rpc_authz")
    _run_alembic(alembic_dsn, "upgrade", "head")
    _run_alembic(alembic_dsn, "current")


@pytest.mark.parametrize("pre_install_extensions_schema", [False, True], ids=["public", "extensions"])
def test_function_definition_is_schema_qualified(fresh_database, pre_install_extensions_schema):
    db_dsn, alembic_dsn = fresh_database
    if pre_install_extensions_schema:
        _install_pgcrypto_in_extensions_schema(db_dsn)

    _run_alembic(alembic_dsn, "upgrade", "head")

    schema = _pgcrypto_schema(db_dsn)
    assert schema == ("extensions" if pre_install_extensions_schema else "public")

    definition = _function_definition(db_dsn)
    assert f"{schema}.digest(" in definition
    # The bare, unqualified call from 0036 must be gone.
    assert "\n                digest(" not in definition


def test_audit_insert_succeeds_with_pgcrypto_in_extensions(fresh_database):
    """The core regression test: this is the exact staging shape
    (pgcrypto in `extensions`) that made every account suspend/delete audit
    write — and therefore the suspend/delete flow itself — fail before this
    migration."""
    db_dsn, alembic_dsn = fresh_database
    _install_pgcrypto_in_extensions_schema(db_dsn)
    _run_alembic(alembic_dsn, "upgrade", "head")

    hash1, prev1 = _insert_audit_row(db_dsn, "test.extensions.first")
    assert prev1 is None

    hash2, prev2 = _insert_audit_row(db_dsn, "test.extensions.second")
    assert prev2 == hash1
    assert hash2 != hash1


def test_existing_rows_and_chain_head_preserved_across_upgrade(fresh_database):
    db_dsn, alembic_dsn = fresh_database
    # pgcrypto lands in public here (the shape that already worked pre-fix),
    # so a row can be inserted with the *old* (0038-era) function before
    # upgrading to 0039.
    _run_alembic(alembic_dsn, "upgrade", "0038_academy_rpc_authz")

    pre_hash, pre_prev = _insert_audit_row(db_dsn, "test.preserved.pre-upgrade")
    assert pre_prev is None

    _run_alembic(alembic_dsn, "upgrade", "head")

    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT integrity_hash FROM core.audit_events WHERE action = %s",
                ("test.preserved.pre-upgrade",),
            )
            (row_hash,) = cur.fetchone()
            cur.execute(
                "SELECT integrity_hash FROM core.audit_events_chain_head WHERE id = TRUE"
            )
            (chain_head_hash,) = cur.fetchone()
    finally:
        conn.close()

    assert row_hash == pre_hash
    assert chain_head_hash == pre_hash

    post_hash, post_prev = _insert_audit_row(db_dsn, "test.preserved.post-upgrade")
    assert post_prev == pre_hash
    assert post_hash != pre_hash


def test_concurrent_inserts_maintain_valid_chain_with_pgcrypto_in_extensions(fresh_database):
    import threading

    db_dsn, alembic_dsn = fresh_database
    _install_pgcrypto_in_extensions_schema(db_dsn)
    _run_alembic(alembic_dsn, "upgrade", "head")

    psycopg = pytest.importorskip("psycopg")
    prefix = f"test.concurrent.extensions.{uuid.uuid4().hex[:8]}"
    errors: list[Exception] = []

    def _insert_one(i: int) -> None:
        try:
            with psycopg.connect(db_dsn, autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute("SET ROLE service_role")
                    cur.execute(
                        "INSERT INTO core.audit_events (actor_type, action, result) "
                        "VALUES ('admin', %s, 'success')",
                        (f"{prefix}.{i}",),
                    )
                    cur.execute("RESET ROLE")
        except Exception as exc:  # pragma: no cover - surfaced via errors list
            errors.append(exc)

    threads = [threading.Thread(target=_insert_one, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"concurrent inserts raised: {errors}"

    conn = psycopg.connect(db_dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT prev_integrity_hash, count(*) FROM core.audit_events "
                "WHERE action LIKE %s GROUP BY prev_integrity_hash HAVING count(*) > 1",
                (f"{prefix}.%",),
            )
            forked_groups = cur.fetchall()
    finally:
        conn.close()
    assert forked_groups == [], f"chain forked: {forked_groups}"


def test_update_delete_truncate_still_rejected_after_fix(fresh_database):
    db_dsn, alembic_dsn = fresh_database
    _install_pgcrypto_in_extensions_schema(db_dsn)
    _run_alembic(alembic_dsn, "upgrade", "head")

    _insert_audit_row(db_dsn, "test.mutation-rejected")

    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(db_dsn, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SET ROLE postgres")

            with pytest.raises(Exception, match="append-only"):
                cur.execute(
                    "UPDATE core.audit_events SET result = 'failure' WHERE action = %s",
                    ("test.mutation-rejected",),
                )

            with pytest.raises(Exception, match="append-only"):
                cur.execute(
                    "DELETE FROM core.audit_events WHERE action = %s",
                    ("test.mutation-rejected",),
                )

            with pytest.raises(Exception, match="append-only"):
                cur.execute("TRUNCATE core.audit_events")

            cur.execute("RESET ROLE")
    finally:
        conn.close()
