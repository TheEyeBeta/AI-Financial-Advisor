"""Tests for app.services.supabase_client — singleton initialisation guards."""
from __future__ import annotations

import importlib
import sys

import pytest


def _reload_module(monkeypatch, *, url: str | None, key: str | None):
    """Force a fresh import so module-level init runs under the patched env."""
    if url is None:
        monkeypatch.delenv("SUPABASE_URL", raising=False)
    else:
        monkeypatch.setenv("SUPABASE_URL", url)

    if key is None:
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    else:
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", key)

    # Drop cached import so the module-level _init_client() runs again.
    sys.modules.pop("app.services.supabase_client", None)
    return importlib.import_module("app.services.supabase_client")


def test_initialisation_raises_when_url_missing(monkeypatch):
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        _reload_module(monkeypatch, url=None, key="test-key")


def test_initialisation_raises_when_service_role_key_missing(monkeypatch):
    with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_ROLE_KEY"):
        _reload_module(monkeypatch, url="https://test.supabase.co", key=None)


def test_initialisation_succeeds_with_both_env_vars(monkeypatch):
    module = _reload_module(
        monkeypatch,
        url="https://test.supabase.co",
        key="test-service-role-key",
    )
    assert module.supabase_client is not None


def test_get_schema_returns_schema_scoped_builder(monkeypatch):
    module = _reload_module(
        monkeypatch,
        url="https://test.supabase.co",
        key="test-service-role-key",
    )
    builder = module.get_schema("core")
    # supabase PostgrestClient schema builder exposes .from_() (postgrest-py).
    # We don't need to call it — we just verify that get_schema() did not crash
    # and returned a non-None object that is the result of schema("core").
    assert builder is not None
