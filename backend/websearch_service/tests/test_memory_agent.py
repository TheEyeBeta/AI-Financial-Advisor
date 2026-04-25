"""Tests for memory_agent.py — transcript helpers, OpenAI extraction, DB upsert, cycles."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.memory_agent import (
    _call_openai_for_insights,
    _count_user_insights_sync,
    _fetch_messages_sync,
    _fetch_unprocessed_chats_sync,
    _fetch_all_unprocessed_chats_sync,
    _format_transcript,
    _upsert_insight_sync,
    extract_insights_from_chat,
    run_history_scan,
    run_memory_extraction_cycle,
)


# ── Mock helpers ───────────────────────────────────────────────────────────────

def _supabase_chain(data=None):
    chain = MagicMock()
    rows = data if data is not None else []
    result = MagicMock()
    result.data = rows
    chain.execute.return_value = result
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.in_.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.filter.return_value = chain
    chain.upsert.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.not_ = MagicMock()
    chain.not_.is_ = MagicMock(return_value=chain)
    # maybe_single returns the first row as a dict (mirrors real supabase behaviour)
    single_chain = MagicMock()
    single_result = MagicMock()
    single_result.data = rows[0] if rows else None
    single_chain.execute.return_value = single_result
    chain.maybe_single.return_value = single_chain
    return chain


def _client(tables: dict):
    client = MagicMock()

    def schema_fn(s):
        sm = MagicMock()

        def table_fn(t):
            data = tables.get((s, t), [])
            return _supabase_chain(data)

        sm.table = MagicMock(side_effect=table_fn)
        return sm

    client.schema = MagicMock(side_effect=schema_fn)
    return client


# ── _format_transcript ─────────────────────────────────────────────────────────

class TestFormatTranscript:
    def test_empty_messages(self):
        assert _format_transcript([]) == ""

    def test_user_and_assistant(self):
        msgs = [
            {"role": "user", "content": "What is a stock?"},
            {"role": "assistant", "content": "A stock is a share of ownership."},
        ]
        result = _format_transcript(msgs)
        assert "[User]: What is a stock?" in result
        assert "[IRIS]: A stock is a share of ownership." in result

    def test_skips_empty_content(self):
        msgs = [
            {"role": "user", "content": ""},
            {"role": "user", "content": "Hello"},
        ]
        result = _format_transcript(msgs)
        assert result == "[User]: Hello"

    def test_unknown_role_gets_iris_label(self):
        msgs = [{"role": "system", "content": "You are helpful."}]
        result = _format_transcript(msgs)
        assert "[IRIS]:" in result

    def test_none_content_skipped(self):
        msgs = [{"role": "user", "content": None}]
        result = _format_transcript(msgs)
        assert result == ""


# ── _fetch_messages_sync ───────────────────────────────────────────────────────

class TestFetchMessagesSync:
    def test_returns_reversed_messages(self):
        raw = [
            {"role": "assistant", "content": "Hi", "created_at": "2026-04-24T12:01:00"},
            {"role": "user", "content": "Hello", "created_at": "2026-04-24T12:00:00"},
        ]
        client = _client({("ai", "chat_messages"): raw})
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_messages_sync("chat-1")
        # reversed: oldest first → user "Hello" (12:00) comes before assistant "Hi" (12:01)
        assert result[0]["content"] == "Hello"
        assert result[1]["content"] == "Hi"

    def test_exception_returns_empty_list(self):
        client = MagicMock()
        client.schema.side_effect = Exception("DB error")
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_messages_sync("chat-1")
        assert result == []


# ── _fetch_unprocessed_chats_sync ──────────────────────────────────────────────

class TestFetchUnprocessedChatsSync:
    def test_returns_unprocessed(self):
        chats = [{"id": "chat-1", "user_id": "auth-1"}]
        client = _client({
            ("meridian", "user_insights"): [],
            ("ai", "chats"): chats,
        })
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_unprocessed_chats_sync(
                "2026-04-23T00:00:00+00:00",
                "2026-04-24T00:00:00+00:00",
                20,
            )
        assert result == chats

    def test_exception_returns_empty_list(self):
        client = MagicMock()
        client.schema.side_effect = Exception("DB error")
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_unprocessed_chats_sync("lower", "upper", 20)
        assert result == []


# ── _fetch_all_unprocessed_chats_sync ─────────────────────────────────────────

class TestFetchAllUnprocessedChatsSync:
    def test_returns_chats(self):
        chats = [{"id": "chat-1", "user_id": "auth-1"}]
        client = _client({
            ("meridian", "user_insights"): [],
            ("ai", "chats"): chats,
        })
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_all_unprocessed_chats_sync(50)
        assert result == chats

    def test_exception_returns_empty(self):
        client = MagicMock()
        client.schema.side_effect = Exception("err")
        with patch("app.services.memory_agent.supabase_client", client):
            result = _fetch_all_unprocessed_chats_sync(50)
        assert result == []


# ── _count_user_insights_sync ──────────────────────────────────────────────────

class TestCountUserInsightsSync:
    def test_returns_count(self):
        rows = [{"id": f"ins-{i}"} for i in range(5)]
        client = _client({("meridian", "user_insights"): rows})
        with patch("app.services.memory_agent.supabase_client", client):
            result = _count_user_insights_sync()
        assert result == 5

    def test_exception_returns_zero(self):
        client = MagicMock()
        client.schema.side_effect = Exception("err")
        with patch("app.services.memory_agent.supabase_client", client):
            result = _count_user_insights_sync()
        assert result == 0


# ── _upsert_insight_sync ───────────────────────────────────────────────────────

class TestUpsertInsightSync:
    def _insight(self, **kwargs):
        base = {"insight_type": "financial_fact", "key": "risk_tolerance",
                "value": "high", "confidence": 0.9}
        base.update(kwargs)
        return base

    def test_writes_new_insight(self):
        chain = _supabase_chain(None)  # no existing row
        chain.execute.return_value.data = None
        client = MagicMock()
        client.schema.return_value.table.return_value = chain

        with patch("app.services.memory_agent.supabase_client", client):
            result = _upsert_insight_sync("auth-1", self._insight(), "chat-1")
        assert result is True

    def test_skips_when_existing_has_higher_confidence(self):
        existing_chain = _supabase_chain([{"confidence": 0.95}])
        upsert_chain = _supabase_chain([])

        call_count = [0]

        def table_fn(table_name):
            call_count[0] += 1
            if call_count[0] == 1:
                return existing_chain
            return upsert_chain

        client = MagicMock()
        client.schema.return_value.table = MagicMock(side_effect=table_fn)

        with patch("app.services.memory_agent.supabase_client", client):
            result = _upsert_insight_sync("auth-1", self._insight(confidence=0.8), "chat-1")
        assert result is False

    def test_overwrites_lower_confidence_existing(self):
        existing_chain = _supabase_chain([{"confidence": 0.7}])
        upsert_chain = _supabase_chain([])

        call_count = [0]

        def table_fn(table_name):
            call_count[0] += 1
            if call_count[0] == 1:
                return existing_chain
            return upsert_chain

        client = MagicMock()
        client.schema.return_value.table = MagicMock(side_effect=table_fn)

        with patch("app.services.memory_agent.supabase_client", client):
            result = _upsert_insight_sync("auth-1", self._insight(confidence=0.9), "chat-1")
        assert result is True

    def test_exception_returns_false(self):
        client = MagicMock()
        client.schema.side_effect = Exception("DB error")
        with patch("app.services.memory_agent.supabase_client", client):
            result = _upsert_insight_sync("auth-1", self._insight(), "chat-1")
        assert result is False


# ── _call_openai_for_insights ─────────────────────────────────────────────────

class TestCallOpenaiForInsights:
    def test_no_api_key_returns_empty(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript text")
            )
        assert result == []

    def test_successful_extraction(self):
        insights = [
            {"insight_type": "financial_fact", "key": "risk_tolerance",
             "value": "high", "confidence": 0.9},
        ]
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": json.dumps(insights)}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("User said they love risk.")
            )
        assert len(result) == 1
        assert result[0]["key"] == "risk_tolerance"

    def test_filters_low_confidence(self):
        insights = [
            {"insight_type": "financial_fact", "key": "risk_tolerance",
             "value": "high", "confidence": 0.9},
            {"insight_type": "financial_fact", "key": "low_conf",
             "value": "maybe", "confidence": 0.5},  # below threshold
        ]
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": json.dumps(insights)}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert len(result) == 1
        assert result[0]["key"] == "risk_tolerance"

    def test_http_error_returns_empty(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_json_parse_error_returns_empty(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "not valid json {{{"}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_non_array_response_returns_empty(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": '{"key": "val"}'}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_empty_choices_returns_empty(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"choices": []}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_timeout_returns_empty(self):
        import httpx
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_generic_exception_returns_empty(self):
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("network error"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert result == []

    def test_markdown_fenced_json_stripped(self):
        insights = [{"insight_type": "financial_fact", "key": "k", "value": "v", "confidence": 0.9}]
        fenced = f"```json\n{json.dumps(insights)}\n```"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": fenced}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _call_openai_for_insights("transcript")
            )
        assert len(result) == 1


# ── extract_insights_from_chat ────────────────────────────────────────────────

class TestExtractInsightsFromChat:
    def _make_messages(self, n_user=3):
        msgs = []
        for i in range(n_user):
            msgs.append({"role": "user", "content": f"User msg {i}", "created_at": f"2026-04-24T12:0{i}:00"})
            msgs.append({"role": "assistant", "content": f"IRIS reply {i}", "created_at": f"2026-04-24T12:0{i}:30"})
        return list(reversed(msgs))  # DB returns newest-first, will be reversed back

    def test_insufficient_messages_skips(self):
        msgs = [{"role": "user", "content": "Hi", "created_at": "t1"}]  # only 1 user msg
        client = _client({("ai", "chat_messages"): msgs})
        with patch("app.services.memory_agent.supabase_client", client):
            result = asyncio.get_event_loop().run_until_complete(
                extract_insights_from_chat("chat-1", "auth-1")
            )
        assert result["insights_extracted"] == 0
        assert result["reason"] == "insufficient_messages"

    def test_no_insights_from_openai(self):
        msgs = self._make_messages(3)
        client = _client({("ai", "chat_messages"): msgs})
        with patch("app.services.memory_agent.supabase_client", client), \
             patch(
                 "app.services.memory_agent._call_openai_for_insights",
                 new=AsyncMock(return_value=[]),
             ):
            result = asyncio.get_event_loop().run_until_complete(
                extract_insights_from_chat("chat-1", "auth-1")
            )
        assert result["insights_extracted"] == 0
        assert result["insights_written"] == 0

    def test_insights_written(self):
        msgs = self._make_messages(3)
        insights = [
            {"insight_type": "financial_fact", "key": "risk_tolerance",
             "value": "high", "confidence": 0.9},
        ]
        existing_chain = _supabase_chain(None)
        existing_chain.execute.return_value.data = None
        upsert_chain = _supabase_chain([])

        call_count = [0]

        def table_fn(table_name):
            call_count[0] += 1
            if table_name == "chat_messages":
                return _supabase_chain(msgs)
            if table_name == "user_insights":
                if call_count[0] <= 3:
                    return existing_chain
                return upsert_chain
            return _supabase_chain([])

        client = MagicMock()
        client.schema.return_value.table = MagicMock(side_effect=table_fn)

        with patch("app.services.memory_agent.supabase_client", client), \
             patch(
                 "app.services.memory_agent._call_openai_for_insights",
                 new=AsyncMock(return_value=insights),
             ):
            result = asyncio.get_event_loop().run_until_complete(
                extract_insights_from_chat("chat-1", "auth-1")
            )
        assert result["insights_extracted"] == 1


# ── run_memory_extraction_cycle ───────────────────────────────────────────────

class TestRunMemoryExtractionCycle:
    def test_skips_when_already_running(self):
        import app.services.memory_agent as ma
        ma._cycle_running = True
        try:
            result = asyncio.get_event_loop().run_until_complete(
                run_memory_extraction_cycle()
            )
            assert result["skipped"] is True
        finally:
            ma._cycle_running = False

    def test_no_chats_returns_zero(self):
        with patch(
            "app.services.memory_agent._fetch_unprocessed_chats_sync",
            return_value=[],
        ):
            result = asyncio.get_event_loop().run_until_complete(
                run_memory_extraction_cycle()
            )
        assert result["chats_processed"] == 0

    def test_processes_chats(self):
        chats = [{"id": "chat-1", "user_id": "auth-1"}]

        async def fake_extract(chat_id, user_id):
            return {"insights_extracted": 2, "insights_written": 2, "failed": 0}

        with patch(
            "app.services.memory_agent._fetch_unprocessed_chats_sync",
            return_value=chats,
        ), patch(
            "app.services.memory_agent.extract_insights_from_chat",
            new=AsyncMock(side_effect=fake_extract),
        ), patch("asyncio.sleep", new=AsyncMock()):
            result = asyncio.get_event_loop().run_until_complete(
                run_memory_extraction_cycle()
            )
        assert result["chats_processed"] == 1
        assert result["total_insights_extracted"] == 2

    def test_skips_chats_without_id_or_user(self):
        chats = [{"id": "", "user_id": "auth-1"}, {"id": "chat-1", "user_id": ""}]
        with patch(
            "app.services.memory_agent._fetch_unprocessed_chats_sync",
            return_value=chats,
        ), patch("asyncio.sleep", new=AsyncMock()):
            result = asyncio.get_event_loop().run_until_complete(
                run_memory_extraction_cycle()
            )
        assert result["chats_processed"] == 0

    def test_resets_lock_after_run(self):
        import app.services.memory_agent as ma
        with patch(
            "app.services.memory_agent._fetch_unprocessed_chats_sync",
            return_value=[],
        ):
            asyncio.get_event_loop().run_until_complete(run_memory_extraction_cycle())
        assert ma._cycle_running is False


# ── run_history_scan ───────────────────────────────────────────────────────────

class TestRunHistoryScan:
    def test_no_chats_returns_zero(self):
        with patch(
            "app.services.memory_agent._fetch_all_unprocessed_chats_sync",
            return_value=[],
        ):
            result = asyncio.get_event_loop().run_until_complete(run_history_scan(50))
        assert result["chats_processed"] == 0

    def test_processes_chats(self):
        chats = [{"id": f"chat-{i}", "user_id": f"auth-{i}"} for i in range(3)]

        async def fake_extract(chat_id, user_id):
            return {"insights_extracted": 1, "insights_written": 1, "failed": 0}

        with patch(
            "app.services.memory_agent._fetch_all_unprocessed_chats_sync",
            return_value=chats,
        ), patch(
            "app.services.memory_agent.extract_insights_from_chat",
            new=AsyncMock(side_effect=fake_extract),
        ), patch("asyncio.sleep", new=AsyncMock()):
            result = asyncio.get_event_loop().run_until_complete(run_history_scan(50))
        assert result["chats_processed"] == 3
        assert result["total_insights_extracted"] == 3

    def test_skips_missing_id_or_user(self):
        chats = [{"id": "", "user_id": "auth-1"}]
        with patch(
            "app.services.memory_agent._fetch_all_unprocessed_chats_sync",
            return_value=chats,
        ), patch("asyncio.sleep", new=AsyncMock()):
            result = asyncio.get_event_loop().run_until_complete(run_history_scan(50))
        assert result["chats_processed"] == 0
