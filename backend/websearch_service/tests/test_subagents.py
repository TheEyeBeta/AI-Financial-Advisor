"""Tests for app.services.subagents — tier detection and intent routing."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import subagents
from app.services.subagents import (
    SUBAGENT_PROMPTS,
    VALID_CATEGORIES,
    classify_intent,
    classify_tier,
    get_subagent_block,
    regex_classify_intent,
)


# ─── classify_tier ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "message",
    ["hi", "hello", "ok thanks", "yes", "cool!", "tell me more"],
)
def test_classify_tier_short_trivial_phrases_are_instant(message: str):
    assert classify_tier(message) == "INSTANT"


@pytest.mark.parametrize(
    "message",
    [
        "how was your weekend?",
        "What's the weather like today in London?",
        "Can you explain recursion simply?",
    ],
)
def test_classify_tier_short_non_financial_is_fast(message: str):
    assert classify_tier(message) == "FAST"


@pytest.mark.parametrize(
    "message",
    [
        "What is my portfolio performance this quarter?",
        "Show me the top stocks ranked by momentum",
        "Should I invest in AAPL?",
        "Review of my NVDA position.",
    ],
)
def test_classify_tier_financial_messages_are_balanced(message: str):
    assert classify_tier(message) == "BALANCED"


def test_classify_tier_long_message_is_balanced_even_without_keywords():
    long_msg = "foo " * 60  # 240 chars, no financial keywords
    assert classify_tier(long_msg) == "BALANCED"


# ─── regex_classify_intent ──────────────────────────────────────────────────

def test_regex_classify_intent_detects_portfolio():
    assert regex_classify_intent("How is my portfolio doing?") == "portfolio_analysis"
    assert regex_classify_intent("I need to rebalance") == "portfolio_analysis"


def test_regex_classify_intent_risk_overrides_portfolio():
    # "how risky is my portfolio" must route to risk_assessment, not portfolio.
    assert regex_classify_intent("How risky is my portfolio?") == "risk_assessment"


def test_regex_classify_intent_detects_stock_research_via_ticker_param():
    assert regex_classify_intent("any thoughts?", ticker="NVDA") == "stock_research"


def test_regex_classify_intent_detects_stock_research_via_company():
    assert regex_classify_intent("latest news on Apple stocks") == "stock_research"


def test_regex_classify_intent_detects_market_overview():
    assert regex_classify_intent("how is the overall market doing") == "market_overview"


def test_regex_classify_intent_detects_education():
    assert regex_classify_intent("what is a dividend?") == "education"


def test_regex_classify_intent_detects_goal_tracking():
    assert regex_classify_intent("am I on track for my savings goal?") == "goal_tracking"


def test_regex_classify_intent_detects_financial_planning():
    assert regex_classify_intent("I need help with my monthly budget") == "financial_planning"


def test_regex_classify_intent_detects_deep_analysis():
    assert regex_classify_intent("give me a comprehensive breakdown") == "deep_analysis"


def test_regex_classify_intent_default_is_general():
    assert regex_classify_intent("just saying hello again") == "general"


# ─── classify_intent (async) ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_classify_intent_instant_returns_general_without_api_call():
    """INSTANT tier must not call the OpenAI API at all."""
    with patch.object(subagents, "_classify_via_api", new=AsyncMock()) as stub:
        result = await classify_intent("hi", tier="INSTANT")

    assert result == "general"
    stub.assert_not_awaited()


@pytest.mark.asyncio
async def test_classify_intent_balanced_delegates_to_api():
    with patch.object(subagents, "_classify_via_api", new=AsyncMock(return_value="stock_research")) as stub:
        result = await classify_intent("analyse AAPL", tier="BALANCED")

    assert result == "stock_research"
    stub.assert_awaited_once()
    # BALANCED tier uses the default 3-second timeout.
    assert stub.call_args.kwargs["timeout"] == subagents._CLASSIFIER_TIMEOUT


@pytest.mark.asyncio
async def test_classify_intent_fast_uses_tighter_timeout():
    with patch.object(
        subagents, "_classify_via_api", new=AsyncMock(return_value="education")
    ) as stub:
        result = await classify_intent("what is a stock?", tier="FAST")

    assert result == "education"
    assert stub.call_args.kwargs["timeout"] == subagents._FAST_TIER_TIMEOUT


@pytest.mark.asyncio
async def test_classify_intent_fast_tier_timeout_falls_back_to_general():
    async def _slow(*args, **kwargs):
        raise TimeoutError

    with patch.object(subagents, "_classify_via_api", new=AsyncMock(side_effect=TimeoutError)):
        result = await classify_intent("what is a stock?", tier="FAST")

    assert result == "general"


@pytest.mark.asyncio
async def test_classify_via_api_returns_general_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = await subagents._classify_via_api("hello", timeout=2.0)
    assert result == "general"


@pytest.mark.asyncio
async def test_classify_via_api_parses_valid_category(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "stock_research"}}]
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("analyse AAPL", timeout=2.0)

    assert result == "stock_research"


@pytest.mark.asyncio
async def test_classify_via_api_fuzzy_matches_category(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "The answer is: stock_research."}}]
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("analyse AAPL", timeout=2.0)

    assert result == "stock_research"


@pytest.mark.asyncio
async def test_classify_via_api_returns_general_on_unexpected_category(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_response = MagicMock(status_code=200)
    mock_response.json.return_value = {"choices": [{"message": {"content": "banana"}}]}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("anything", timeout=2.0)

    assert result == "general"


@pytest.mark.asyncio
async def test_classify_via_api_http_error_falls_back_to_general(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_response = MagicMock(status_code=500)
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("hello", timeout=2.0)

    assert result == "general"


@pytest.mark.asyncio
async def test_classify_via_api_timeout_exception_falls_back_to_general(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("slow"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("hello", timeout=2.0)

    assert result == "general"


@pytest.mark.asyncio
async def test_classify_via_api_generic_exception_falls_back_to_general(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=RuntimeError("boom"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(subagents.httpx, "AsyncClient", return_value=mock_client):
        result = await subagents._classify_via_api("hello", timeout=2.0)

    assert result == "general"


# ─── get_subagent_block ─────────────────────────────────────────────────────

def test_get_subagent_block_returns_prompt_for_known_category():
    block = get_subagent_block("stock_research")
    assert "STOCK RESEARCH MODE" in block


def test_get_subagent_block_unknown_category_returns_empty():
    assert get_subagent_block("nonsense") == ""


def test_get_subagent_block_portfolio_suppressed_without_positions():
    # Portfolio block must not inject if the Meridian context lacks position data.
    assert get_subagent_block("portfolio_analysis", meridian_context="no data at all") == ""


def test_get_subagent_block_portfolio_injects_when_positions_present():
    block = get_subagent_block(
        "portfolio_analysis",
        meridian_context="Positions: AAPL, MSFT in your portfolio",
    )
    assert "PORTFOLIO ANALYST MODE" in block


def test_valid_categories_matches_subagent_prompt_coverage():
    # Every category in VALID_CATEGORIES must either have a prompt or be empty ("general").
    # This guards against silent prompt regressions.
    for cat in VALID_CATEGORIES:
        block = SUBAGENT_PROMPTS.get(cat)
        assert block is not None or cat in {
            "goal_tracking",
            "financial_planning",
            "deep_analysis",
        }, f"missing prompt for {cat}"
