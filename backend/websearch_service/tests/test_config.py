"""Tests for app.config — settings parsing and production validation."""
from __future__ import annotations

import pytest

from app.config import (
    AppSettings,
    TRUTHY_VALUES,
    get_app_settings,
    is_truthy,
    is_valid_origin,
    is_valid_trusted_host,
    parse_csv_env,
    validate_app_settings,
)


# ─── parse_csv_env ───────────────────────────────────────────────────────────

def test_parse_csv_env_returns_empty_list_for_none():
    assert parse_csv_env(None) == []


def test_parse_csv_env_returns_empty_list_for_empty_string():
    assert parse_csv_env("") == []


def test_parse_csv_env_splits_and_strips():
    assert parse_csv_env("a, b ,c") == ["a", "b", "c"]


def test_parse_csv_env_drops_blank_entries():
    # Whitespace-only entries between commas must not leak into output.
    assert parse_csv_env("a, ,b, ,") == ["a", "b"]


# ─── is_truthy ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", sorted(TRUTHY_VALUES))
def test_is_truthy_accepts_canonical_values(value: str):
    assert is_truthy(value) is True


@pytest.mark.parametrize("value", ["TRUE", "Yes", "On", " 1 "])
def test_is_truthy_case_insensitive_and_trims(value: str):
    assert is_truthy(value) is True


@pytest.mark.parametrize("value", [None, "", "false", "0", "no", "maybe"])
def test_is_truthy_rejects_non_truthy(value):
    assert is_truthy(value) is False


# ─── is_valid_origin ─────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:8080",
        "https://example.com",
        "https://sub.example.com:8443",
    ],
)
def test_is_valid_origin_accepts_http_and_https(origin: str):
    assert is_valid_origin(origin) is True


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "example.com",          # no scheme
        "ftp://example.com",    # non-http scheme
        "http://",              # no netloc
        "javascript:alert(1)",  # dangerous scheme
    ],
)
def test_is_valid_origin_rejects_malformed(origin: str):
    assert is_valid_origin(origin) is False


# ─── is_valid_trusted_host ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    "host",
    [
        "example.com",
        "api.example.com",
        "localhost",
    ],
)
def test_is_valid_trusted_host_accepts_bare_hostnames(host: str):
    assert is_valid_trusted_host(host) is True


@pytest.mark.parametrize(
    "host",
    [
        "",
        "http://example.com",
        "example.com/path",
        "//example.com",
    ],
)
def test_is_valid_trusted_host_rejects_urls_and_paths(host: str):
    assert is_valid_trusted_host(host) is False


# ─── get_app_settings ───────────────────────────────────────────────────────

def test_get_app_settings_defaults(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("APP_VERSION", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("TRUSTED_HOSTS", raising=False)
    monkeypatch.delenv("ENABLE_DEBUG_ROUTES", raising=False)

    settings = get_app_settings()

    assert settings.environment == "development"
    assert settings.app_version == "0.1.0"
    assert settings.cors_origins == []
    assert settings.trusted_hosts == []
    # Dev mode implicitly enables debug routes.
    assert settings.enable_debug_routes is True
    assert settings.is_production is False


def test_get_app_settings_normalises_environment(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "  PRODUCTION ")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.com,https://b.com")
    monkeypatch.setenv("TRUSTED_HOSTS", "a.com,b.com")

    settings = get_app_settings()

    assert settings.environment == "production"
    assert settings.is_production is True
    assert settings.cors_origins == ["https://a.com", "https://b.com"]
    assert settings.trusted_hosts == ["a.com", "b.com"]


def test_get_app_settings_production_debug_requires_explicit_opt_in(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ENABLE_DEBUG_ROUTES", raising=False)

    settings = get_app_settings()

    assert settings.enable_debug_routes is False

    monkeypatch.setenv("ENABLE_DEBUG_ROUTES", "true")
    settings = get_app_settings()
    assert settings.enable_debug_routes is True


# ─── validate_app_settings ──────────────────────────────────────────────────

def _settings(**overrides) -> AppSettings:
    base = dict(
        environment="production",
        app_version="1.0",
        cors_origins=["https://app.example.com"],
        trusted_hosts=["app.example.com"],
        enable_debug_routes=False,
    )
    base.update(overrides)
    return AppSettings(**base)


def test_validate_app_settings_noop_outside_production():
    # Non-production environments must not raise, even with bad values.
    dev = _settings(environment="development", cors_origins=["*"], trusted_hosts=["*"])
    validate_app_settings(dev)  # should not raise


def test_validate_app_settings_requires_cors_origins():
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        validate_app_settings(_settings(cors_origins=[]))


def test_validate_app_settings_rejects_wildcard_cors():
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        validate_app_settings(_settings(cors_origins=["*"]))


def test_validate_app_settings_rejects_malformed_origins():
    with pytest.raises(RuntimeError, match="Invalid CORS_ORIGINS"):
        validate_app_settings(_settings(cors_origins=["not-a-url"]))


def test_validate_app_settings_requires_trusted_hosts():
    with pytest.raises(RuntimeError, match="TRUSTED_HOSTS"):
        validate_app_settings(_settings(trusted_hosts=[]))


def test_validate_app_settings_rejects_wildcard_trusted_hosts():
    with pytest.raises(RuntimeError, match="TRUSTED_HOSTS"):
        validate_app_settings(_settings(trusted_hosts=["*"]))


def test_validate_app_settings_rejects_malformed_trusted_hosts():
    with pytest.raises(RuntimeError, match="Invalid TRUSTED_HOSTS"):
        validate_app_settings(_settings(trusted_hosts=["https://example.com"]))


def test_validate_app_settings_happy_path():
    # Fully valid production settings — must not raise.
    validate_app_settings(_settings())
