"""Tests for app/config.py."""
from __future__ import annotations

import pytest

from app.config import (
    AppSettings,
    get_app_settings,
    is_truthy,
    is_valid_origin,
    is_valid_trusted_host,
    parse_csv_env,
    validate_app_settings,
)


class TestParseCsvEnv:
    def test_none_returns_empty_list(self):
        assert parse_csv_env(None) == []

    def test_empty_string_returns_empty_list(self):
        assert parse_csv_env("") == []

    def test_single_value(self):
        assert parse_csv_env("value") == ["value"]

    def test_comma_separated_values(self):
        assert parse_csv_env("a,b,c") == ["a", "b", "c"]

    def test_strips_whitespace(self):
        assert parse_csv_env(" a , b , c ") == ["a", "b", "c"]

    def test_empty_segments_skipped(self):
        assert parse_csv_env("a,,b") == ["a", "b"]


class TestIsTruthy:
    def test_true_lowercase(self):
        assert is_truthy("true") is True

    def test_one_is_truthy(self):
        assert is_truthy("1") is True

    def test_yes_is_truthy(self):
        assert is_truthy("yes") is True

    def test_on_is_truthy(self):
        assert is_truthy("on") is True

    def test_false_is_not_truthy(self):
        assert is_truthy("false") is False

    def test_none_is_not_truthy(self):
        assert is_truthy(None) is False

    def test_empty_string_is_not_truthy(self):
        assert is_truthy("") is False

    def test_zero_string_is_not_truthy(self):
        assert is_truthy("0") is False


class TestIsValidOrigin:
    def test_https_with_domain(self):
        assert is_valid_origin("https://example.com") is True

    def test_http_with_domain(self):
        assert is_valid_origin("http://localhost:3000") is True

    def test_no_scheme_is_invalid(self):
        assert is_valid_origin("example.com") is False

    def test_ftp_scheme_is_invalid(self):
        assert is_valid_origin("ftp://example.com") is False

    def test_empty_string_is_invalid(self):
        assert is_valid_origin("") is False


class TestIsValidTrustedHost:
    def test_bare_hostname(self):
        assert is_valid_trusted_host("example.com") is True

    def test_with_scheme_is_invalid(self):
        assert is_valid_trusted_host("https://example.com") is False

    def test_with_path_is_invalid(self):
        assert is_valid_trusted_host("example.com/path") is False

    def test_empty_string_is_invalid(self):
        assert is_valid_trusted_host("") is False


class TestAppSettings:
    def test_is_production_true(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=[],
            trusted_hosts=[],
            enable_debug_routes=False,
        )
        assert s.is_production is True

    def test_is_production_false(self):
        s = AppSettings(
            environment="development",
            app_version="1.0",
            cors_origins=[],
            trusted_hosts=[],
            enable_debug_routes=True,
        )
        assert s.is_production is False


class TestGetAppSettings:
    def test_returns_app_settings_instance(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("APP_VERSION", "2.0")
        settings = get_app_settings()
        assert isinstance(settings, AppSettings)
        assert settings.environment == "development"
        assert settings.app_version == "2.0"

    def test_debug_routes_enabled_in_non_production(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.delenv("ENABLE_DEBUG_ROUTES", raising=False)
        settings = get_app_settings()
        assert settings.enable_debug_routes is True

    def test_debug_routes_disabled_in_production_by_default(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.delenv("ENABLE_DEBUG_ROUTES", raising=False)
        settings = get_app_settings()
        assert settings.enable_debug_routes is False

    def test_cors_origins_parsed_from_env(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "https://a.com,https://b.com")
        settings = get_app_settings()
        assert "https://a.com" in settings.cors_origins
        assert "https://b.com" in settings.cors_origins


class TestValidateAppSettings:
    def test_non_production_always_passes(self):
        s = AppSettings(
            environment="development",
            app_version="1.0",
            cors_origins=[],
            trusted_hosts=[],
            enable_debug_routes=True,
        )
        validate_app_settings(s)  # should not raise

    def test_production_without_cors_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=[],
            trusted_hosts=["example.com"],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            validate_app_settings(s)

    def test_production_with_wildcard_cors_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["*"],
            trusted_hosts=["example.com"],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            validate_app_settings(s)

    def test_production_with_invalid_cors_origin_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["not-a-valid-origin"],
            trusted_hosts=["example.com"],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="Invalid CORS_ORIGINS"):
            validate_app_settings(s)

    def test_production_without_trusted_hosts_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["https://example.com"],
            trusted_hosts=[],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="TRUSTED_HOSTS"):
            validate_app_settings(s)

    def test_production_with_wildcard_trusted_host_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["https://example.com"],
            trusted_hosts=["*"],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="TRUSTED_HOSTS"):
            validate_app_settings(s)

    def test_production_with_invalid_trusted_host_raises(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["https://example.com"],
            trusted_hosts=["http://example.com"],
            enable_debug_routes=False,
        )
        with pytest.raises(RuntimeError, match="Invalid TRUSTED_HOSTS"):
            validate_app_settings(s)

    def test_production_valid_settings_passes(self):
        s = AppSettings(
            environment="production",
            app_version="1.0",
            cors_origins=["https://example.com"],
            trusted_hosts=["example.com"],
            enable_debug_routes=False,
        )
        validate_app_settings(s)  # should not raise
