"""Test-environment AI-provider network guard (Phase 3).

Automated tests must never reach a real AI provider. Every unit and integration
test is expected to use the deterministic provider doubles (mocked
``httpx.AsyncClient`` / patched ``_call_openai_responses``). This guard is a
safety net: it fails loudly the moment any test path tries to resolve a real
AI-provider hostname, catching an accidentally un-mocked call before it can
spend money, leak a key, or make a flaky external dependency part of CI.

Design notes
------------
* It blocks **only AI-provider hostnames**, not all egress, so integration
  tests that legitimately talk to a test/staging Supabase or a local Redis are
  unaffected.
* The block is installed at ``socket.getaddrinfo`` — the single choke point all
  HTTP clients (httpx sync/async via anyio, requests, urllib) funnel through
  for DNS resolution — so it is transport-agnostic.
* It is intentionally *fail-closed*: the escape hatch
  ``ALLOW_REAL_AI_PROVIDER_NETWORK=1`` must be set explicitly (used only by the
  sanctioned, budget-capped live-provider validation described in the
  production-readiness plan). Absent that flag, real AI calls fail the test.
"""
from __future__ import annotations

import os
import socket
from typing import Callable, Iterable

# Hostname *substrings* that identify a real, paid AI/LLM provider endpoint.
DEFAULT_BLOCKED_HOST_SUBSTRINGS: tuple[str, ...] = (
    "api.openai.com",
    "openai.azure.com",
    "api.perplexity.ai",
    "api.anthropic.com",
)

_ALLOW_ENV_FLAG = "ALLOW_REAL_AI_PROVIDER_NETWORK"

_original_getaddrinfo: Callable | None = None


class AIProviderNetworkGuardError(RuntimeError):
    """Raised when a test attempts to reach a real AI provider over the network."""


def _host_is_blocked(host: object, blocked: Iterable[str]) -> bool:
    if not isinstance(host, (str, bytes)):
        return False
    text = host.decode() if isinstance(host, bytes) else host
    text = text.strip().lower()
    return any(marker in text for marker in blocked)


def _guard_disabled_via_env() -> bool:
    """The escape hatch must be an explicit opt-in truthy value."""
    return os.getenv(_ALLOW_ENV_FLAG, "").strip() not in ("", "0", "false", "no")


def _should_block(
    host: object,
    blocked: Iterable[str] = DEFAULT_BLOCKED_HOST_SUBSTRINGS,
) -> bool:
    """Pure decision: block iff host is an AI provider AND the escape hatch is off."""
    if _guard_disabled_via_env():
        return False
    return _host_is_blocked(host, blocked)


def install_ai_network_guard(
    blocked_host_substrings: Iterable[str] = DEFAULT_BLOCKED_HOST_SUBSTRINGS,
) -> None:
    """Monkeypatch ``socket.getaddrinfo`` to block real AI-provider resolution.

    Idempotent; a no-op when the explicit escape-hatch env flag is set.
    """
    global _original_getaddrinfo
    if _original_getaddrinfo is not None:
        return  # already installed

    blocked = tuple(blocked_host_substrings)
    _original_getaddrinfo = socket.getaddrinfo

    def guarded_getaddrinfo(host, *args, **kwargs):  # type: ignore[no-untyped-def]
        # Decision (incl. escape hatch) is evaluated per-call so a test can
        # toggle the env flag at runtime.
        if _should_block(host, blocked):
            raise AIProviderNetworkGuardError(
                f"Blocked real AI-provider network access to '{host}' during tests. "
                "Mock the provider (httpx.AsyncClient / _call_openai_responses) or, "
                f"for a sanctioned live validation, set {_ALLOW_ENV_FLAG}=1."
            )
        return _original_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo  # type: ignore[assignment]


def uninstall_ai_network_guard() -> None:
    """Restore the original ``socket.getaddrinfo`` (used by the guard's own tests)."""
    global _original_getaddrinfo
    if _original_getaddrinfo is not None:
        socket.getaddrinfo = _original_getaddrinfo  # type: ignore[assignment]
        _original_getaddrinfo = None


def is_installed() -> bool:
    return _original_getaddrinfo is not None
