"""Log-redaction tests (Part 4).

Proves that sensitive values never survive into structured logs, whether they
arrive as dict keys or embedded inside free-text string values.
"""
from __future__ import annotations

import json

import pytest

from app.middleware.correlation import redact_mapping, redact_text

# A realistic (fake) JWT — header.payload.signature, all base64url.
FAKE_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiIxMjMiLCJyb2xlIjoic2VydmljZV9yb2xlIn0."
    "abc123SIGNATURExyz456_-def"
)


# ── value-embedded secrets (redact_text) ────────────────────────────────────

def test_redacts_raw_jwt_in_text():
    out = redact_text(f"verifying token {FAKE_JWT} for user")
    assert FAKE_JWT not in out
    assert "[REDACTED_JWT]" in out


def test_redacts_authorization_bearer_header_value():
    out = redact_text(f"Authorization: Bearer {FAKE_JWT}")
    assert FAKE_JWT not in out
    assert "Bearer [REDACTED]" in out


def test_redacts_openai_api_key():
    out = redact_text("using key sk-proj-ABCDEF0123456789abcdef to call OpenAI")
    assert "sk-proj-ABCDEF0123456789abcdef" not in out
    assert "[REDACTED_KEY]" in out


def test_redacts_postgres_connection_string():
    uri = "postgresql://dbuser:s3cr3tpw@db.internal:5432/appdb"
    out = redact_text(f"connecting to {uri}")
    assert "s3cr3tpw" not in out
    assert "dbuser" not in out
    assert "[REDACTED_URI]" in out


def test_redacts_redis_connection_string():
    out = redact_text("redis at redis://:supersecret@cache.internal:6379/0")
    assert "supersecret" not in out
    assert "[REDACTED_URI]" in out


def test_redacts_inline_password_and_secret():
    assert "hunter2" not in redact_text("password=hunter2")
    assert "topsecret" not in redact_text("client_secret: topsecret")
    assert "abc123" not in redact_text("api_key=abc123")


# ── key-based redaction (redact_mapping) ────────────────────────────────────

@pytest.mark.parametrize(
    "key,value",
    [
        ("authorization", "Bearer xyz"),
        ("password", "hunter2"),
        ("service_role_key", "svc-role-abc"),
        ("supabase_jwt_secret", "jwt-secret-abc"),
        ("openai_api_key", "sk-abcdef012345"),
        ("client_secret", "oauth-client-secret"),
        ("database_url", "postgres://u:p@h/db"),
        ("ssn", "123-45-6789"),
        ("account_number", "000123456789"),
        ("card_number", "4111111111111111"),
    ],
)
def test_sensitive_keys_are_redacted(key, value):
    out = redact_mapping({key: value})
    assert out[key] == "[REDACTED]"
    assert value not in json.dumps(out)


def test_nested_and_list_values_are_redacted():
    payload = {
        "outer": {"password": "hunter2", "note": f"jwt {FAKE_JWT}"},
        "items": [{"api_key": "sk-secretkey123"}, f"Bearer {FAKE_JWT}"],
        "safe": "gpt-5 model, status ok",
    }
    out = redact_mapping(payload)
    blob = json.dumps(out)
    assert "hunter2" not in blob
    assert FAKE_JWT not in blob
    assert "sk-secretkey123" not in blob
    # Non-sensitive content is preserved.
    assert out["safe"] == "gpt-5 model, status ok"


def test_service_role_jwt_value_in_message_is_scrubbed():
    # Supabase service-role keys are JWTs; they must never appear in a log line.
    msg = f"startup used SUPABASE_SERVICE_ROLE_KEY={FAKE_JWT}"
    out = redact_mapping({"msg": msg})
    assert FAKE_JWT not in out["msg"]


def test_financial_data_keys_redacted():
    out = redact_mapping({"balance": 1000, "routing_number": "021000021", "cvv": "123"})
    assert out["routing_number"] == "[REDACTED]"
    assert out["cvv"] == "[REDACTED]"


def test_non_secret_text_is_unchanged():
    # Redaction must not corrupt ordinary log content.
    for s in ["GET /api/chat 200", "user advanced tier", "https://app.example.com/dashboard"]:
        assert redact_text(s) == s
