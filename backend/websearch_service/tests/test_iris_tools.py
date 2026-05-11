"""Tests for app.services.iris_tools — tool schema and dispatcher."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import iris_tools
from app.services.iris_tools import (
    TOOL_DEFINITIONS,
    _build_why_top,
    execute_tool,
    search_market_news_data,
)


# ─── TOOL_DEFINITIONS schema contract ───────────────────────────────────────

def test_tool_definitions_expose_three_tools():
    names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
    assert names == {"get_portfolio", "get_top_stocks", "search_market_news"}


def test_tool_definitions_all_have_function_type():
    for tool in TOOL_DEFINITIONS:
        assert tool["type"] == "function"
        assert "name" in tool["function"]
        assert "parameters" in tool["function"]


def test_search_market_news_requires_query_arg():
    news_tool = next(
        t for t in TOOL_DEFINITIONS if t["function"]["name"] == "search_market_news"
    )
    assert news_tool["function"]["parameters"]["required"] == ["query"]


# ─── _build_why_top ────────────────────────────────────────────────────────

def test_build_why_top_picks_highest_two_scoring_dimensions():
    stock = {
        "momentum_score": 85.0,
        "trend_score": 70.0,
        "volume_score": 40.0,
        "adx_score": 20.0,
        "conviction": "High",
    }
    why = _build_why_top(stock)
    assert "strong momentum" in why
    assert "confirmed uptrend" in why
    assert "High conviction" in why
    # Lower-ranked dimensions should not appear.
    assert "directional strength" not in why


def test_build_why_top_with_all_zero_scores_returns_placeholder():
    stock = {
        "momentum_score": 0,
        "trend_score": 0,
        "volume_score": 0,
        "adx_score": 0,
    }
    assert _build_why_top(stock) == "Ranked by composite score."


# ─── search_market_news_data ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_market_news_without_api_key(monkeypatch):
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "")
    result = await search_market_news_data("AAPL")
    assert "error" in result
    assert result["query"] == "AAPL"


@pytest.mark.asyncio
async def test_search_market_news_returns_answer_and_sources(monkeypatch):
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "tvly-test")

    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "answer": "AAPL is up on strong earnings.",
        "results": [
            {"title": "AAPL beats", "url": "https://a.test", "content": "x" * 1000},
            {"title": "Sales up", "url": "https://b.test", "content": "Short body"},
        ],
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(iris_tools.httpx, "AsyncClient", return_value=mock_client):
        result = await search_market_news_data("AAPL earnings")

    assert result["query"] == "AAPL earnings"
    assert result["answer"].startswith("AAPL is up")
    assert len(result["sources"]) == 2
    # Sources must be truncated to 500 chars.
    assert all(len(s["content"]) <= 500 for s in result["sources"])


@pytest.mark.asyncio
async def test_search_market_news_http_non_200_returns_error(monkeypatch):
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "tvly-test")

    mock_response = MagicMock(status_code=500)
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(iris_tools.httpx, "AsyncClient", return_value=mock_client):
        result = await search_market_news_data("AAPL")

    assert "error" in result
    assert "HTTP 500" in result["error"]


@pytest.mark.asyncio
async def test_search_market_news_timeout_returns_error(monkeypatch):
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "tvly-test")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("slow"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(iris_tools.httpx, "AsyncClient", return_value=mock_client):
        result = await search_market_news_data("AAPL")

    assert result == {"error": "Search timed out", "query": "AAPL"}


# ─── execute_tool dispatcher ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_execute_tool_portfolio_delegates_to_get_portfolio_data():
    expected = {"portfolio_value": 1000.0, "data_as_of": "2026-04-20"}
    with patch.object(iris_tools, "get_portfolio_data", new=AsyncMock(return_value=expected)):
        result_str = await execute_tool("get_portfolio", {}, "auth-1")

    assert json.loads(result_str) == expected


@pytest.mark.asyncio
async def test_execute_tool_top_stocks_parses_limit_arg():
    spy = AsyncMock(return_value={"top_stocks": []})
    with patch.object(iris_tools, "get_top_stocks_data", new=spy):
        await execute_tool("get_top_stocks", {"limit": "15"}, "auth-1")

    spy.assert_awaited_once_with(15)


@pytest.mark.asyncio
async def test_execute_tool_top_stocks_defaults_to_ten_on_bad_limit():
    spy = AsyncMock(return_value={"top_stocks": []})
    with patch.object(iris_tools, "get_top_stocks_data", new=spy):
        await execute_tool("get_top_stocks", {"limit": "abc"}, "auth-1")

    spy.assert_awaited_once_with(10)


@pytest.mark.asyncio
async def test_execute_tool_search_news_missing_query_returns_error():
    result_str = await execute_tool("search_market_news", {"query": "  "}, "auth-1")
    parsed = json.loads(result_str)
    assert "error" in parsed
    assert parsed["query"] == ""


@pytest.mark.asyncio
async def test_execute_tool_unknown_tool_returns_error():
    result_str = await execute_tool("no_such_tool", {}, "auth-1")
    parsed = json.loads(result_str)
    assert parsed["error"].startswith("Unknown tool")


@pytest.mark.asyncio
async def test_execute_tool_swallows_unexpected_exceptions():
    with patch.object(
        iris_tools,
        "get_portfolio_data",
        new=AsyncMock(side_effect=RuntimeError("db crash")),
    ):
        result_str = await execute_tool("get_portfolio", {}, "auth-1")

    parsed = json.loads(result_str)
    assert "error" in parsed
    assert parsed["tool"] == "get_portfolio"
