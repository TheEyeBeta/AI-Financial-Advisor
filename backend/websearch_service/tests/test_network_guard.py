"""Tests for the Phase 3 AI-provider network guard.

Verifies that automated tests cannot silently reach a real AI provider, that
non-provider hosts (Supabase/Redis/localhost) are unaffected, and that the
explicit escape hatch works for the sanctioned live validation.
"""
from __future__ import annotations

import socket

import pytest

try:  # package import mode
    from tests.ai_network_guard import (
        AIProviderNetworkGuardError,
        DEFAULT_BLOCKED_HOST_SUBSTRINGS,
        _guard_disabled_via_env,
        _host_is_blocked,
        _should_block,
        is_installed,
    )
except ImportError:  # pragma: no cover - rootdir import-mode fallback
    from ai_network_guard import (  # type: ignore[no-redef]
        AIProviderNetworkGuardError,
        DEFAULT_BLOCKED_HOST_SUBSTRINGS,
        _guard_disabled_via_env,
        _host_is_blocked,
        _should_block,
        is_installed,
    )


def test_guard_installed_by_conftest():
    assert is_installed() is True


@pytest.mark.parametrize(
    "host",
    ["api.openai.com", "API.OpenAI.com", "api.perplexity.ai", "api.anthropic.com"],
)
def test_getaddrinfo_blocks_ai_provider_hosts(host):
    # The guard installed by conftest must reject real AI-provider resolution.
    with pytest.raises(AIProviderNetworkGuardError):
        socket.getaddrinfo(host, 443)


def test_getaddrinfo_allows_localhost():
    # Loopback resolves without egress and must not trip the guard.
    result = socket.getaddrinfo("localhost", 80)
    assert result  # non-empty address info list


def test_host_is_blocked_pure():
    assert _host_is_blocked("api.openai.com", DEFAULT_BLOCKED_HOST_SUBSTRINGS) is True
    assert _host_is_blocked(b"api.perplexity.ai", DEFAULT_BLOCKED_HOST_SUBSTRINGS) is True
    # Non-provider infrastructure hosts pass through.
    assert _host_is_blocked("test.supabase.co", DEFAULT_BLOCKED_HOST_SUBSTRINGS) is False
    assert _host_is_blocked("127.0.0.1", DEFAULT_BLOCKED_HOST_SUBSTRINGS) is False
    # Non-string inputs never block.
    assert _host_is_blocked(1234, DEFAULT_BLOCKED_HOST_SUBSTRINGS) is False
    assert _host_is_blocked(None, DEFAULT_BLOCKED_HOST_SUBSTRINGS) is False


def test_should_block_default_on():
    assert _should_block("api.openai.com") is True
    assert _should_block("test.supabase.co") is False


def test_escape_hatch_disables_guard(monkeypatch):
    # Explicit opt-in must let a provider host through (used only by the
    # sanctioned, budget-capped live validation).
    monkeypatch.setenv("ALLOW_REAL_AI_PROVIDER_NETWORK", "1")
    assert _guard_disabled_via_env() is True
    assert _should_block("api.openai.com") is False


@pytest.mark.parametrize("value", ["", "0", "false", "no"])
def test_escape_hatch_falsey_values_keep_guard_on(monkeypatch, value):
    monkeypatch.setenv("ALLOW_REAL_AI_PROVIDER_NETWORK", value)
    assert _guard_disabled_via_env() is False
    assert _should_block("api.openai.com") is True
