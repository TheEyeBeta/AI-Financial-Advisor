"""Database-level tests for the meridian.goal_progress schema (migration 0037).

Root cause this migration fixes: migration 0001 creates meridian.goal_progress
with legacy columns (snapshot_date/plan_amount/variance_pct); migration 0025's
`CREATE TABLE IF NOT EXISTS` is a no-op against that pre-existing table, so
every database that ran this history had the legacy shape while
intelligence_engine.py queried period/target_amount/actual_amount/on_track.
0037 reconciles this in place, preserving data.

Like test_trading_constraints_db.py, these run against the migrated Postgres
from ALEMBIC_DATABASE_URL (the CI backend job migrates it to head before
pytest) and are skipped when no database is configured so the unit suite
stays runnable standalone.
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

_RAW_URL = (os.getenv("ALEMBIC_DATABASE_URL") or "").strip()
DSN = _RAW_URL.replace("postgresql+psycopg://", "postgresql://")

pytestmark = pytest.mark.skipif(
    not DSN, reason="ALEMBIC_DATABASE_URL not set — requires a migrated Postgres"
)


@pytest.fixture(scope="module")
def db():
    conn = psycopg.connect(DSN, autocommit=True)
    yield conn
    conn.close()


@pytest.fixture()
def goal_id(db):
    """A real meridian.user_goals row so goal_progress FK inserts succeed."""
    auth_id = str(uuid.uuid4())
    db.execute("INSERT INTO auth.users (id) VALUES (%s)", (auth_id,))
    row = db.execute(
        "SELECT id FROM core.users WHERE auth_id = %s", (auth_id,)
    ).fetchone()
    assert row, "handle_new_user trigger should have provisioned core.users"

    goal_row = db.execute(
        "INSERT INTO meridian.user_goals (user_id, goal_name, target_amount) "
        "VALUES (%s, 'Test Goal', 1000) RETURNING id",
        (auth_id,),
    ).fetchone()
    yield goal_row[0]
    db.execute("DELETE FROM auth.users WHERE id = %s", (auth_id,))


class TestGoalProgressSchemaMatchesApplicationQuery:
    """intelligence_engine.py._fetch_goal_progress selects exactly these columns."""

    def test_expected_columns_exist_with_correct_types(self, db):
        rows = db.execute(
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
            """
        ).fetchall()
        by_name = {name: (dtype, nullable) for name, dtype, nullable in rows}

        assert by_name["goal_id"][0] == "uuid"
        assert by_name["period"] == ("date", "NO")
        assert by_name["target_amount"][0] == "numeric"
        assert by_name["actual_amount"][0] == "numeric"
        assert by_name["on_track"][0] == "boolean"
        assert by_name["created_at"][0] == "timestamp with time zone"

    def test_legacy_column_names_are_gone(self, db):
        rows = db.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
            """
        ).fetchall()
        names = {r[0] for r in rows}
        assert "snapshot_date" not in names
        assert "plan_amount" not in names

    def test_unique_constraint_on_goal_id_period(self, db):
        row = db.execute(
            """
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'meridian.goal_progress'::regclass
              AND contype = 'u'
              AND conname = 'goal_progress_goal_id_period_key'
            """
        ).fetchone()
        assert row is not None

    def test_index_matches_query_pattern(self, db):
        """_fetch_goal_progress does `.in_(goal_id).order(period, desc=True)`."""
        row = db.execute(
            """
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'meridian' AND tablename = 'goal_progress'
              AND indexname = 'idx_goal_progress_goal_id_period_desc'
            """
        ).fetchone()
        assert row is not None


class TestGoalProgressConstraints:
    def test_valid_row_inserts(self, db, goal_id):
        db.execute(
            "INSERT INTO meridian.goal_progress (goal_id, period, actual_amount, target_amount, on_track) "
            "VALUES (%s, current_date, 500, 1000, true)",
            (goal_id,),
        )

    def test_rejects_negative_target_amount(self, db, goal_id):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO meridian.goal_progress (goal_id, period, target_amount) "
                "VALUES (%s, current_date, -1)",
                (goal_id,),
            )

    def test_rejects_negative_actual_amount(self, db, goal_id):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO meridian.goal_progress (goal_id, period, actual_amount) "
                "VALUES (%s, current_date, -1)",
                (goal_id,),
            )

    def test_rejects_duplicate_goal_id_period(self, db, goal_id):
        db.execute(
            "INSERT INTO meridian.goal_progress (goal_id, period) VALUES (%s, current_date)",
            (goal_id,),
        )
        with pytest.raises(psycopg.errors.UniqueViolation):
            db.execute(
                "INSERT INTO meridian.goal_progress (goal_id, period) VALUES (%s, current_date)",
                (goal_id,),
            )

    def test_rejects_null_period(self, db, goal_id):
        with pytest.raises(psycopg.errors.NotNullViolation):
            db.execute(
                "INSERT INTO meridian.goal_progress (goal_id, period) VALUES (%s, NULL)",
                (goal_id,),
            )


class TestUpgradeFromPreviousHead:
    """Upgrade tests from the previous Alembic head (0036) — run for real
    against the CI-provisioned database rather than asserted only in prose.

    Downgrading 0037 only moves the version pointer back (its downgrade() is
    an intentional no-op — see the migration's docstring on why a rename
    cannot be safely auto-reverted); re-running upgrade head must still
    complete without error and land on the same schema, proving the
    migration is safe to apply starting from the previous head.
    """

    def _run_alembic(self, *args: str) -> subprocess.CompletedProcess:
        repo_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
            cwd=repo_backend,
            env={**os.environ, "ALEMBIC_DATABASE_URL": _RAW_URL},
            capture_output=True,
            text=True,
        )

    def test_upgrade_from_previous_head_and_idempotent_reapply(self, db):
        stamp_back = self._run_alembic("stamp", "0036_core_audit_events")
        assert stamp_back.returncode == 0, stamp_back.stderr

        first_upgrade = self._run_alembic("upgrade", "head")
        assert first_upgrade.returncode == 0, first_upgrade.stderr

        current = self._run_alembic("current")
        # Head moved forward when 0038_academy_rpc_authz was added — this test's
        # job is to prove upgrade-from-0036 lands cleanly, not to pin the exact
        # head, so it tracks the alembic history's own current head.
        heads = self._run_alembic("heads")
        assert heads.stdout.split()[0] in current.stdout

        # Idempotency: re-running upgrade head from head must be a safe no-op.
        second_upgrade = self._run_alembic("upgrade", "head")
        assert second_upgrade.returncode == 0, second_upgrade.stderr

        rows = db.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
            """
        ).fetchall()
        names = {r[0] for r in rows}
        assert {"period", "target_amount", "actual_amount", "on_track", "created_at"} <= names
