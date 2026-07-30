"""Tests for the Phase 12 environment/config validator."""
from __future__ import annotations

import pytest

from app.env_validation import (
    STARTUP_FATAL_CODES,
    Severity,
    enforce_startup_environment,
    validate_environment,
)


def _valid_prod_env(**overrides) -> dict:
    """A clean, valid production environment mapping."""
    env = {
        "ENVIRONMENT": "production",
        "SUPABASE_URL": "https://real-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "svc-role-real-value-abc123",
        "SUPABASE_JWT_SECRET": "jwt-secret-real-value-abc123",
        "OPENAI_API_KEY": "sk-real-value-abc123",
        "AUTH_REQUIRED": "true",
        "ENABLE_DEBUG_ROUTES": "false",
        "CORS_ORIGINS": "https://app.example.com",
        "TRUSTED_HOSTS": "app.example.com,api.example.com",
        "REDIS_URL": "redis://cache.internal:6379/0",
        "OPENAI_CHAT_MODEL": "gpt-5",
        "OPENAI_MAX_TOKENS": "8000",
    }
    env.update(overrides)
    return env


def _codes(report) -> set[str]:
    return {f.code for f in report.findings}


# ── happy path ──────────────────────────────────────────────────────────────

def test_clean_production_env_passes():
    report = validate_environment(_valid_prod_env())
    assert report.ok is True
    assert report.errors == []


# ── required config / placeholders ──────────────────────────────────────────

def test_missing_required_is_error_in_production():
    env = _valid_prod_env()
    del env["OPENAI_API_KEY"]
    report = validate_environment(env)
    assert report.ok is False
    assert "missing_required" in _codes(report)


def test_placeholder_value_is_error():
    report = validate_environment(_valid_prod_env(SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"))
    assert report.ok is False
    assert "placeholder_value" in _codes(report)


def test_missing_required_is_only_warning_in_development():
    report = validate_environment({"ENVIRONMENT": "development"})
    assert report.ok is True  # no ERROR in dev
    assert any(f.severity is Severity.WARNING for f in report.findings)


# ── auth / debug ────────────────────────────────────────────────────────────

def test_auth_disabled_in_production_is_error():
    report = validate_environment(_valid_prod_env(AUTH_REQUIRED="false"))
    assert report.ok is False
    assert "auth_disabled" in _codes(report)


def test_debug_routes_enabled_in_production_is_error():
    report = validate_environment(_valid_prod_env(ENABLE_DEBUG_ROUTES="true"))
    assert report.ok is False
    assert "debug_routes_enabled" in _codes(report)


# ── CORS / trusted hosts ────────────────────────────────────────────────────

def test_cors_wildcard_is_error():
    report = validate_environment(_valid_prod_env(CORS_ORIGINS="*"))
    assert report.ok is False
    assert "cors_wildcard_or_empty" in _codes(report)


def test_trusted_hosts_wildcard_is_error():
    report = validate_environment(_valid_prod_env(TRUSTED_HOSTS="*"))
    assert report.ok is False
    assert "trusted_hosts_wildcard_or_empty" in _codes(report)


# ── fail-open cost / rate controls ──────────────────────────────────────────

@pytest.mark.parametrize(
    "flag",
    ["AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE", "AI_BUDGET_ALLOW_IN_MEMORY", "ALLOW_IN_MEMORY_RATE_LIMIT"],
)
def test_unsafe_fail_open_flags_are_errors_in_production(flag):
    report = validate_environment(_valid_prod_env(**{flag: "true"}))
    assert report.ok is False
    assert "unsafe_flag_enabled" in _codes(report)
    assert any(f.key == flag for f in report.errors)


def test_unsafe_flags_allowed_in_development():
    report = validate_environment(
        {"ENVIRONMENT": "development", "AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE": "true"}
    )
    assert "unsafe_flag_enabled" not in _codes(report)


# ── redis / ceiling / model ─────────────────────────────────────────────────

def test_missing_redis_in_production_is_warning():
    env = _valid_prod_env()
    del env["REDIS_URL"]
    report = validate_environment(env)
    assert "redis_missing" in _codes(report)
    # A warning, not a hard error.
    assert report.ok is True


def test_invalid_max_tokens_is_error():
    assert not validate_environment(_valid_prod_env(OPENAI_MAX_TOKENS="0")).ok
    assert not validate_environment(_valid_prod_env(OPENAI_MAX_TOKENS="-5")).ok
    assert not validate_environment(_valid_prod_env(OPENAI_MAX_TOKENS="notanint")).ok


# ── cross-environment contamination ─────────────────────────────────────────

def test_production_resource_in_staging_is_error():
    report = validate_environment(
        {
            "ENVIRONMENT": "staging",
            "SUPABASE_URL": "https://prod-abc.supabase.co",
            "PRODUCTION_RESOURCE_DENYLIST": "prod-abc.supabase.co",
        }
    )
    assert report.ok is False
    assert "production_resource_in_nonprod" in _codes(report)


def test_staging_resource_in_production_is_error():
    report = validate_environment(
        _valid_prod_env(
            SUPABASE_URL="https://staging-xyz.supabase.co",
            STAGING_RESOURCE_DENYLIST="staging-xyz.supabase.co",
        )
    )
    assert report.ok is False
    assert "staging_resource_in_prod" in _codes(report)


# ── secret-safety of the report ─────────────────────────────────────────────

def test_report_never_leaks_secret_values():
    secret = "sk-super-secret-value-should-never-appear"
    report = validate_environment(_valid_prod_env(OPENAI_API_KEY=f"your-{secret}"))
    text = report.format_text()
    blob = str(report.to_dict())
    assert secret not in text
    assert secret not in blob
    # But it must still name the offending key.
    assert "OPENAI_API_KEY" in text


# ── staging is strict too ───────────────────────────────────────────────────

def test_staging_is_strict():
    env = _valid_prod_env(ENVIRONMENT="staging", AUTH_REQUIRED="false")
    report = validate_environment(env)
    assert report.ok is False
    assert "auth_disabled" in _codes(report)


def test_staging_missing_required_is_error():
    report = validate_environment({"ENVIRONMENT": "staging"})
    assert report.ok is False
    assert "missing_required" in _codes(report)


# ── startup enforcer ────────────────────────────────────────────────────────

def test_enforce_raises_in_production_on_auth_disabled():
    with pytest.raises(RuntimeError, match="refusing to start"):
        enforce_startup_environment(_valid_prod_env(AUTH_REQUIRED="false"))


def test_enforce_raises_on_debug_routes_and_bad_ceiling():
    with pytest.raises(RuntimeError):
        enforce_startup_environment(_valid_prod_env(ENABLE_DEBUG_ROUTES="true"))
    with pytest.raises(RuntimeError):
        enforce_startup_environment(_valid_prod_env(OPENAI_MAX_TOKENS="0"))


def test_enforce_raises_on_cross_env_contamination():
    with pytest.raises(RuntimeError):
        enforce_startup_environment(
            _valid_prod_env(
                SUPABASE_URL="https://staging-xyz.supabase.co",
                STAGING_RESOURCE_DENYLIST="staging-xyz.supabase.co",
            )
        )


def test_enforce_defers_inmemory_flags_to_service_validators():
    # In-memory / fail-open flags are ERROR findings but NOT startup-fatal here
    # (the app's dedicated rate-limit/budget validators own that policy).
    env = _valid_prod_env(
        AI_BUDGET_ALLOW_IN_MEMORY="true",
        ALLOW_IN_MEMORY_RATE_LIMIT="true",
        AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE="true",
    )
    report = enforce_startup_environment(env)  # must NOT raise
    assert "unsafe_flag_enabled" in _codes(report)
    assert all(c not in STARTUP_FATAL_CODES for c in {"unsafe_flag_enabled", "redis_missing"})


def test_enforce_is_lenient_in_development():
    # Missing everything in dev must not raise.
    report = enforce_startup_environment({"ENVIRONMENT": "development"})
    assert report is not None


def test_enforce_passes_clean_production():
    report = enforce_startup_environment(_valid_prod_env())
    assert report.ok is True
