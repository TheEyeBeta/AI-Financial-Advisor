"""Tests for the async scheduled-cycle wrappers (ranking/memory/intelligence).

These exercise the run-lock guards and the success paths where the sync cycle
is dispatched via asyncio.to_thread.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services import intelligence_engine, memory_agent, ranking_engine


# ─── ranking_engine.run_ranking_cycle ──────────────────────────────────────

@pytest.mark.asyncio
async def test_run_ranking_cycle_skips_when_lock_held(monkeypatch):
    monkeypatch.setattr(ranking_engine, "_cycle_running", True)
    try:
        result = await ranking_engine.run_ranking_cycle()
        assert result == {"skipped": True}
    finally:
        monkeypatch.setattr(ranking_engine, "_cycle_running", False)


@pytest.mark.asyncio
async def test_run_ranking_cycle_releases_lock_after_success(monkeypatch):
    monkeypatch.setattr(ranking_engine, "_cycle_running", False)
    expected = {"tickers_scored": 0, "top_50_written": 0}
    with patch.object(ranking_engine, "_run_ranking_cycle_sync", return_value=expected):
        result = await ranking_engine.run_ranking_cycle()
    assert result == expected
    assert ranking_engine._cycle_running is False


@pytest.mark.asyncio
async def test_run_ranking_cycle_releases_lock_after_exception(monkeypatch):
    monkeypatch.setattr(ranking_engine, "_cycle_running", False)
    with patch.object(ranking_engine, "_run_ranking_cycle_sync", side_effect=RuntimeError("boom")):
        with pytest.raises(RuntimeError):
            await ranking_engine.run_ranking_cycle()
    assert ranking_engine._cycle_running is False


# ─── memory_agent.run_memory_extraction_cycle ──────────────────────────────

@pytest.mark.asyncio
async def test_run_memory_extraction_skips_when_lock_held(monkeypatch):
    monkeypatch.setattr(memory_agent, "_cycle_running", True)
    try:
        result = await memory_agent.run_memory_extraction_cycle()
        assert result["skipped"] is True
        assert result["chats_processed"] == 0
    finally:
        monkeypatch.setattr(memory_agent, "_cycle_running", False)


@pytest.mark.asyncio
async def test_run_memory_extraction_no_chats_returns_zero(monkeypatch):
    monkeypatch.setattr(memory_agent, "_cycle_running", False)
    with patch.object(memory_agent, "_fetch_unprocessed_chats_sync", return_value=[]):
        result = await memory_agent.run_memory_extraction_cycle()
    assert result == {"chats_processed": 0, "total_insights_extracted": 0, "errors": []}
    assert memory_agent._cycle_running is False


@pytest.mark.asyncio
async def test_run_memory_extraction_processes_chats_and_tracks_errors(monkeypatch):
    monkeypatch.setattr(memory_agent, "_cycle_running", False)

    # Three chats: two succeed (1 insight each), one raises.
    chats = [
        {"id": "c1", "user_id": "u1"},
        {"id": "c2", "user_id": "u2"},
        {"id": "c3", "user_id": "u3"},
    ]

    async def _extract(chat_id, user_id):
        if chat_id == "c2":
            raise RuntimeError("boom")
        return {"insights_extracted": 1}

    # Replace asyncio.sleep to keep the test fast.
    async def _nosleep(_seconds):
        return None

    with patch.object(memory_agent, "_fetch_unprocessed_chats_sync", return_value=chats), \
         patch.object(memory_agent, "extract_insights_from_chat", new=AsyncMock(side_effect=_extract)), \
         patch.object(memory_agent.asyncio, "sleep", new=AsyncMock(side_effect=_nosleep)):
        result = await memory_agent.run_memory_extraction_cycle()

    assert result["chats_processed"] == 2
    assert result["total_insights_extracted"] == 2
    assert result["errors"] == ["c2"]


@pytest.mark.asyncio
async def test_run_memory_extraction_skips_chats_missing_ids(monkeypatch):
    monkeypatch.setattr(memory_agent, "_cycle_running", False)

    async def _never_called(*_a, **_kw):
        raise AssertionError("extract should not be called")

    with patch.object(
        memory_agent, "_fetch_unprocessed_chats_sync", return_value=[{"id": "", "user_id": "u"}]
    ), patch.object(memory_agent, "extract_insights_from_chat", new=AsyncMock(side_effect=_never_called)):
        result = await memory_agent.run_memory_extraction_cycle()

    assert result["chats_processed"] == 0


# ─── intelligence_engine.run_intelligence_cycle ────────────────────────────

@pytest.mark.asyncio
async def test_run_intelligence_cycle_skips_when_lock_held(monkeypatch):
    monkeypatch.setattr(intelligence_engine, "_cycle_running", True)
    try:
        result = await intelligence_engine.run_intelligence_cycle()
        assert result["skipped"] is True
    finally:
        monkeypatch.setattr(intelligence_engine, "_cycle_running", False)


@pytest.mark.asyncio
async def test_run_intelligence_cycle_delegates_to_sync(monkeypatch):
    monkeypatch.setattr(intelligence_engine, "_cycle_running", False)
    expected = {"users_processed": 0, "digests_generated": 0, "errors": []}
    with patch.object(intelligence_engine, "_run_intelligence_cycle_sync", return_value=expected):
        result = await intelligence_engine.run_intelligence_cycle()
    assert result == expected
    assert intelligence_engine._cycle_running is False


@pytest.mark.asyncio
async def test_run_intelligence_cycle_swallows_sync_exceptions(monkeypatch):
    """run_intelligence_cycle guarantees the scheduler never sees a raised
    exception — it must convert failures into a summary dict."""
    monkeypatch.setattr(intelligence_engine, "_cycle_running", False)
    with patch.object(intelligence_engine, "_run_intelligence_cycle_sync", side_effect=RuntimeError("boom")):
        result = await intelligence_engine.run_intelligence_cycle()

    assert isinstance(result, dict)
    # Contract: always returns a dict even on unexpected failures.
    assert "errors" in result or "users_processed" in result
    assert intelligence_engine._cycle_running is False
