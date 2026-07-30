"""Tests for the durable audit trail service (app/services/audit.py).

Covers: redaction of raw PII, pseudonymization, the dev-only local fallback,
service-role DB insert path, and fail-closed behaviour for mandatory
(destructive-operation) audit records.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.audit import (
    AuditPersistenceError,
    _redact,
    audit_log,
    pseudonymize,
    validate_audit_configuration,
)


# ---------------------------------------------------------------------------
# Dev-only local fallback (ENVIRONMENT=test, set globally in conftest.py)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_dev_fallback_creates_file(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("test_event", {"key": "value"})

    assert log_path.exists()
    with open(log_path) as f:
        lines = f.readlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["action"] == "test_event"
        assert entry["metadata"] == {"key": "value"}
        assert "created_at" in entry


@pytest.mark.asyncio
async def test_audit_log_dev_fallback_appends_entries(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("event1", {"data": "1"})
    await audit_log("event2", {"data": "2"})

    with open(log_path) as f:
        lines = f.readlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["action"] == "event1"
    assert json.loads(lines[1])["action"] == "event2"


@pytest.mark.asyncio
async def test_audit_log_dev_fallback_creates_directory(tmp_path, monkeypatch):
    log_path = tmp_path / "subdir" / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("test_event", {"key": "value"})

    assert log_path.exists()


# ---------------------------------------------------------------------------
# Redaction — no raw email/prompt/token/secret/portfolio data
# ---------------------------------------------------------------------------


def test_redact_strips_email_keys():
    # "reason" is a structural key (promoted to reason_code elsewhere) and is
    # intentionally dropped by _redact — only non-structural keys pass through.
    redacted = _redact({"target_email": "person@example.com", "note": "abuse"})
    assert redacted["target_email"] == "[REDACTED]"
    assert redacted["note"] == "abuse"


def test_redact_strips_tokens_and_secrets():
    data = {
        "confirmation_token": "supersecret",
        "access_token": "eyJ...",
        "api_key": "sk-live-xxx",
        "password": "hunter2",
        "authorization": "Bearer xyz",
    }
    redacted = _redact(data)
    assert all(v == "[REDACTED]" for v in redacted.values())


def test_redact_strips_prompts_and_portfolio_data():
    data = {
        "prompt": "what should I invest in?",
        "portfolio": {"AAPL": 100},
        "holdings": [{"symbol": "AAPL"}],
        "balance": 50000,
    }
    redacted = _redact(data)
    assert all(v == "[REDACTED]" for v in redacted.values())


def test_redact_recurses_into_nested_dicts():
    redacted = _redact({"outer": {"email": "a@b.com", "safe": "ok"}})
    assert redacted["outer"]["email"] == "[REDACTED]"
    assert redacted["outer"]["safe"] == "ok"


def test_redact_recurses_into_lists_and_tuples():
    redacted = _redact({"items": [{"email": "victim@example.com"}, {"safe": "ok"}]})
    assert redacted["items"][0]["email"] == "[REDACTED]"
    assert redacted["items"][1]["safe"] == "ok"


@pytest.mark.asyncio
async def test_audit_log_metadata_never_contains_raw_email(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log(
        "admin.user_suspended",
        {"target_email": "victim@example.com", "reason": "policy violation"},
        actor_id="admin-uuid-1",
        target_id="user-uuid-1",
    )

    raw = log_path.read_text()
    assert "victim@example.com" not in raw
    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["metadata"]["target_email"] == "[REDACTED]"


# ---------------------------------------------------------------------------
# Pseudonymization
# ---------------------------------------------------------------------------


def test_pseudonymize_is_deterministic_and_one_way():
    a = pseudonymize("user@example.com")
    b = pseudonymize("user@example.com")
    assert a == b
    assert "user@example.com" not in a
    assert a != "user@example.com"


def test_pseudonymize_differs_by_input():
    assert pseudonymize("user-a@example.com") != pseudonymize("user-b@example.com")


def test_pseudonymize_none_is_none():
    assert pseudonymize(None) is None
    assert pseudonymize("") is None


def test_pseudonymize_requires_pepper_outside_dev(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)
    with pytest.raises(AuditPersistenceError):
        pseudonymize("someone@example.com")


def test_pseudonymize_treats_unset_environment_as_non_dev(monkeypatch):
    """A misconfigured deployment (ENVIRONMENT unset entirely) must fail
    toward the strict/DB-backed behavior, not silently default to the
    insecure dev-only pepper."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)
    with pytest.raises(AuditPersistenceError):
        pseudonymize("someone@example.com")


def test_validate_audit_configuration_fails_fast_without_pepper_in_production(monkeypatch):
    """Startup, not the first audit event, must catch a missing pepper."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)
    with pytest.raises(RuntimeError, match="AUDIT_PSEUDONYM_PEPPER"):
        validate_audit_configuration()


def test_validate_audit_configuration_passes_with_pepper_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUDIT_PSEUDONYM_PEPPER", "a-real-secret")
    validate_audit_configuration()


def test_validate_audit_configuration_noop_in_dev(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)
    validate_audit_configuration()


@pytest.mark.asyncio
async def test_audit_log_non_mandatory_survives_missing_pepper_in_production(monkeypatch):
    """Row construction (which calls pseudonymize()) must be covered by the
    same mandatory/best-effort policy as a persistence failure — a
    non-mandatory caller (e.g. admin job enqueue) must never be crashed by a
    misconfigured pepper."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)

    await audit_log("admin.job_enqueued", {"job_type": "ranking"}, actor_id="admin-1")


@pytest.mark.asyncio
async def test_audit_log_mandatory_raises_on_missing_pepper_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("AUDIT_PSEUDONYM_PEPPER", raising=False)

    with pytest.raises(AuditPersistenceError):
        await audit_log(
            "admin.user_suspended",
            {},
            actor_id="admin-1",
            target_id="user-1",
            mandatory=True,
        )


# ---------------------------------------------------------------------------
# Service-role DB insert path (production-like environments)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_uses_db_insert_outside_dev(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUDIT_PSEUDONYM_PEPPER", "test-pepper")

    fake_client = MagicMock()
    fake_table = MagicMock()
    fake_client.schema.return_value.table.return_value = fake_table
    fake_table.insert.return_value.execute.return_value = None

    with patch("app.services.supabase_client.supabase_client", fake_client):
        await audit_log(
            "admin.user_deleted",
            {"reason": "cleanup"},
            actor_id="admin-1",
            target_id="user-1",
            result="success",
            mandatory=True,
        )

    fake_client.schema.assert_called_with("core")
    fake_client.schema.return_value.table.assert_called_with("audit_events")
    inserted_row = fake_table.insert.call_args.args[0]
    assert inserted_row["action"] == "admin.user_deleted"
    assert inserted_row["result"] == "success"
    assert inserted_row["actor_pseudonymous_id"] is not None
    assert inserted_row["target_pseudonymous_id"] is not None
    # Never the raw identifiers.
    assert inserted_row["actor_pseudonymous_id"] != "admin-1"
    assert inserted_row["target_pseudonymous_id"] != "user-1"


@pytest.mark.asyncio
async def test_audit_log_mandatory_raises_when_db_insert_fails(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUDIT_PSEUDONYM_PEPPER", "test-pepper")

    fake_client = MagicMock()
    fake_client.schema.return_value.table.return_value.insert.return_value.execute.side_effect = RuntimeError(
        "connection refused"
    )

    with patch("app.services.supabase_client.supabase_client", fake_client):
        with pytest.raises(AuditPersistenceError):
            await audit_log(
                "admin.user_suspended",
                {"reason": "abuse"},
                actor_id="admin-1",
                target_id="user-1",
                mandatory=True,
            )


@pytest.mark.asyncio
async def test_audit_log_non_mandatory_swallows_db_failure(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUDIT_PSEUDONYM_PEPPER", "test-pepper")

    fake_client = MagicMock()
    fake_client.schema.return_value.table.return_value.insert.return_value.execute.side_effect = RuntimeError(
        "connection refused"
    )

    with patch("app.services.supabase_client.supabase_client", fake_client):
        # Best-effort events (e.g. provider-fallback telemetry) must never
        # crash the request path when the audit store has a transient issue.
        await audit_log("openai_fallback_perplexity", {"reason": "network_error"})


# ---------------------------------------------------------------------------
# Actor/target/result inference for existing (unstructured) call sites
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_promotes_user_id_to_pseudonymous_actor(tmp_path, monkeypatch):
    """chat/search call sites pass the verified Supabase auth UUID as
    data['user_id'] — it must become actor_pseudonymous_id, never survive
    raw in metadata."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("search_request", {"user_id": "11111111-1111-1111-1111-111111111111", "query_length": 5})

    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["actor_type"] == "user"
    assert entry["actor_pseudonymous_id"] is not None
    assert entry["actor_pseudonymous_id"] != "11111111-1111-1111-1111-111111111111"
    assert "user_id" not in entry["metadata"]
    assert "11111111-1111-1111-1111-111111111111" not in json.dumps(entry["metadata"])


@pytest.mark.asyncio
async def test_audit_log_infers_service_role_actor(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("admin.user_suspended", {"actor": "service-role", "target_auth_id": "user-1"})

    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["actor_type"] == "service_role"
    assert entry["actor_pseudonymous_id"] is None
    assert entry["target_type"] == "user"
    assert entry["target_pseudonymous_id"] is not None


@pytest.mark.asyncio
async def test_audit_log_defaults_result_to_success(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("rate_limit_abuse_detected", {"identifier": "1.2.3.4"})

    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["result"] == "success"


@pytest.mark.asyncio
async def test_audit_log_non_uuid_request_id_preserved_in_metadata(tmp_path, monkeypatch):
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("search_query", {}, request_id="not-a-uuid")

    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["request_id"] is None
    assert entry["metadata"]["client_request_id"] == "not-a-uuid"


@pytest.mark.asyncio
async def test_audit_log_rejects_unsafe_non_uuid_request_id(tmp_path, monkeypatch):
    """A client-supplied X-Request-ID is attacker-controlled input — anything
    that doesn't look like a plausible correlation id must be dropped, never
    passed through into metadata unvalidated."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))

    await audit_log("search_query", {}, request_id="victim@example.com; DROP TABLE x;--")

    entry = json.loads(log_path.read_text().splitlines()[0])
    assert entry["request_id"] is None
    assert "client_request_id" not in entry["metadata"]
