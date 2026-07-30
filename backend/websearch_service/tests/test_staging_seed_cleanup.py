"""Tests for staging_seed.cleanup — proves the per-table ownership-column fix.

academy.profiles has no user_id column (its id IS the owning core.users.id —
see alembic/versions/0040_academy_schema_rls.py); user_lesson_progress is
owned via user_id. A predicate that unconditionally references both columns
for every table raises UndefinedColumn on the profiles iteration and rolls
back the whole cleanup transaction (#293 review).
"""
from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from staging_seed import cleanup
from staging_seed.config import SeedConfig


def make_config(**overrides) -> SeedConfig:
    defaults = dict(
        environment="staging",
        allow_synthetic_seed=True,
        supabase_url="https://fakeproject.supabase.co",
        supabase_service_role_key="fake-key",
        database_url="postgresql://user:pass@fake-staging-db:5432/postgres",
        production_denylist=["unrelated-placeholder-ref"],
        random_seed=1,
        user_count=200,
    )
    defaults.update(overrides)
    return SeedConfig(**defaults)


class FakeCursor:
    def __init__(self, executed: list[tuple[str, tuple]], select_result: list[tuple]):
        self._executed = executed
        self._select_result = select_result
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        self._executed.append((query, params))
        if query.strip().upper().startswith("SELECT"):
            self.rowcount = len(self._select_result)
        else:
            self.rowcount = 1

    def fetchall(self):
        return self._select_result


class FakeConn:
    def __init__(self, select_result: list[tuple]):
        self.executed: list[tuple[str, tuple]] = []
        self._select_result = select_result

    def cursor(self):
        return FakeCursor(self.executed, self._select_result)


def test_cleanup_uses_id_for_profiles_and_user_id_for_lesson_progress():
    """The DELETE for academy.profiles must key on "id", never "user_id"."""
    conn = FakeConn(select_result=[("user-1", "auth-1")])

    @contextmanager
    def fake_connect(config):
        yield conn

    with patch.object(cleanup, "connect", fake_connect), \
         patch.object(cleanup, "table_exists", return_value=True), \
         patch.object(cleanup, "AuthAdminClient") as mock_auth_cls:
        mock_auth_cls.return_value = MagicMock()
        result = cleanup.run_cleanup(make_config())

    academy_deletes = [
        (query, params)
        for query, params in conn.executed
        if "academy" in query and query.strip().upper().startswith("DELETE")
    ]
    assert len(academy_deletes) == 2

    profiles_query, profiles_params = next(q for q in academy_deletes if "profiles" in q[0])
    assert '"id" = ANY(%s)' in profiles_query
    assert "user_id" not in profiles_query
    assert profiles_params == (["user-1"],)

    progress_query, progress_params = next(q for q in academy_deletes if "user_lesson_progress" in q[0])
    assert '"user_id" = ANY(%s)' in progress_query
    assert progress_params == (["user-1"],)

    assert result["academy_rows"] == 2
