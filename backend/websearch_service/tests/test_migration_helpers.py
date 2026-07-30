"""Regression tests for migration_helpers.py path resolution (Gate 1, #208).

migration_helpers.execute_sql_file() reads SQL bodies from the monorepo root
(two directories above backend/websearch_service) — a location that exists in
a full checkout (dev, CI) but not in the deployed backend image, which only
ships backend/websearch_service. Alembic's ScriptDirectory imports every
version module (including this one) to build its revision graph whenever
anything asks for the current head — e.g. the readiness probe's
expected_schema_revision(). If REPO_ROOT were computed eagerly at import
time, that import alone would crash in the deployed image with no repo root
two levels up, and take the whole head-resolution/readiness check down with
it — even though nothing was actually trying to run a migration.
"""
from __future__ import annotations

from pathlib import Path

import migration_helpers


def test_repo_root_is_not_computed_at_import_time():
    """No eager module-level path computation that could fail on import."""
    assert not hasattr(migration_helpers, "REPO_ROOT")


def test_repo_root_resolves_lazily_from_current_module_location():
    """repo_root() reflects wherever migration_helpers.py currently lives —
    proving resolution happens at call time against the real path, not a
    value baked in at import time."""
    expected = Path(migration_helpers.__file__).resolve().parents[2]
    assert migration_helpers.repo_root() == expected


def test_repo_root_only_fails_when_actually_called(monkeypatch):
    """Simulate the deployed image's shallow layout (no monorepo root two
    levels above the module) by pointing __file__ at a shallow path *after*
    import — proving the failure is deferred to call time, not import time."""
    monkeypatch.setattr(migration_helpers, "__file__", "/app/migration_helpers.py")
    try:
        migration_helpers.repo_root()
    except IndexError:
        pass
    else:
        raise AssertionError(
            "expected IndexError for a path with no monorepo root two levels up"
        )
