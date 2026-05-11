"""Tests for app.services.intelligence_engine — pure digest evaluation logic."""
from __future__ import annotations

from app.services.intelligence_engine import _evaluate_user


def _args(**overrides):
    defaults: dict = dict(
        alerts=[],
        goals=[],
        goal_progress_by_goal_id={},
        positions=[],
        plan=None,
        top_10_tickers=set(),
        ticker_scores={},
        announced_milestones=set(),
    )
    defaults.update(overrides)
    return defaults


# ─── Condition 1: High-severity unack'd risk alert ──────────────────────────

def test_high_severity_alert_produces_risk_digest():
    alerts = [
        {"severity": "high", "alert_title": "Concentration", "alert_description": "Too much AAPL"},
    ]
    result = _evaluate_user(**_args(alerts=alerts))
    assert result is not None
    assert result["digest_type"] == "risk_alert"
    assert "Concentration" in result["headline"]
    assert "Too much AAPL" in result["body"]


def test_medium_alert_does_not_trigger_risk_digest():
    alerts = [{"severity": "medium", "alert_title": "Minor thing"}]
    assert _evaluate_user(**_args(alerts=alerts)) is None


def test_high_alert_falls_back_to_default_copy_without_fields():
    alerts = [{"severity": "high"}]
    result = _evaluate_user(**_args(alerts=alerts))
    assert result["digest_type"] == "risk_alert"
    assert "Risk Alert" in result["headline"]


# ─── Condition 2: Goal behind target ────────────────────────────────────────

def test_goal_off_track_produces_goal_alert():
    goals = [{"id": "g-1", "goal_name": "Emergency Fund"}]
    progress = {"g-1": [{"on_track": False, "target_amount": 1000, "actual_amount": 600}]}

    result = _evaluate_user(**_args(goals=goals, goal_progress_by_goal_id=progress))
    assert result["digest_type"] == "goal_alert"
    assert "Emergency Fund" in result["headline"]
    assert "60.0%" in result["body"]


def test_goal_on_track_does_not_produce_digest():
    goals = [{"id": "g-1", "goal_name": "Deposit"}]
    progress = {"g-1": [{"on_track": True, "target_amount": 1000, "actual_amount": 1000}]}
    assert _evaluate_user(**_args(goals=goals, goal_progress_by_goal_id=progress)) is None


def test_goal_without_progress_records_is_skipped():
    goals = [{"id": "g-1", "goal_name": "x"}]
    assert _evaluate_user(**_args(goals=goals, goal_progress_by_goal_id={})) is None


def test_goal_with_zero_target_sets_pct_to_zero():
    goals = [{"id": "g-1", "goal_name": "x"}]
    progress = {"g-1": [{"on_track": False, "target_amount": 0, "actual_amount": 0}]}
    result = _evaluate_user(**_args(goals=goals, goal_progress_by_goal_id=progress))
    assert "0.0%" in result["body"]


# ─── Condition 3: Top-10 position signal ────────────────────────────────────

def test_top_10_position_with_strong_score_produces_signal():
    positions = [{"ticker": "AAPL"}]
    top_10 = {"AAPL", "NVDA"}
    scores = {"AAPL": 85.0}
    result = _evaluate_user(
        **_args(positions=positions, top_10_tickers=top_10, ticker_scores=scores)
    )
    assert result["digest_type"] == "position_signal"
    assert "AAPL" in result["headline"]
    assert "85" in result["body"]


def test_position_below_score_threshold_does_not_produce_signal():
    positions = [{"ticker": "AAPL"}]
    top_10 = {"AAPL"}
    scores = {"AAPL": 60.0}
    assert (
        _evaluate_user(**_args(positions=positions, top_10_tickers=top_10, ticker_scores=scores))
        is None
    )


def test_position_outside_top_10_does_not_produce_signal():
    positions = [{"ticker": "AAPL"}]
    top_10 = {"MSFT"}
    assert _evaluate_user(**_args(positions=positions, top_10_tickers=top_10)) is None


# ─── Condition 4: Plan milestone ────────────────────────────────────────────

def test_plan_milestone_announces_highest_unannounced():
    plan = {"plan_name": "House", "target_amount": 10_000, "current_amount": 8_000, "target_date": "2028"}
    # 80% complete, nothing announced.
    result = _evaluate_user(**_args(plan=plan, announced_milestones=set()))
    assert result["digest_type"] == "plan_milestone"
    assert "75%" in result["headline"]  # 75 is highest unannounced < 80


def test_plan_milestone_skips_already_announced():
    plan = {"plan_name": "House", "target_amount": 10_000, "current_amount": 8_000, "target_date": "2028"}
    result = _evaluate_user(**_args(plan=plan, announced_milestones={25, 50, 75}))
    assert result is None  # all milestones up to 80% already announced


def test_plan_milestone_returns_none_below_25():
    plan = {"plan_name": "House", "target_amount": 10_000, "current_amount": 1_000, "target_date": "2028"}
    assert _evaluate_user(**_args(plan=plan)) is None


def test_plan_milestone_guards_zero_target():
    plan = {"plan_name": "X", "target_amount": 0, "current_amount": 500, "target_date": "never"}
    assert _evaluate_user(**_args(plan=plan)) is None


# ─── Priority order ────────────────────────────────────────────────────────

def test_risk_alert_preempts_goal_alert():
    alerts = [{"severity": "high", "alert_title": "A"}]
    goals = [{"id": "g-1", "goal_name": "g"}]
    progress = {"g-1": [{"on_track": False, "target_amount": 1, "actual_amount": 0}]}
    result = _evaluate_user(**_args(alerts=alerts, goals=goals, goal_progress_by_goal_id=progress))
    assert result["digest_type"] == "risk_alert"


def test_goal_alert_preempts_position_signal():
    goals = [{"id": "g-1", "goal_name": "g"}]
    progress = {"g-1": [{"on_track": False, "target_amount": 1, "actual_amount": 0}]}
    positions = [{"ticker": "AAPL"}]
    result = _evaluate_user(
        **_args(
            goals=goals,
            goal_progress_by_goal_id=progress,
            positions=positions,
            top_10_tickers={"AAPL"},
            ticker_scores={"AAPL": 90.0},
        )
    )
    assert result["digest_type"] == "goal_alert"


def test_no_signals_returns_none():
    assert _evaluate_user(**_args()) is None
