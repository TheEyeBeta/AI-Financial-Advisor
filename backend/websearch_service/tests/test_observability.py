"""Tests for observability bootstrap."""

from __future__ import annotations

from unittest.mock import patch

from app.observability import _scrub_event, init_observability


def test_init_observability_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    init_observability()


def test_scrub_event_redacts_sensitive_headers():
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer secret",
                "Cookie": "session=abc",
                "User-Agent": "pytest",
            }
        }
    }
    scrubbed = _scrub_event(event, {})
    headers = scrubbed["request"]["headers"]
    assert headers["Authorization"] == "[REDACTED]"
    assert headers["Cookie"] == "[REDACTED]"
    assert headers["User-Agent"] == "pytest"


def test_init_observability_with_dsn(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://example@o0.ingest.sentry.io/0")
    with patch("sentry_sdk.init") as init_mock:
        init_observability()
    init_mock.assert_called_once()
