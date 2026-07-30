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
    guard = _redis_guard(daily_budget_usd=0.005, monthly_budget_usd=100.0)
    # Reserve small (fits comfortably under budget at admission time), then
    # reconcile to a much larger actual — the classic "actual usage came in
    # higher than estimated" case — pushing day_spend over the $0.005
    # budget. The *next* reservation attempt must then hit hard_stop.
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=100, estimated_output_tokens=100)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    assert exc_info.value.reason_code == "hard_stop"
    assert exc_info.value.http_status == 503
    assert exc_info.value.state == STATE_HARD_STOP


def test_a_single_oversized_reservation_is_denied_before_it_lands():
    """A single request whose OWN estimated cost would push spend past
    budget must be denied at admission time, not merely detected after the
    fact on a subsequent request."""
    guard = _redis_guard(daily_budget_usd=0.001, monthly_budget_usd=100.0)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10000, estimated_output_tokens=10000)
    assert exc_info.value.reason_code == "hard_stop"
    assert guard.get_status()["day_spend_usd"] == pytest.approx(0.0, abs=1e-9)


def test_monthly_hard_stop_blocks_even_when_daily_budget_has_room():
    guard = _redis_guard(daily_budget_usd=1000.0, monthly_budget_usd=0.005)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=100, estimated_output_tokens=100)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
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
    guard = _redis_guard(daily_budget_usd=0.005, monthly_budget_usd=100.0)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=100, estimated_output_tokens=100)
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
    guard = _redis_guard(daily_budget_usd=0.005, monthly_budget_usd=100.0)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=100, estimated_output_tokens=100)
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


def test_redis_outage_fail_open_still_enforces_via_memory_backend():
    """Fail-open must degrade to the in-memory backend's best-effort
    enforcement, not to zero enforcement — a fake always-allow reservation
    would let concurrency/spend limits vanish entirely during an outage."""
    guard = AIBudgetGuard(
        config=AIBudgetConfig(
            key_prefix="test:outage-enforce", fail_open_on_redis_outage=True, global_max_concurrent=1
        ),
        redis_client=_ExplodingRedisClient(),
    )
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    assert r1.used_memory_fallback is True
    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=10, estimated_output_tokens=10)
    assert exc_info.value.reason_code == "global_concurrency"
    guard.release(r1)


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


# ─── Regression: review-flagged bugs ───────────────────────────────────────

def test_day_request_token_keys_are_date_suffixed():
    """Regression: day_req/day_tok used to be static key names relying
    solely on Redis TTL to roll over at midnight; a TTL unit bug meant they
    could survive past midnight and let yesterday's counts bleed into
    today. They must be date-suffixed like day_spend/month_spend so a day
    boundary is a key-name change, not just a TTL race."""
    from app.services.ai_budget_guard import _RedisBackend

    client = fakeredis.FakeRedis(decode_responses=True)
    backend = _RedisBackend(client, "test:prefix")
    keys = backend._keys("openai", "gpt-4o-mini", "req-1", time.time())
    assert keys["day_req"] != "test:prefix:global:req:day"
    assert keys["day_tok"] != "test:prefix:global:tok:day"
    assert keys["day_req"].startswith("test:prefix:global:req:day:")
    assert keys["day_tok"].startswith("test:prefix:global:tok:day:")


def test_check_admission_denies_in_hard_stop_regardless_of_essential():
    """The cheap pre-admission check (used before a priced classifier call
    whose model isn't known yet) must deny in hard_stop for every caller —
    hard_stop has no essential-traffic exception (only restricted does)."""
    guard = _redis_guard(daily_budget_usd=0.005, monthly_budget_usd=100.0)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=100, estimated_output_tokens=100)
    guard.reconcile(r1, actual_input_tokens=10000, actual_output_tokens=10000)
    guard.release(r1)

    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.check_admission(essential=False)
    assert exc_info.value.reason_code == "hard_stop"

    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.check_admission(essential=True)
    assert exc_info.value.reason_code == "hard_stop"


def test_check_admission_restricted_exempts_essential_callers():
    guard = _redis_guard(daily_budget_usd=0.01, monthly_budget_usd=100.0, restricted_threshold_pct=0.5, warning_threshold_pct=0.2)
    r1 = guard.reserve(provider="openai", model="gpt-4o-mini", estimated_input_tokens=50000, estimated_output_tokens=0)
    guard.reconcile(r1, actual_input_tokens=50000, actual_output_tokens=0)
    guard.release(r1)
    assert guard.get_status()["state"] == STATE_RESTRICTED

    with pytest.raises(AIBudgetDenied) as exc_info:
        guard.check_admission(essential=False)
    assert exc_info.value.reason_code == "restricted"

    guard.check_admission(essential=True)  # must not raise


def test_check_admission_allows_normal_state():
    guard = _redis_guard()
    guard.check_admission(essential=False)  # must not raise


def test_in_memory_reconcile_after_day_rollover_does_not_corrupt_new_day():
    """Regression: if a day boundary rolls over between reserve() and
    reconcile()/release(), the delta must not be applied to the *new* day's
    counters (which never saw that spend) — it should be dropped for the
    stale reservation instead of corrupting the fresh bucket with a
    negative or inflated value."""
    from app.services.ai_budget_guard import AIBudgetConfig as _Cfg
    from app.services.ai_budget_guard import _InMemoryBackend

    config = _Cfg(key_prefix="test:rollover")
    backend = _InMemoryBackend()
    t0 = time.time()

    allowed, reason, state, retry_after, day_spend, month_spend = backend.reserve(
        config=config, provider="openai", model="gpt-4o-mini",
        estimated_tokens=2000, estimated_cost=0.001, essential=False,
        request_id="req-1", now=t0,
    )
    assert allowed
    assert backend._day_spend > 0

    # Simulate the reconcile/release call landing after a real day boundary
    # (>24h later) — a legitimate race for a long-running or retried request.
    t1 = t0 + 90_000  # > 24h later

    backend.reconcile("req-1", "openai", "gpt-4o-mini", t1, actual_cost=0.5, actual_tokens=5000)
    # The new (post-rollover) day bucket must be untouched by a reservation
    # bound to the old day — it should read exactly what _roll_windows reset
    # it to (0), not a value derived from the stale reservation's delta.
    assert backend._day_spend == 0.0

    backend.release("req-1", "openai", "gpt-4o-mini", t1, refund_estimate=True)
    assert backend._day_spend == 0.0


# ─── Startup config validation ─────────────────────────────────────────────

def test_validate_numeric_config_accepts_sane_defaults():
    from app.services.ai_budget_guard import _validate_numeric_config

    _validate_numeric_config(AIBudgetConfig(key_prefix="ok"))  # must not raise


def test_validate_numeric_config_rejects_negative_limit():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="global_requests_per_minute"):
        _validate_numeric_config(AIBudgetConfig(key_prefix="ok", global_requests_per_minute=-1))


def test_validate_numeric_config_rejects_negative_budget():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="daily_budget_usd"):
        _validate_numeric_config(AIBudgetConfig(key_prefix="ok", daily_budget_usd=-5.0))


def test_validate_numeric_config_rejects_non_finite_budget():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="daily_budget_usd"):
        _validate_numeric_config(AIBudgetConfig(key_prefix="ok", daily_budget_usd=float("inf")))


def test_validate_numeric_config_rejects_unordered_thresholds():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="warning"):
        _validate_numeric_config(
            AIBudgetConfig(key_prefix="ok", warning_threshold_pct=0.9, restricted_threshold_pct=0.5)
        )


def test_validate_numeric_config_rejects_zero_ttl():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="LEASE_TTL"):
        _validate_numeric_config(AIBudgetConfig(key_prefix="ok", lease_ttl_seconds=0))


def test_validate_numeric_config_rejects_empty_key_prefix():
    from app.services.ai_budget_guard import _validate_numeric_config

    with pytest.raises(RuntimeError, match="KEY_PREFIX"):
        _validate_numeric_config(AIBudgetConfig(key_prefix="   "))
