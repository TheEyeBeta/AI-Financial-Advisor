"""Tests for the atomic invite-redemption primitive (Part 7).

The headline test proves the anti-oversubscription property under *real thread
concurrency*: when a single-use invite is hammered by many threads at once,
exactly one redemption succeeds.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.services.invite_redemption import (
    InMemoryInviteLedger,
    RedeemReason,
    generate_invite_code,
)

NOW = datetime(2026, 7, 21, tzinfo=timezone.utc)


def test_invite_code_is_strong_and_unique():
    codes = {generate_invite_code() for _ in range(1000)}
    assert len(codes) == 1000               # no collisions
    assert all(len(c) >= 20 for c in codes)  # ~128-bit entropy, URL-safe


def test_single_use_then_exhausted():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=1)
    assert ledger.redeem(inv.code).success is True
    r2 = ledger.redeem(inv.code)
    assert r2.success is False
    assert r2.reason == RedeemReason.EXHAUSTED


def test_multi_use_allows_exactly_n():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=3)
    successes = sum(ledger.redeem(inv.code).success for _ in range(10))
    assert successes == 3


def test_revocation_blocks_redemption():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=5)
    assert ledger.revoke(inv.code) is True
    r = ledger.redeem(inv.code)
    assert not r.success and r.reason == RedeemReason.REVOKED


def test_expiry_blocks_redemption():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=1, expires_at=NOW - timedelta(hours=1))
    r = ledger.redeem(inv.code, now=NOW)
    assert not r.success and r.reason == RedeemReason.EXPIRED


def test_email_binding_enforced():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=1, email_binding="alice@example.com")
    assert ledger.redeem(inv.code, email="bob@example.com").reason == RedeemReason.EMAIL_MISMATCH
    assert ledger.redeem(inv.code, email="ALICE@example.com").success is True  # case-insensitive


def test_unknown_code_is_not_found():
    ledger = InMemoryInviteLedger()
    assert ledger.redeem("nope").reason == RedeemReason.NOT_FOUND


def test_audit_trail_records_every_attempt():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=1)
    ledger.redeem(inv.code)
    ledger.redeem(inv.code)
    assert len(ledger.audit) == 2
    assert [a["success"] for a in ledger.audit] == [True, False]


# ── the anti-oversubscription concurrency proof ─────────────────────────────

@pytest.mark.parametrize("threads", [50, 200])
def test_only_one_thread_redeems_the_final_use(threads):
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=1)

    def attempt(_):
        return ledger.redeem(inv.code, email="beta@example.com").success

    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(attempt, range(threads)))

    assert sum(results) == 1                       # exactly one winner
    assert inv.used == 1                            # no over-consumption
    assert len(ledger.audit) == threads            # every attempt recorded


def test_concurrent_multi_use_never_exceeds_capacity():
    ledger = InMemoryInviteLedger()
    inv = ledger.create(max_uses=10)

    def attempt(_):
        return ledger.redeem(inv.code).success

    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(attempt, range(500)))

    assert sum(results) == 10                       # never oversubscribed
    assert inv.used == 10
