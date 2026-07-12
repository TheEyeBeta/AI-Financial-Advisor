"""Tests for chat turn reconciliation service."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services import chat_turn_reconciliation as reconciliation


@pytest.mark.asyncio
async def test_reconciliation_marks_stale_turns_failed():
    table = MagicMock()
    select_chain = MagicMock()
    select_chain.in_.return_value = select_chain
    select_chain.lt.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.return_value = MagicMock(
        data=[{"id": "turn-1", "status": "processing"}]
    )
    table.select.return_value = select_chain

    update_chain = MagicMock()
    update_chain.eq.return_value = update_chain
    update_chain.in_.return_value = update_chain
    update_chain.execute.return_value = MagicMock(data=[{"id": "turn-1"}])
    table.update.return_value = update_chain

    schema = MagicMock()
    schema.table.return_value = table

    with patch.object(reconciliation.supabase_client, "schema", return_value=schema):
        result = await reconciliation.run_chat_turn_reconciliation()

    assert result["reconciled"] == 1
    table.update.assert_called_once()
    payload = table.update.call_args[0][0]
    assert payload["status"] == "failed"
    assert payload["failure_code"] == "stale_timeout"


@pytest.mark.asyncio
async def test_reconciliation_handles_query_failure():
    schema = MagicMock()
    table = MagicMock()
    select_chain = MagicMock()
    select_chain.in_.return_value = select_chain
    select_chain.lt.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.side_effect = RuntimeError("db down")
    table.select.return_value = select_chain
    schema.table.return_value = table

    with patch.object(reconciliation.supabase_client, "schema", return_value=schema):
        result = await reconciliation.run_chat_turn_reconciliation()

    assert result["reconciled"] == 0
    assert result["errors"]
