"""Tests for the non-destructive recovery validator (Part 9).

Uses a fake SQL inspector so every database state is synthetic — no real DB,
and (by construction) no destructive operation is ever issued.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.recovery_validator import (
    CheckStatus,
    validate_recovery,
)

NOW = datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc)


def _good_state():
    return {
        "head": "0031",
        "schemas": ["core", "ai", "trading", "market", "academy", "meridian", "public"],
        "tables": ["core.users", "ai.chats", "ai.chat_messages", "trading.orders"],
        "extensions": ["uuid-ossp", "pgcrypto", "pg_stat_statements"],
        "functions": ["provision_user_profile"],
        "triggers": ["trg_user_provision"],
        "indexes": ["idx_chat_messages_session"],
        "orphaned": 0,
        "counts": {"core.users": 42, "ai.chat_messages": 100},
    }


def make_run_sql(state, *, raise_on_connect=False):
    def run_sql(sql, *params):
        s = " ".join(str(sql).lower().split())
        if raise_on_connect:
            raise ConnectionError("db unreachable")
        if s.startswith("select 1"):
            return [(1,)]
        if "alembic_version" in s:
            return [(state["head"],)] if state.get("head") is not None else []
        if "information_schema.schemata" in s:
            return [(x,) for x in state["schemas"]]
        if "information_schema.tables" in s:
            return [tuple(t.split(".")) for t in state["tables"]]
        if "pg_extension" in s:
            return [(x,) for x in state["extensions"]]
        if "pg_proc" in s:
            return [(x,) for x in state["functions"]]
        if "pg_trigger" in s:
            return [(x,) for x in state["triggers"]]
        if "pg_indexes" in s:
            return [(x,) for x in state["indexes"]]
        if "from auth.users" in s:
            return [(state.get("orphaned", 0),)]
        if s.startswith("select count(*) from"):
            for tbl, cnt in state.get("counts", {}).items():
                if tbl.lower() in s:
                    return [(cnt,)]
            return [(0,)]
        return []
    return run_sql


def _status(report, name):
    return next(c.status for c in report.checks if c.name == name)


# ── happy path ──────────────────────────────────────────────────────────────

def test_good_state_passes_all():
    report = validate_recovery(
        make_run_sql(_good_state()),
        expected_migration_head="0031",
        required_functions=["provision_user_profile"],
        required_triggers=["trg_user_provision"],
        required_indexes=["idx_chat_messages_session"],
        row_count_minimums={"core.users": 1},
        backup_metadata={"available": True, "last_backup_at": (NOW - timedelta(hours=3)).isoformat()},
        now=NOW,
    )
    assert report.ok is True
    assert _status(report, "connectivity") is CheckStatus.OK
    assert _status(report, "migration_head") is CheckStatus.OK
    assert _status(report, "auth_profile_provisioning") is CheckStatus.OK
    assert _status(report, "backup_metadata") is CheckStatus.OK


# ── failure modes ───────────────────────────────────────────────────────────

def test_connectivity_failure_short_circuits():
    report = validate_recovery(make_run_sql(_good_state(), raise_on_connect=True))
    assert report.ok is False
    assert _status(report, "connectivity") is CheckStatus.FAIL
    assert len(report.checks) == 1  # stopped immediately


def test_wrong_migration_head_fails():
    report = validate_recovery(make_run_sql(_good_state()), expected_migration_head="0030")
    assert report.ok is False
    assert _status(report, "migration_head") is CheckStatus.FAIL


def test_missing_schema_fails():
    state = _good_state()
    state["schemas"].remove("meridian")
    report = validate_recovery(make_run_sql(state))
    assert _status(report, "critical_schemas") is CheckStatus.FAIL


def test_missing_table_fails():
    state = _good_state()
    state["tables"].remove("ai.chat_messages")
    report = validate_recovery(make_run_sql(state))
    assert _status(report, "critical_tables") is CheckStatus.FAIL


def test_missing_extension_fails():
    state = _good_state()
    state["extensions"].remove("pgcrypto")
    report = validate_recovery(make_run_sql(state))
    assert _status(report, "required_extensions") is CheckStatus.FAIL


def test_row_count_below_minimum_fails():
    state = _good_state()
    state["counts"]["core.users"] = 0
    report = validate_recovery(make_run_sql(state), row_count_minimums={"core.users": 1})
    assert _status(report, "row_count[core.users]") is CheckStatus.FAIL


def test_orphaned_auth_users_fails_provisioning():
    state = _good_state()
    state["orphaned"] = 3
    report = validate_recovery(make_run_sql(state))
    assert _status(report, "auth_profile_provisioning") is CheckStatus.FAIL


# ── backup metadata ─────────────────────────────────────────────────────────

def test_stale_backup_fails():
    report = validate_recovery(
        make_run_sql(_good_state()),
        backup_metadata={"available": True, "last_backup_at": (NOW - timedelta(hours=48)).isoformat()},
        now=NOW,
    )
    assert _status(report, "backup_metadata") is CheckStatus.FAIL


def test_unavailable_backup_fails():
    report = validate_recovery(
        make_run_sql(_good_state()),
        backup_metadata={"available": False},
        now=NOW,
    )
    assert _status(report, "backup_metadata") is CheckStatus.FAIL


def test_missing_backup_metadata_skips():
    report = validate_recovery(make_run_sql(_good_state()), now=NOW)
    assert _status(report, "backup_metadata") is CheckStatus.SKIP


def test_unsafe_table_identifier_is_refused():
    report = validate_recovery(
        make_run_sql(_good_state()),
        row_count_minimums={"core.users; DROP TABLE core.users; --": 1},
    )
    assert _status(report, "row_count[core.users; DROP TABLE core.users; --]") is CheckStatus.FAIL


def test_report_to_dict_shape():
    report = validate_recovery(make_run_sql(_good_state()), expected_migration_head="0031", now=NOW)
    d = report.to_dict()
    assert set(d) == {"ok", "counts", "checks"}
    assert d["ok"] is True
    assert d["counts"]["ok"] >= 4
