"""Tests for app.services.memory_agent — transcript building and OpenAI call."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import memory_agent
from app.services.memory_agent import (
    _call_openai_for_insights,
    _format_transcript,
    extract_insights_from_chat,
)


# ─── _format_transcript ─────────────────────────────────────────────────────

def test_format_transcript_labels_roles_correctly():
    msgs = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": "What should I do?"},
    ]
    result = _format_transcript(msgs)
    assert result == "[User]: Hi\n[IRIS]: Hello there\n[User]: What should I do?"


def test_format_transcript_skips_empty_content():
    msgs = [
        {"role": "user", "content": ""},
        {"role": "assistant", "content": "   "},
        {"role": "user", "content": "real message"},
    ]
    result = _format_transcript(msgs)
    assert result == "[User]: real message"


def test_format_transcript_non_user_role_uses_iris_label():
    # Any non-user role collapses to [IRIS] (system/assistant/tool).
    msgs = [{"role": "system", "content": "policy text"}]
    assert _format_transcript(msgs) == "[IRIS]: policy text"


# ─── _call_openai_for_insights ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_call_openai_returns_empty_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = await _call_openai_for_insights("transcript")
    assert result == []


@pytest.mark.asyncio
async def test_call_openai_parses_array_and_filters_low_confidence(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    payload = (
        "["
        '{"insight_type":"financial_fact","key":"risk_level","value":"high","confidence":0.9},'
        '{"insight_type":"preference","key":"horizon","value":"long","confidence":0.5}'
        "]"
    )
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"choices": [{"message": {"content": payload}}]}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        result = await _call_openai_for_insights("t")

    # Only the 0.9-confidence item passes the 0.7 threshold.
    assert len(result) == 1
    assert result[0]["key"] == "risk_level"


@pytest.mark.asyncio
async def test_call_openai_strips_markdown_fences(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    fenced = '```json\n[{"insight_type":"preference","key":"k","value":"v","confidence":0.95}]\n```'
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"choices": [{"message": {"content": fenced}}]}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        result = await _call_openai_for_insights("t")
    assert len(result) == 1
    assert result[0]["value"] == "v"


@pytest.mark.asyncio
async def test_call_openai_invalid_json_returns_empty(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"choices": [{"message": {"content": "not json"}}]}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        assert await _call_openai_for_insights("t") == []


@pytest.mark.asyncio
async def test_call_openai_non_array_json_returns_empty(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "choices": [{"message": {"content": '{"not":"an array"}'}}]
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        assert await _call_openai_for_insights("t") == []


@pytest.mark.asyncio
async def test_call_openai_http_error_returns_empty(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mock_response = MagicMock(status_code=500)
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        assert await _call_openai_for_insights("t") == []


@pytest.mark.asyncio
async def test_call_openai_timeout_returns_empty(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("slow"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(memory_agent.httpx, "AsyncClient", return_value=mock_client):
        assert await _call_openai_for_insights("t") == []


# ─── extract_insights_from_chat ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_insights_skips_short_chats(monkeypatch):
    # Fewer than 3 user messages → no extraction.
    with patch.object(
        memory_agent,
        "_fetch_messages_sync",
        return_value=[{"role": "user", "content": "hi"}],
    ):
        result = await extract_insights_from_chat("chat-1", "user-1")

    assert result["insights_extracted"] == 0
    assert result["reason"] == "insufficient_messages"


@pytest.mark.asyncio
async def test_extract_insights_returns_zero_written_when_openai_returns_empty():
    msgs = [
        {"role": "user", "content": f"Q{i}"} for i in range(5)
    ]
    with patch.object(memory_agent, "_fetch_messages_sync", return_value=msgs), \
         patch.object(memory_agent, "_call_openai_for_insights", new=AsyncMock(return_value=[])):
        result = await extract_insights_from_chat("chat-2", "user-2")
    assert result["insights_extracted"] == 0
    assert result["insights_written"] == 0


@pytest.mark.asyncio
async def test_extract_insights_writes_each_returned_insight():
    msgs = [{"role": "user", "content": f"Q{i}"} for i in range(5)]
    fake_insights = [
        {"insight_type": "financial_fact", "key": "risk", "value": "high", "confidence": 0.9},
        {"insight_type": "preference", "key": "horizon", "value": "long", "confidence": 0.85},
    ]
    upsert_spy = MagicMock(return_value=True)

    with patch.object(memory_agent, "_fetch_messages_sync", return_value=msgs), \
         patch.object(memory_agent, "_call_openai_for_insights", new=AsyncMock(return_value=fake_insights)), \
         patch.object(memory_agent, "_upsert_insight_sync", new=upsert_spy):
        result = await extract_insights_from_chat("chat-3", "user-3")

    assert result["insights_extracted"] == 2
    assert result["insights_written"] == 2
    assert result["failed"] == 0
    assert upsert_spy.call_count == 2


@pytest.mark.asyncio
async def test_extract_insights_counts_failed_upserts():
    msgs = [{"role": "user", "content": f"Q{i}"} for i in range(5)]
    fake_insights = [
        {"insight_type": "financial_fact", "key": "risk", "value": "high", "confidence": 0.9},
        {"insight_type": "preference", "key": "horizon", "value": "long", "confidence": 0.85},
    ]

    def _upsert(user_id, insight, chat_id):
        if insight["key"] == "horizon":
            raise RuntimeError("write failed")
        return True

    with patch.object(memory_agent, "_fetch_messages_sync", return_value=msgs), \
         patch.object(memory_agent, "_call_openai_for_insights", new=AsyncMock(return_value=fake_insights)), \
         patch.object(memory_agent, "_upsert_insight_sync", side_effect=_upsert):
        result = await extract_insights_from_chat("chat-4", "user-4")

    assert result["insights_extracted"] == 2
    assert result["insights_written"] == 1
    assert result["failed"] == 1
