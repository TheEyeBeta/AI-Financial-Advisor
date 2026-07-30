"""Tests for app.services.scheduler_lock — cluster-wide lease locks.

Covers the renew()/heartbeat() addition (#293 review): the original lease
never renewed, so a cycle running longer than DEFAULT_LEASE_SECONDS let
another replica acquire the expired row and start the same cycle
concurrently.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.services import scheduler_lock


def _mock_rpc_result(data):
    result = MagicMock()
    result.data = data
    return result


@pytest.mark.asyncio
async def test_renew_returns_true_on_successful_rpc():
    with patch.object(scheduler_lock, "_call_rpc", return_value=_mock_rpc_result(True)):
        assert await scheduler_lock.renew("ranking_cycle") is True


@pytest.mark.asyncio
async def test_renew_returns_false_when_lease_no_longer_held():
    """RPC returns falsy when locked_by no longer matches this worker (lost
    the lock to another replica after expiry) — must not raise."""
    with patch.object(scheduler_lock, "_call_rpc", return_value=_mock_rpc_result(False)):
        assert await scheduler_lock.renew("ranking_cycle") is False


@pytest.mark.asyncio
async def test_renew_never_raises_on_backend_failure():
    with patch.object(scheduler_lock, "_call_rpc", side_effect=RuntimeError("db down")):
        assert await scheduler_lock.renew("ranking_cycle") is False


@pytest.mark.asyncio
async def test_heartbeat_renews_periodically_while_active():
    """The lease must be renewed at least once during a block that outlives
    the renewal interval, and the background renewal loop must stop as soon
    as the block exits."""
    with patch.object(scheduler_lock, "renew", return_value=True) as mock_renew:
        async with scheduler_lock.heartbeat("ranking_cycle", lease_seconds=3):
            # lease_seconds=3 -> renew interval ~1s; give it time to fire at least once.
            await asyncio.sleep(1.2)

    assert mock_renew.await_count >= 1
    mock_renew.assert_awaited_with("ranking_cycle", lease_seconds=3)


@pytest.mark.asyncio
async def test_heartbeat_stops_renewing_after_block_exits():
    with patch.object(scheduler_lock, "renew", return_value=True) as mock_renew:
        async with scheduler_lock.heartbeat("ranking_cycle", lease_seconds=3):
            await asyncio.sleep(1.2)
        call_count_at_exit = mock_renew.await_count
        await asyncio.sleep(1.5)

    # No further renewals after the context manager has exited.
    assert mock_renew.await_count == call_count_at_exit


@pytest.mark.asyncio
async def test_heartbeat_propagates_exception_from_block():
    with patch.object(scheduler_lock, "renew", return_value=True):
        with pytest.raises(ValueError):
            async with scheduler_lock.heartbeat("ranking_cycle", lease_seconds=3):
                raise ValueError("cycle failed")
