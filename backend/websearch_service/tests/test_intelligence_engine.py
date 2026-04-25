"""Tests for intelligence_engine.py — bulk fetchers, evaluate_user, cycle logic."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.services.intelligence_engine import (
    _evaluate_user,
    _fetch_active_users,
    _fetch_alerts_by_user,
    _fetch_announced_plan_milestones,
    _fetch_goal_progress,
    _fetch_goals_by_user,
    _fetch_plans_by_user,
    _fetch_positions_by_user,
    _fetch_top_10_stocks,
    _fetch_unread_digest_types,
    _run_intelligence_cycle_sync,
    run_intelligence_cycle,
)


# ── Mock factory ───────────────────────────────────────────────────────────────

def _tbl_mock(data):
    chain = MagicMock()
    result = MagicMock()
    result.data = data
    chain.execute.return_value = result
    chain.select.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.limit.return_value = chain
    chain.eq.return_value = chain
    chain.in_.return_value = chain
    chain.order.return_value = chain
    chain.filter.return_value = chain
    chain.insert.return_value = chain
    return chain


def _client_with_tables(table_data: dict):
    """table_data = {(schema, table): list_of_rows}"""
    client = MagicMock()

    def schema_fn(schema_name):
        s = MagicMock()

        def table_fn(table_name):
            data = table_data.get((schema_name, table_name), [])
            return _tbl_mock(data)

        s.table = MagicMock(side_effect=table_fn)
        return s

    client.schema = MagicMock(side_effect=schema_fn)
    return client


# ── Bulk fetchers ──────────────────────────────────────────────────────────────

class TestFetchActiveUsers:
    def test_returns_rows(self):
        users = [{"id": "cu-1", "auth_id": "auth-1"}]
        client = _client_with_tables({("core", "users"): users})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_active_users("2026-03-01T00:00:00+00:00")
        assert result == users

    def test_returns_empty_list_when_no_users(self):
        client = _client_with_tables({("core", "users"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_active_users("2026-03-01T00:00:00+00:00")
        assert result == []


class TestFetchGoalsByUser:
    def test_groups_by_user_id(self):
        goals = [
            {"id": "g1", "user_id": "u1", "goal_name": "House",
             "target_amount": 50000, "current_amount": 20000, "status": "active"},
            {"id": "g2", "user_id": "u2", "goal_name": "Car",
             "target_amount": 10000, "current_amount": 5000, "status": "active"},
        ]
        client = _client_with_tables({("meridian", "user_goals"): goals})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_goals_by_user(["u1", "u2"])
        assert len(result["u1"]) == 1
        assert result["u1"][0]["goal_name"] == "House"
        assert len(result["u2"]) == 1

    def test_unknown_user_id_ignored(self):
        goals = [{"id": "g1", "user_id": "u-unknown", "goal_name": "X",
                  "target_amount": 1000, "current_amount": 0, "status": "active"}]
        client = _client_with_tables({("meridian", "user_goals"): goals})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_goals_by_user(["u1"])
        assert result["u1"] == []


class TestFetchGoalProgress:
    def test_empty_goal_ids_returns_empty(self):
        client = _client_with_tables({})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_goal_progress([])
        assert result == {}

    def test_groups_by_goal_id(self):
        progress = [
            {"goal_id": "g1", "period": "2026-03", "actual_amount": 800,
             "target_amount": 1000, "on_track": False},
            {"goal_id": "g1", "period": "2026-02", "actual_amount": 900,
             "target_amount": 1000, "on_track": True},
        ]
        client = _client_with_tables({("meridian", "goal_progress"): progress})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_goal_progress(["g1"])
        assert len(result["g1"]) == 2


class TestFetchAlertsByUser:
    def test_groups_unresolved_alerts(self):
        alerts = [
            {"user_id": "u1", "severity": "high", "alert_title": "Overexposed",
             "resolved": False},
        ]
        client = _client_with_tables({("meridian", "risk_alerts"): alerts})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_alerts_by_user(["u1"])
        assert len(result["u1"]) == 1


class TestFetchPositionsByUser:
    def test_groups_by_user_id(self):
        positions = [
            {"user_id": "u1", "ticker": "AAPL", "quantity": 10},
        ]
        client = _client_with_tables({("meridian", "user_positions"): positions})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_positions_by_user(["u1"])
        assert len(result["u1"]) == 1
        assert result["u1"][0]["ticker"] == "AAPL"


class TestFetchPlansByUser:
    def test_returns_first_plan_per_user(self):
        plans = [
            {"user_id": "u1", "plan_name": "Retirement",
             "target_amount": 500000, "current_amount": 250000,
             "target_date": "2040-01-01"},
        ]
        client = _client_with_tables({("meridian", "financial_plans"): plans})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_plans_by_user(["u1"])
        assert result["u1"]["plan_name"] == "Retirement"

    def test_no_plan_returns_none(self):
        client = _client_with_tables({("meridian", "financial_plans"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_plans_by_user(["u1"])
        assert result["u1"] is None


class TestFetchUnreadDigestTypes:
    def test_groups_by_user_id(self):
        digests = [
            {"user_id": "u1", "digest_type": "risk_alert"},
            {"user_id": "u1", "digest_type": "goal_alert"},
        ]
        client = _client_with_tables({("meridian", "intelligence_digests"): digests})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_unread_digest_types(["u1"])
        assert result["u1"] == {"risk_alert", "goal_alert"}


class TestFetchAnnouncedPlanMilestones:
    def test_parses_milestone_from_headline(self):
        digests = [
            {"user_id": "u1", "headline": "Milestone: My Plan is 50% complete"},
        ]
        client = _client_with_tables({("meridian", "intelligence_digests"): digests})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_announced_plan_milestones(["u1"])
        assert 50 in result["u1"]

    def test_multiple_milestones(self):
        digests = [
            {"user_id": "u1", "headline": "Milestone: Plan is 25% complete"},
            {"user_id": "u1", "headline": "Milestone: Plan is 75% complete"},
        ]
        client = _client_with_tables({("meridian", "intelligence_digests"): digests})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_announced_plan_milestones(["u1"])
        assert 25 in result["u1"]
        assert 75 in result["u1"]

    def test_no_milestones_returns_empty_set(self):
        client = _client_with_tables({("meridian", "intelligence_digests"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _fetch_announced_plan_milestones(["u1"])
        assert result["u1"] == set()


class TestFetchTop10Stocks:
    def test_empty_history_returns_empty(self):
        client = _client_with_tables({("market", "stock_ranking_history"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            tickers, scores = _fetch_top_10_stocks()
        assert tickers == set()
        assert scores == {}

    def test_returns_top_10(self):
        # Step 1: latest scored_at
        history_latest = [{"scored_at": "2026-04-24T01:00:00"}]
        history_snap = [
            {"ticker": f"T{i}", "composite_score": 100.0 - i}
            for i in range(15)
        ]

        call_count = [0]

        def schema_fn(schema_name):
            s = MagicMock()

            def table_fn(table_name):
                tbl = _tbl_mock([])
                if schema_name == "market" and table_name == "stock_ranking_history":
                    call_count[0] += 1
                    if call_count[0] == 1:
                        # first call → latest snapshot
                        r = MagicMock()
                        r.data = history_latest
                        tbl.execute.return_value = r
                    else:
                        r = MagicMock()
                        r.data = history_snap
                        tbl.execute.return_value = r
                return tbl

            s.table = MagicMock(side_effect=table_fn)
            return s

        client = MagicMock()
        client.schema = MagicMock(side_effect=schema_fn)

        with patch("app.services.intelligence_engine.supabase_client", client):
            tickers, scores = _fetch_top_10_stocks()

        assert len(tickers) == 10
        assert "T0" in tickers  # highest score
        assert "T0" in scores


# ── _evaluate_user ─────────────────────────────────────────────────────────────

class TestEvaluateUser:
    def _base_args(self, **kwargs):
        defaults = dict(
            alerts=[],
            goals=[],
            goal_progress_by_goal_id={},
            positions=[],
            plan=None,
            top_10_tickers=set(),
            ticker_scores={},
            announced_milestones=set(),
        )
        defaults.update(kwargs)
        return defaults

    def test_no_conditions_returns_none(self):
        result = _evaluate_user(**self._base_args())
        assert result is None

    def test_high_severity_alert_triggers_risk_digest(self):
        alerts = [{"severity": "high", "alert_title": "Overexposed",
                   "alert_description": "You are overexposed to tech."}]
        result = _evaluate_user(**self._base_args(alerts=alerts))
        assert result is not None
        assert result["digest_type"] == "risk_alert"
        assert "Overexposed" in result["headline"]

    def test_low_severity_alert_ignored(self):
        alerts = [{"severity": "low", "alert_title": "Minor",
                   "alert_description": "Nothing critical."}]
        result = _evaluate_user(**self._base_args(alerts=alerts))
        assert result is None

    def test_goal_behind_target_triggers_goal_alert(self):
        goals = [{"id": "g1", "goal_name": "House fund"}]
        progress = {"g1": [{"on_track": False, "target_amount": 1000, "actual_amount": 700}]}
        result = _evaluate_user(**self._base_args(goals=goals, goal_progress_by_goal_id=progress))
        assert result is not None
        assert result["digest_type"] == "goal_alert"
        assert "behind target" in result["headline"]

    def test_goal_on_track_ignored(self):
        goals = [{"id": "g1", "goal_name": "House fund"}]
        progress = {"g1": [{"on_track": True, "target_amount": 1000, "actual_amount": 900}]}
        result = _evaluate_user(**self._base_args(goals=goals, goal_progress_by_goal_id=progress))
        assert result is None

    def test_goal_no_progress_ignored(self):
        goals = [{"id": "g1", "goal_name": "House fund"}]
        result = _evaluate_user(**self._base_args(goals=goals, goal_progress_by_goal_id={}))
        assert result is None

    def test_position_in_top_10_high_score_triggers_signal(self):
        positions = [{"ticker": "AAPL"}]
        result = _evaluate_user(**self._base_args(
            positions=positions,
            top_10_tickers={"AAPL"},
            ticker_scores={"AAPL": 80.0},
        ))
        assert result is not None
        assert result["digest_type"] == "position_signal"
        assert "AAPL" in result["headline"]

    def test_position_in_top_10_low_score_ignored(self):
        positions = [{"ticker": "AAPL"}]
        result = _evaluate_user(**self._base_args(
            positions=positions,
            top_10_tickers={"AAPL"},
            ticker_scores={"AAPL": 70.0},  # < 75 threshold
        ))
        assert result is None

    def test_position_not_in_top_10_ignored(self):
        positions = [{"ticker": "XYZ"}]
        result = _evaluate_user(**self._base_args(
            positions=positions,
            top_10_tickers={"AAPL"},
            ticker_scores={"AAPL": 80.0},
        ))
        assert result is None

    def test_plan_milestone_25_pct(self):
        plan = {"plan_name": "Retire", "target_amount": 100000,
                "current_amount": 28000, "target_date": "2040-01-01"}
        result = _evaluate_user(**self._base_args(plan=plan))
        assert result is not None
        assert result["digest_type"] == "plan_milestone"
        assert "25%" in result["headline"]

    def test_plan_milestone_50_pct(self):
        plan = {"plan_name": "Retire", "target_amount": 100000,
                "current_amount": 55000, "target_date": "2040-01-01"}
        result = _evaluate_user(**self._base_args(plan=plan))
        assert result["digest_type"] == "plan_milestone"
        assert "50%" in result["headline"]

    def test_plan_milestone_75_pct(self):
        plan = {"plan_name": "Retire", "target_amount": 100000,
                "current_amount": 76000, "target_date": "2040-01-01"}
        result = _evaluate_user(**self._base_args(plan=plan))
        assert result["digest_type"] == "plan_milestone"
        assert "75%" in result["headline"]

    def test_plan_milestone_already_announced_skipped(self):
        plan = {"plan_name": "Retire", "target_amount": 100000,
                "current_amount": 55000, "target_date": "2040-01-01"}
        # 55% → reaches 25 and 50; both announced → nothing to fire
        result = _evaluate_user(**self._base_args(plan=plan, announced_milestones={25, 50}))
        assert result is None

    def test_plan_zero_target_no_division_error(self):
        plan = {"plan_name": "Retire", "target_amount": 0,
                "current_amount": 0, "target_date": "2040-01-01"}
        result = _evaluate_user(**self._base_args(plan=plan))
        assert result is None

    def test_alert_with_alternate_column_names(self):
        alerts = [{"severity": "high", "title": "Test Alert",
                   "description": "Something bad happened."}]
        result = _evaluate_user(**self._base_args(alerts=alerts))
        assert result is not None
        assert "Test Alert" in result["headline"]

    def test_alert_fallback_column_names(self):
        alerts = [{"severity": "high", "alert_type": "CONCENTRATION_RISK",
                   "message": "Too concentrated."}]
        result = _evaluate_user(**self._base_args(alerts=alerts))
        assert result is not None
        assert "CONCENTRATION_RISK" in result["headline"]

    def test_priority_alert_beats_goal(self):
        alerts = [{"severity": "high", "alert_title": "Alert!",
                   "alert_description": "Act now."}]
        goals = [{"id": "g1", "goal_name": "House"}]
        progress = {"g1": [{"on_track": False, "target_amount": 1000, "actual_amount": 700}]}
        result = _evaluate_user(**self._base_args(
            alerts=alerts, goals=goals, goal_progress_by_goal_id=progress
        ))
        assert result["digest_type"] == "risk_alert"


# ── _run_intelligence_cycle_sync ───────────────────────────────────────────────

class TestRunIntelligenceCycleSync:
    def test_no_active_users_returns_zero(self):
        client = _client_with_tables({("core", "users"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _run_intelligence_cycle_sync()
        assert result["users_processed"] == 0
        assert result["digests_generated"] == 0

    def test_fetch_active_users_exception_aborts(self):
        client = MagicMock()
        client.schema.side_effect = Exception("DB down")
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _run_intelligence_cycle_sync()
        assert result["users_processed"] == 0

    def test_one_user_with_alert_generates_digest(self):
        users = [{"id": "cu-1", "auth_id": "auth-1"}]
        alerts = [{"user_id": "auth-1", "severity": "high",
                   "alert_title": "Alert", "alert_description": "Details",
                   "resolved": False}]
        tables = {
            ("core", "users"): users,
            ("meridian", "user_goals"): [],
            ("meridian", "goal_progress"): [],
            ("meridian", "risk_alerts"): alerts,
            ("meridian", "user_positions"): [],
            ("meridian", "financial_plans"): [],
            ("meridian", "intelligence_digests"): [],
            ("market", "stock_ranking_history"): [],
        }
        client = _client_with_tables(tables)
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _run_intelligence_cycle_sync()
        assert result["users_processed"] == 1
        assert result["digests_generated"] == 1

    def test_duplicate_digest_skipped(self):
        users = [{"id": "cu-1", "auth_id": "auth-1"}]
        alerts = [{"user_id": "auth-1", "severity": "high",
                   "alert_title": "Alert", "alert_description": "Details",
                   "resolved": False}]
        # Simulate existing unread risk_alert
        existing_digests = [{"user_id": "auth-1", "digest_type": "risk_alert",
                              "headline": "old", "is_read": False}]
        tables = {
            ("core", "users"): users,
            ("meridian", "user_goals"): [],
            ("meridian", "goal_progress"): [],
            ("meridian", "risk_alerts"): alerts,
            ("meridian", "user_positions"): [],
            ("meridian", "financial_plans"): [],
            ("meridian", "intelligence_digests"): existing_digests,
            ("market", "stock_ranking_history"): [],
        }
        client = _client_with_tables(tables)
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = _run_intelligence_cycle_sync()
        # Already has unread risk_alert — no new digest written
        assert result["digests_generated"] == 0


# ── run_intelligence_cycle (async + lock) ────────────────────────────────────

class TestRunIntelligenceCycle:
    def test_skips_when_already_running(self):
        import app.services.intelligence_engine as eng
        eng._cycle_running = True
        try:
            result = asyncio.get_event_loop().run_until_complete(run_intelligence_cycle())
            assert result["skipped"] is True
        finally:
            eng._cycle_running = False

    def test_runs_and_resets_lock(self):
        import app.services.intelligence_engine as eng
        client = _client_with_tables({("core", "users"): []})
        with patch("app.services.intelligence_engine.supabase_client", client):
            result = asyncio.get_event_loop().run_until_complete(run_intelligence_cycle())
        assert "users_processed" in result
        assert eng._cycle_running is False

    def test_unhandled_exception_returns_error_dict(self):
        with patch(
            "app.services.intelligence_engine._run_intelligence_cycle_sync",
            side_effect=RuntimeError("unexpected"),
        ):
            result = asyncio.get_event_loop().run_until_complete(run_intelligence_cycle())
        assert result["users_processed"] == 0
        assert len(result["errors"]) > 0
