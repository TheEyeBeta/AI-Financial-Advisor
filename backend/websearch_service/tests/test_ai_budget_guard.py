"""Tests for app.services.ai_budget_guard — the global AI spend/capacity
circuit breaker. Uses fakeredis for the Redis-backed path (no real Redis or
provider calls) and a plain instance for the in-memory fallback path.
"""
from __future__ import annotations

import threading
import time

import fakeredis
import pytest

from app.services.ai_budget_guard import (
    STATE_HARD_STOP,
    STATE_MANUAL_OVERRIDE,
    STATE_NORMAL,
    STATE_RESTRICTED,
    AIBudgetConfig,
    AIBudgetDenied,
    AIBudgetGuard,
)


def _redis_guard(**overrides) -> AIBudgetGuard:
    client = fakeredis.FakeRedis(decode_responses=True)
    defaults = dict(
        global_requests_per_minute=1000,
        global_tokens_per_minute=10_000_000,
        global_requests_per_day=1000,
        global_tokens_per_day=10_000_000,
        global_max_concurrent=5,
        provider_max_concurrent=5,
        model_max_concurrent=5,
        daily_budget_usd=1.0,
        monthly_budget_usd=10.0,
        warning_threshold_pct=0.6,
        restricted_threshold_pct=0.85,
        lease_ttl_seconds=60,
        key_prefix=f"test:budget:{time.time_ns()}",
    )
    defaults.update(overrides)
    return AIBudgetGuard(config=AIBudgetConfig(**defaults), redis_client=client)


# ─── Reserve / reconcile / release lifecycle ───────────────────────────────

def test_reserve_then_reconcile_corrects_spend_to_actual():
    guard = _redis_guard()
    reservation = guard.reserve(
        provider="openai", model="gpt-4o-mini",
        estimated_input_tokens=1000, estimated_output_tokens=1000,
    )
    guard.reconcile(reservation, actual_input_tokens=2000, actual_output_tokens=2000)
    guard.release(reservation)

    status = guard.get_status()
    # gpt-4o-mini: 2000 in @0.15/1M + 2000 out @0.6/1M = 0.0003 + 0.0012 = 0.0015
    assert status["day_spend_usd"] == pytest.approx(0.0015, abs=1e-6)


def test_release_without_reconcile_refunds_full_estimate():
    guard = _redis_guard()
    reservation = guard.reserve(
        provider="openai", model="gpt-4o-mini",
        estimated_input_tokens=1000, estimated_output_tokens=1000,
    )
    assert guard.get_status()["day_spend_usd"] > 0
    guard.release(reservation)  # failure/cancellation path — never reconciled
    assert guard.get_status()["day_spend_usd"] == pytest.approx(0.0, abs=1e-9)


def test_release_is_idempotent():
    guard = _redis_guard()
    reservation = guard.reserve(
        provider="openai", model="gpt-4o-mini",
        estimated_input_tokens=100, estimated_output_tokens=100,
    )
    guard.release(reservation)
    spend_after_first_release = guard.get_status()["day_spend_usd"]
    guard.release(reservation)  # must not double-refund
    assert guard.get_status()["day_spend_usd"] == spend_after_first_release


# ─── Concurrency race ───────────────────────────────────────────────────────

def test_global_concurrency_race_only_allows_configured_max():
    """Requirement: atomic Redis ops, no race-based overspend. Fire more
    concurrent reservations than the limit allows from multiple threads and
    verify exactly the configured number succeed — never more.
    """
    guard = _redis_guard(global_max_concurrent=3, provider_max_concurrent=100, model_max_concurrent=100)
    results = []
    lock = threading.Lock()

    def attempt():
        try:
            r = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
            with lock:
                results.append(("ok", r))
        except AIBudgetDenied as exc:
            with lock:
                results.append(("denied", exc.reason_code))

    threads = [threading.Thread(target=attempt) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    allowed = [r for kind, r in results if kind == "ok"]
    denied = [r for kind, r in results if kind == "denied"]
    assert len(allowed) == 3
    assert len(denied) == 17
    assert all(reason == "global_concurrency" for reason in denied)


def test_provider_and_model_concurrency_are_independent():
    guard = _redis_guard(global_max_concurrent=100, provider_max_concurrent=1, model_max_concurrent=100)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o", estimated_input_tokens=10, estimated_output_tokens=10)
    assert exc_info.value.reason_code == "provider_concurrency"
    # A different provider is unaffected by openai's concurrency slot.
    r2 = guard.reserve(provider="perplexity", model="sonar", estimated_input_tokens=10, estimated_output_tokens=10)
    guard.release(r1)
    guard.release(r2)


# ─── Daily / monthly boundary ──────────────────────────────────────────────

def test_daily_hard_stop_blocks_further_reservations():
    guard = _redis_guard(daily_budget_usd=0.001, monthly_budget_usd=100.0)
    # gpt-4o-mini: 10000 in + 10000 out ~= 0.0015 + 0.006 -> exceeds $0.001 daily budget once reconciled to actuals.
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10000, estimated_output_tokens=10000)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=1000, estimated_output_tokens=1000)
    assert exc_info.value.reason_code == "hard_stop"
    assert exc_info.value.http_status == 503
    assert exc_info.value.state == STATE_HARD_STOP


def test_monthly_hard_stop_blocks_even_when_daily_budget_has_room():
    guard = _redis_guard(daily_budget_usd=1000.0, monthly_budget_usd=0.001)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10000, estimated_output_tokens=10000)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=1000, estimated_output_tokens=1000)
    assert exc_info.value.reason_code == "hard_stop"


def test_restricted_state_blocks_non_essential_but_allows_essential():
    guard = _redis_guard(daily_budget_usd=0.01, monthly_budget_usd=100.0, restricted_threshold_pct=0.5, warning_threshold_pct=0.2)
    # gpt-4o-mini input-only cost: 50000/1e6 * 0.15 = 0.0075 -> 75% of the
    # $0.01 daily budget, landing between restricted (50%) and hard_stop (100%).
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=50000, estimated_output_tokens=0)
    guard.reconcile(r1, actual_input_tokens=50000, actual_output_tokens=0)
    guard.release(r1)

    status = guard.get_status()
    assert status["state"] == STATE_RESTRICTED

    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10, essential=False)
    assert exc_info.value.reason_code == "restricted"

    # Essential (e.g. admin/internal) traffic still gets through in restricted state.
    essential_reservation = guard.reserve(
        provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10, essential=True
    )
    guard.release(essential_reservation)


# ─── Retries / retry guidance ───────────────────────────────────────────────

def test_denial_includes_reason_code_and_retry_after():
    guard = _redis_guard(global_requests_per_minute=1)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    exc = exc_info.value
    assert exc.reason_code == "global_requests_per_minute"
    assert exc.http_status == 429
    assert exc.retry_after > 0
    assert "retry_after" in exc.detail
    guard.release(r1)


# ─── Fallback provider ──────────────────────────────────────────────────────

def test_fallback_provider_is_not_blocked_by_primary_providers_concurrency():
    guard = _redis_guard(global_max_concurrent=100, provider_max_concurrent=1, model_max_concurrent=100)
    r1 = guard.reserve(provider="openai", model="gpt-5", estimated_input_tokens=100, estimated_output_tokens=100)
    # openai is now at its per-provider concurrency ceiling; a fallback to a
    # different provider (e.g. perplexity) must still be reservable.
    fallback = guard.reserve(provider="perplexity", model="sonar-pro", estimated_input_tokens=100, estimated_output_tokens=100)
    assert fallback.provider == "perplexity"
    guard.release(r1)
    guard.release(fallback)


# ─── Manual override expiry ─────────────────────────────────────────────────

def test_manual_override_bypasses_hard_stop_and_expires():
    guard = _redis_guard(daily_budget_usd=0.001, monthly_budget_usd=100.0)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10000, estimated_output_tokens=10000)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)

    with pytest.raises(AIBudgetDenied):
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)

    # Admin sets a short override.
    expires_at = time.time() + 1
    guard.set_manual_override(expires_at=expires_at, admin_id="admin@example.com", reason="incident testing")
    status = guard.get_status()
    assert status["state"] == STATE_MANUAL_OVERRIDE
    assert status["override_active"] is True

    override_reservation = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    guard.release(override_reservation)

    time.sleep(1.2)
    status_after_expiry = guard.get_status()
    assert status_after_expiry["override_active"] is False
    with pytest.raises(AIBudgetDenied):
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)


def test_manual_override_disabled_by_default():
    guard = _redis_guard()
    status = guard.get_status()
    assert status["override_active"] is False
    assert status["state"] == STATE_NORMAL


def test_clear_manual_override_restores_hard_stop():
    guard = _redis_guard(daily_budget_usd=0.001, monthly_budget_usd=100.0)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10000, estimated_output_tokens=10000)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)

    guard.set_manual_override(expires_at=time.time() + 3600, admin_id="admin@example.com", reason="test")
    ok = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    guard.release(ok)

    guard.clear_manual_override()
    with pytest.raises(AIBudgetDenied):
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)


# ─── Redis outage ───────────────────────────────────────────────────────────

class _ExplodingRedisClient:
    """Simulates a Redis client whose connection drops mid-operation."""

    def register_script(self, script):
        def _runner(*, keys, args):
            raise ConnectionError("simulated redis outage")
        return _runner

    def eval(self, *args, **kwargs):
        raise ConnectionError("simulated redis outage")

    def get(self, *args, **kwargs):
        raise ConnectionError("simulated redis outage")

    def zcard(self, *args, **kwargs):
        raise ConnectionError("simulated redis outage")


def test_redis_outage_fails_closed_by_default():
    guard = AIBudgetGuard(
        config=AIBudgetConfig(key_prefix="test:outage", fail_open_on_redis_outage=False),
        redis_client=_ExplodingRedisClient(),
    )
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    assert exc_info.value.reason_code == "redis_unavailable"
    assert exc_info.value.http_status == 503


def test_redis_outage_fails_open_when_configured():
    guard = AIBudgetGuard(
        config=AIBudgetConfig(key_prefix="test:outage-open", fail_open_on_redis_outage=True),
        redis_client=_ExplodingRedisClient(),
    )
    # Must not raise — availability preferred over cost protection when explicitly configured.
    reservation = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    guard.release(reservation)


def test_no_redis_configured_falls_back_to_in_memory_guard():
    """No Redis at all (e.g. local dev): the guard must still function via
    the in-memory backend rather than crashing every AI call."""
    guard = AIBudgetGuard(config=AIBudgetConfig(key_prefix="test:no-redis"), redis_client=None)
    assert guard.uses_redis() is False
    reservation = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    guard.reconcile(reservation, actual_input_tokens=10, actual_output_tokens=10)
    guard.release(reservation)
    status = guard.get_status()
    assert status["mode"] == "memory"


def test_in_memory_backend_enforces_concurrency_limit():
    guard = AIBudgetGuard(
        config=AIBudgetConfig(key_prefix="test:no-redis-conc", global_max_concurrent=1),
        redis_client=None,
    )
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    assert exc_info.value.reason_code == "global_concurrency"
    guard.release(r1)
