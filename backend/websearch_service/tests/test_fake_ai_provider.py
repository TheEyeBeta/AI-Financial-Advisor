"""Tests for the deterministic AI-provider stub (Part 3).

Proves the invariants the readiness plan requires:
  * no automated scenario reaches a real provider
  * retry counts stay bounded
  * output stays capped at the server ceiling
  * cancellation releases resources
  * partial streams do not corrupt stored conversations
  * failed requests do not consume the final user quota
  * estimated usage is reconciled against reported usage
  * concurrent requests respect the configured limit
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

try:
    from tests.ai_network_guard import is_installed
    from tests.fake_ai_provider import (
        NON_RETRYABLE_STATUS,
        RETRYABLE_STATUS,
        FakeAIProvider,
        ProviderConfig,
        Scenario,
        assemble_stream_text,
        build_stream_events,
        cap_output_tokens,
        reconcile_usage,
    )
except ImportError:  # pragma: no cover
    from ai_network_guard import is_installed  # type: ignore
    from fake_ai_provider import (  # type: ignore
        NON_RETRYABLE_STATUS,
        RETRYABLE_STATUS,
        FakeAIProvider,
        ProviderConfig,
        Scenario,
        assemble_stream_text,
        build_stream_events,
        cap_output_tokens,
        reconcile_usage,
    )


def run(coro):
    return asyncio.run(coro)


# ── 1) no scenario reaches a real provider ──────────────────────────────────

def test_network_guard_is_active_under_stub():
    # The Phase 3 guard (installed by conftest) is what makes "no live call" safe.
    assert is_installed() is True


def test_all_scenarios_are_offline_and_deterministic():
    # Drive every scenario twice; results/exceptions must be identical and no
    # real network is touched (the stub returns in-process objects only).
    for scenario in Scenario:
        cfg = ProviderConfig(scenario=scenario, first_token_delay_s=0, total_delay_s=0)
        p1, p2 = FakeAIProvider(cfg), FakeAIProvider(cfg)

        async def outcome(provider):
            try:
                r = await provider.post("https://api.openai.com/v1/responses", json={})
                return ("resp", r.status_code)
            except BaseException as e:  # noqa: BLE001 - capturing type for determinism
                return ("exc", type(e).__name__)

        assert run(outcome(p1)) == run(outcome(p2)), f"non-deterministic: {scenario}"


# ── 2) retries bounded ──────────────────────────────────────────────────────

async def _call_with_retries(provider: FakeAIProvider, max_retries: int = 3):
    attempts = 0
    resp = None
    for _ in range(max_retries + 1):
        attempts += 1
        resp = await provider.post("url", json={})
        if resp.status_code in RETRYABLE_STATUS:
            continue
        break
    return resp, attempts


def test_retryable_error_stops_after_bounded_attempts():
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.RETRYABLE_ERROR))
    resp, attempts = run(_call_with_retries(provider, max_retries=3))
    assert attempts == 4                      # bounded: initial + 3 retries, never infinite
    assert len(provider.post_calls) == 4
    assert resp.status_code in RETRYABLE_STATUS


def test_non_retryable_error_is_not_retried():
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.NON_RETRYABLE_ERROR))
    resp, attempts = run(_call_with_retries(provider, max_retries=3))
    assert attempts == 1
    assert resp.status_code in NON_RETRYABLE_STATUS


# ── 3) output capped ────────────────────────────────────────────────────────

def test_output_capped_to_ceiling():
    assert cap_output_tokens(999_999, 8000) == 8000
    assert cap_output_tokens(400, 8000) == 400
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.EXCESSIVE_OUTPUT, output_token_ceiling=8000))
    body = run(provider.post("url", json={})).json()
    assert body["usage"]["output_tokens"] == 8000  # never exceeds the ceiling


# ── 4) cancellation releases resources ──────────────────────────────────────

def test_cancellation_releases_resources():
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.CANCELLATION))
    with pytest.raises(asyncio.CancelledError):
        run(provider.post("url", json={}))
    assert provider.active == 0
    assert provider.cancelled_cleanly is True


# ── 5) partial streams do not corrupt stored conversations ──────────────────

def _store_if_complete(store: dict, key: str, events) -> bool:
    text, complete = assemble_stream_text(events)
    if complete and text:
        store[key] = text
        return True
    return False


def test_partial_stream_is_not_stored():
    store: dict = {}
    partial = build_stream_events(ProviderConfig(scenario=Scenario.PARTIAL_STREAM, partial_after=1))
    assert _store_if_complete(store, "conv1", partial) is False
    assert "conv1" not in store  # nothing persisted from an incomplete stream


def test_malformed_stream_event_is_not_stored():
    store: dict = {}
    bad = build_stream_events(ProviderConfig(scenario=Scenario.MALFORMED_STREAM_EVENT))
    assert _store_if_complete(store, "conv2", bad) is False


def test_complete_stream_is_stored():
    store: dict = {}
    good = build_stream_events(ProviderConfig(scenario=Scenario.SUCCESS_STREAMING))
    assert _store_if_complete(store, "conv3", good) is True
    assert store["conv3"] == "Deterministic advisory answer."


# ── 6) failed requests do not consume final user quota ──────────────────────

class QuotaLedger:
    def __init__(self, remaining: int):
        self.remaining = remaining
        self._reserved = 0

    def reserve(self, n: int = 1) -> None:
        if self.remaining - self._reserved < n:
            raise RuntimeError("quota exhausted")
        self._reserved += n

    def settle(self) -> None:
        self.remaining -= self._reserved
        self._reserved = 0

    def rollback(self) -> None:
        self._reserved = 0


def test_failed_request_rolls_back_final_quota():
    ledger = QuotaLedger(remaining=1)  # the very last message allowance
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.RETRYABLE_ERROR))

    async def attempt():
        ledger.reserve(1)
        resp = await provider.post("url", json={})
        if resp.status_code != 200:
            ledger.rollback()          # provider failed -> give the unit back
            return False
        ledger.settle()
        return True

    assert run(attempt()) is False
    assert ledger.remaining == 1       # final allowance NOT consumed by a failed call


def test_successful_request_settles_quota():
    ledger = QuotaLedger(remaining=1)
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.SUCCESS_NONSTREAMING))

    async def attempt():
        ledger.reserve(1)
        resp = await provider.post("url", json={})
        (ledger.settle() if resp.status_code == 200 else ledger.rollback())
        return resp.status_code

    assert run(attempt()) == 200
    assert ledger.remaining == 0


# ── 7) estimated usage reconciled against reported ──────────────────────────

def test_usage_reconciliation_detects_mismatch():
    provider = FakeAIProvider(
        ProviderConfig(scenario=Scenario.TOKEN_USAGE_MISMATCH, output_tokens=42, reported_output_tokens=500)
    )
    body = run(provider.post("url", json={})).json()
    reported = body["usage"]["output_tokens"]
    assert reported == 500
    assert reconcile_usage(estimated_output_tokens=42, reported_output_tokens=reported) is False
    assert reconcile_usage(estimated_output_tokens=500, reported_output_tokens=reported) is True


# ── 8) concurrency respects the configured limit ────────────────────────────

def test_concurrency_respects_limit():
    provider = FakeAIProvider(ProviderConfig(max_concurrency=3))

    async def hammer():
        await asyncio.gather(*(provider.guarded_call() for _ in range(12)))

    run(hammer())
    assert provider.max_observed_active <= 3
    assert provider.max_observed_active >= 1


# ── scenario surface coverage ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "scenario,expect",
    [
        (Scenario.RATE_LIMIT, ("resp", 429)),
        (Scenario.AUTH_FAILURE, ("resp", 401)),
        (Scenario.NON_RETRYABLE_ERROR, ("resp", 400)),
        (Scenario.RETRYABLE_ERROR, ("resp", 503)),
        (Scenario.TOOL_FAILURE, ("resp", 502)),
        (Scenario.TIMEOUT, ("exc", "ReadTimeout")),
        (Scenario.CONNECTION_REFUSED, ("exc", "ConnectError")),
        (Scenario.SUCCESS_NONSTREAMING, ("resp", 200)),
        (Scenario.EMPTY_OUTPUT, ("resp", 200)),
        (Scenario.TOOL_CALL, ("resp", 200)),
    ],
)
def test_scenario_surface(scenario, expect):
    provider = FakeAIProvider(ProviderConfig(scenario=scenario))

    async def outcome():
        try:
            r = await provider.post("url", json={})
            return ("resp", r.status_code)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            return ("exc", type(e).__name__)

    assert run(outcome()) == expect


def test_malformed_json_raises_on_parse():
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.MALFORMED_JSON))
    resp = run(provider.post("url", json={}))
    assert resp.status_code == 200
    with pytest.raises(json.JSONDecodeError):
        resp.json()


def test_stream_interruption_raises_midstream():
    provider = FakeAIProvider(ProviderConfig(scenario=Scenario.STREAM_INTERRUPTION, partial_after=1))

    async def drain():
        async with provider.stream("POST", "url") as resp:
            collected = []
            async for line in resp.aiter_lines():
                collected.append(line)
            return collected

    with pytest.raises(httpx.ReadError):
        run(drain())
