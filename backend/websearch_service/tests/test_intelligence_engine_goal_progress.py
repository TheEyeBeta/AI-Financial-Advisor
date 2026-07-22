"""Service + regression tests for goal-progress reads in intelligence_engine.py.

Covers two requirements that `test_intelligence_engine.py` (pure `_evaluate_user`
logic only) does not:

1. `_fetch_goal_progress` actually reads and shapes rows correctly (service test).
2. A schema mismatch on meridian.goal_progress is never silently swallowed —
   it is raised as `GoalProgressSchemaError`, logged at ERROR, and recorded in
   the cycle's structured `errors` output rather than only a generic warning
   indistinguishable from "user has no goals" (regression test for the fix
   that closes the meridian.goal_progress schema-drift defect — see
   migration 0037_goal_progress_reconcile).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from postgrest.exceptions import APIError

from app.services.intelligence_engine import (
    GoalProgressSchemaError,
    _fetch_goal_progress,
    _run_intelligence_cycle_sync,
)


def _mock_chain(*, data=None, raise_exc: Exception | None = None):
    """Build a MagicMock replicating .select().in_().order().execute()."""
    chain = MagicMock()
    chain.select.return_value = chain
    chain.in_.return_value = chain
    chain.order.return_value = chain
    if raise_exc is not None:
        chain.execute.side_effect = raise_exc
    else:
        result = MagicMock()
        result.data = data or []
        chain.execute.return_value = result
    return chain


class TestFetchGoalProgressService:
    """Service tests proving goal-progress reads work."""

    def test_empty_goal_ids_returns_empty_without_querying(self):
        with patch("app.services.intelligence_engine._tbl") as mock_tbl:
            result = _fetch_goal_progress([])
        assert result == {}
        mock_tbl.assert_not_called()

    def test_rows_are_keyed_by_goal_id(self):
        rows = [
            {"goal_id": "g-1", "period": "2026-07-01", "actual_amount": 500, "target_amount": 1000, "on_track": False},
            {"goal_id": "g-1", "period": "2026-06-01", "actual_amount": 400, "target_amount": 1000, "on_track": False},
            {"goal_id": "g-2", "period": "2026-07-01", "actual_amount": 1000, "target_amount": 1000, "on_track": True},
        ]
        chain = _mock_chain(data=rows)
        with patch("app.services.intelligence_engine._tbl", return_value=chain) as mock_tbl:
            result = _fetch_goal_progress(["g-1", "g-2"])

        mock_tbl.assert_called_once_with("meridian", "goal_progress")
        chain.in_.assert_called_once_with("goal_id", ["g-1", "g-2"])
        chain.order.assert_called_once_with("period", desc=True)
        assert len(result["g-1"]) == 2
        assert len(result["g-2"]) == 1
        # Most recent period first, as the caller (_evaluate_user) relies on.
        assert result["g-1"][0]["period"] == "2026-07-01"

    def test_rows_with_missing_goal_id_are_skipped(self):
        chain = _mock_chain(data=[{"goal_id": None, "period": "2026-07-01"}])
        with patch("app.services.intelligence_engine._tbl", return_value=chain):
            result = _fetch_goal_progress(["g-1"])
        assert result == {}


class TestGoalProgressSchemaErrorNotSwallowed:
    """Regression: schema mismatches must never be silently swallowed."""

    @pytest.mark.parametrize("code", ["42703", "42P01", "3F000", "PGRST204", "PGRST205"])
    def test_schema_error_codes_raise_goal_progress_schema_error(self, code):
        api_error = APIError({"code": code, "message": "column not found", "hint": None, "details": None})
        chain = _mock_chain(raise_exc=api_error)
        with patch("app.services.intelligence_engine._tbl", return_value=chain):
            with pytest.raises(GoalProgressSchemaError):
                _fetch_goal_progress(["g-1"])

    def test_non_schema_api_error_is_not_reclassified(self):
        """A transient error (e.g. connection/auth) must propagate as-is —
        only genuine schema mismatches become GoalProgressSchemaError."""
        api_error = APIError({"code": "53300", "message": "too many connections", "hint": None, "details": None})
        chain = _mock_chain(raise_exc=api_error)
        with patch("app.services.intelligence_engine._tbl", return_value=chain):
            with pytest.raises(APIError):
                _fetch_goal_progress(["g-1"])

    def test_schema_error_is_logged_at_error_level(self, caplog):
        api_error = APIError({"code": "42703", "message": "column \"period\" does not exist", "hint": None, "details": None})
        chain = _mock_chain(raise_exc=api_error)
        with patch("app.services.intelligence_engine._tbl", return_value=chain):
            with caplog.at_level("ERROR", logger="app.services.intelligence_engine"):
                with pytest.raises(GoalProgressSchemaError):
                    _fetch_goal_progress(["g-1"])
        assert any(record.levelname == "ERROR" for record in caplog.records)
        assert any("schema mismatch" in record.message for record in caplog.records)


class TestIntelligenceCycleRecordsSchemaErrorStructurally:
    """The full cycle must surface a goal_progress schema error in its
    returned `errors` list — not only a warning log indistinguishable from
    the ordinary case of a user having no goal-progress rows."""

    def _base_patches(self):
        return [
            patch("app.services.intelligence_engine._fetch_active_users", return_value=[{"id": "u1", "auth_id": "auth-1"}]),
            patch("app.services.intelligence_engine._fetch_goals_by_user", return_value={"auth-1": [{"id": "g-1", "user_id": "auth-1", "goal_name": "Test", "target_amount": 1000, "status": "active"}]}),
            patch("app.services.intelligence_engine._fetch_alerts_by_user", return_value={"auth-1": []}),
            patch("app.services.intelligence_engine._fetch_positions_by_user", return_value={"auth-1": []}),
            patch("app.services.intelligence_engine._fetch_plans_by_user", return_value={"auth-1": None}),
            patch("app.services.intelligence_engine._fetch_unread_digest_types", return_value={"auth-1": set()}),
            patch("app.services.intelligence_engine._fetch_announced_plan_milestones", return_value={"auth-1": set()}),
            patch("app.services.intelligence_engine._fetch_top_10_stocks", return_value=(set(), {})),
        ]

    def test_schema_error_recorded_in_cycle_errors_not_only_warned(self):
        patches = self._base_patches()
        for p in patches:
            p.start()
        try:
            with patch(
                "app.services.intelligence_engine._fetch_goal_progress",
                side_effect=GoalProgressSchemaError("meridian.goal_progress schema mismatch: code=42703"),
            ):
                result = _run_intelligence_cycle_sync()
        finally:
            for p in patches:
                p.stop()

        assert result["users_processed"] == 1
        assert any(e.get("stage") == "goal_progress_fetch" for e in result["errors"])

    def test_cycle_still_completes_without_goal_data_when_schema_fails(self):
        """Safe fallback: the cycle keeps processing other digest conditions
        (e.g. risk alerts) even though goal-progress data was unavailable."""
        patches = self._base_patches()
        for p in patches:
            p.start()
        try:
            with patch("app.services.intelligence_engine._fetch_alerts_by_user", return_value={"auth-1": [{"severity": "high", "alert_title": "Concentration risk"}]}):
                with patch(
                    "app.services.intelligence_engine._fetch_goal_progress",
                    side_effect=GoalProgressSchemaError("boom"),
                ):
                    result = _run_intelligence_cycle_sync()
        finally:
            for p in patches:
                p.stop()

        assert result["digests_generated"] == 1
        assert any(e.get("stage") == "goal_progress_fetch" for e in result["errors"])
