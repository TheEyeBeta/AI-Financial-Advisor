"""Tests for subagents.py — intent classification and tier routing."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.subagents import (
    VALID_CATEGORIES,
    _classify_via_api,
    _has_positions_data,
    classify_tier,
    classify_intent,
    regex_classify_intent,
    get_subagent_block,
    SUBAGENT_PROMPTS,
)


# ── _has_positions_data ────────────────────────────────────────────────────────

class TestHasPositionsData:
    def test_empty_string(self):
        assert _has_positions_data("") is False

    def test_none_falsy(self):
        assert _has_positions_data(None) is False  # type: ignore[arg-type]

    def test_contains_position(self):
        assert _has_positions_data("You have 1 open position") is True

    def test_contains_holding(self):
        assert _has_positions_data("Your holdings include AAPL") is True

    def test_contains_portfolio(self):
        assert _has_positions_data("Portfolio value: $10,000") is True

    def test_contains_allocation(self):
        assert _has_positions_data("Your allocation is 50% equities") is True

    def test_case_insensitive(self):
        assert _has_positions_data("PORTFOLIO overview") is True

    def test_no_keywords(self):
        assert _has_positions_data("The market is open today.") is False

    def test_partial_keyword_not_matched(self):
        # "reposition" does NOT contain the exact keyword "position" preceded by space
        # but our check is `k in lower` so "position" is in "reposition"
        assert _has_positions_data("reposition your strategy") is True


# ── classify_tier ──────────────────────────────────────────────────────────────

class TestClassifyTier:
    def test_trivial_hey(self):
        assert classify_tier("hey") == "INSTANT"

    def test_trivial_thanks(self):
        assert classify_tier("thanks") == "INSTANT"

    def test_trivial_ok_thanks(self):
        assert classify_tier("ok thanks") == "INSTANT"

    def test_trivial_with_punctuation(self):
        assert classify_tier("ok!") == "INSTANT"

    def test_trivial_multi(self):
        assert classify_tier("yes, great!") == "INSTANT"

    def test_short_non_financial(self):
        # Short and no financial keywords → FAST
        assert classify_tier("what is the weather today?") == "FAST"

    def test_financial_keyword_forces_balanced(self):
        assert classify_tier("tell me about stocks") == "BALANCED"

    def test_long_message_is_balanced(self):
        msg = "a " * 101  # > 200 chars, no financial keywords
        assert classify_tier(msg) == "BALANCED"

    def test_financial_keyword_short_is_balanced(self):
        assert classify_tier("buy AAPL") == "BALANCED"

    def test_trivial_too_long_not_instant(self):
        # > 60 chars, even if trivial words
        msg = "ok " * 25  # 75 chars
        # TRIVIAL_PATTERNS.fullmatch will match but len >= 60 so NOT INSTANT
        assert classify_tier(msg) in ("FAST", "BALANCED")

    def test_portfolio_keyword_balanced(self):
        assert classify_tier("how is my portfolio doing?") == "BALANCED"


# ── classify_intent (async) ────────────────────────────────────────────────────

class TestClassifyIntent:
    def test_instant_tier_returns_general_immediately(self):
        result = asyncio.get_event_loop().run_until_complete(
            classify_intent("hey", tier="INSTANT")
        )
        assert result == "general"

    def test_balanced_tier_calls_api(self):
        with patch(
            "app.services.subagents._classify_via_api",
            new=AsyncMock(return_value="stock_research"),
        ) as mock_api:
            result = asyncio.get_event_loop().run_until_complete(
                classify_intent("What is AAPL doing?", tier="BALANCED")
            )
        assert result == "stock_research"
        mock_api.assert_called_once()

    def test_fast_tier_calls_api_with_timeout(self):
        with patch(
            "app.services.subagents._classify_via_api",
            new=AsyncMock(return_value="education"),
        ) as mock_api:
            result = asyncio.get_event_loop().run_until_complete(
                classify_intent("What is a P/E ratio?", tier="FAST")
            )
        assert result == "education"
        mock_api.assert_called_once()

    def test_fast_tier_asyncio_timeout_returns_general(self):
        async def slow_api(*args, **kwargs):
            await asyncio.sleep(10)
            return "stock_research"

        with patch("app.services.subagents._classify_via_api", new=slow_api):
            with patch("app.services.subagents._FAST_TIER_TIMEOUT", 0.001):
                result = asyncio.get_event_loop().run_until_complete(
                    classify_intent("something", tier="FAST")
                )
        assert result == "general"

    def test_result_is_valid_category(self):
        with patch(
            "app.services.subagents._classify_via_api",
            new=AsyncMock(return_value="portfolio_analysis"),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                classify_intent("show me my portfolio", tier="BALANCED")
            )
        assert result in VALID_CATEGORIES


# ── regex_classify_intent ──────────────────────────────────────────────────────

class TestRegexClassifyIntent:
    def test_portfolio_my_portfolio(self):
        assert regex_classify_intent("show me my portfolio") == "portfolio_analysis"

    def test_portfolio_my_holdings(self):
        assert regex_classify_intent("what are my holdings?") == "portfolio_analysis"

    def test_portfolio_how_am_i_doing(self):
        assert regex_classify_intent("how am i doing?") == "portfolio_analysis"

    def test_portfolio_rebalance(self):
        assert regex_classify_intent("should I rebalance?") == "portfolio_analysis"

    def test_risk_overrides_portfolio(self):
        # "how risky is my portfolio" has both portfolio and risk keywords
        assert regex_classify_intent("how risky is my portfolio?") == "risk_assessment"

    def test_stock_research_ticker(self):
        assert regex_classify_intent("AAPL analysis", ticker="AAPL") == "stock_research"

    def test_stock_research_buy(self):
        assert regex_classify_intent("should I buy Tesla?") == "stock_research"

    def test_stock_research_top_stocks(self):
        assert regex_classify_intent("what are the top stocks right now?") == "stock_research"

    def test_stock_research_news(self):
        assert regex_classify_intent("latest news on Apple") == "stock_research"

    def test_stock_research_company_name(self):
        assert regex_classify_intent("tell me about Tesla") == "stock_research"

    def test_risk_assessment_volatility(self):
        assert regex_classify_intent("what is the market volatility risk?") == "risk_assessment"

    def test_risk_assessment_drawdown(self):
        assert regex_classify_intent("what is the drawdown risk?") == "risk_assessment"

    def test_market_overview_market(self):
        assert regex_classify_intent("what is the market doing?") == "market_overview"

    def test_market_overview_sp500(self):
        assert regex_classify_intent("S&P 500 performance today") == "market_overview"

    def test_market_overview_vix(self):
        assert regex_classify_intent("what is the VIX?") in ("market_overview", "education")

    def test_goal_tracking_goal(self):
        assert regex_classify_intent("am I on track with my savings goal?") == "goal_tracking"

    def test_goal_tracking_milestone(self):
        assert regex_classify_intent("check my milestone progress") == "goal_tracking"

    def test_financial_planning_budget(self):
        assert regex_classify_intent("help me with my budget") == "financial_planning"

    def test_financial_planning_debt(self):
        assert regex_classify_intent("how do I manage my debt?") in ("financial_planning", "education")

    def test_education_what_is(self):
        assert regex_classify_intent("what is a dividend?") == "education"

    def test_education_explain(self):
        assert regex_classify_intent("explain dollar cost averaging") == "education"

    def test_deep_analysis_compare(self):
        assert regex_classify_intent("compare AAPL vs MSFT performance") == "stock_research"

    def test_general_fallback(self):
        assert regex_classify_intent("hello there") == "general"

    def test_ticker_alone_stock_research(self):
        assert regex_classify_intent("NVDA", ticker="NVDA") == "stock_research"

    def test_result_always_valid_category(self):
        messages = [
            "hi",
            "my portfolio",
            "buy AAPL",
            "market overview",
            "what is RSI?",
            "help with budget",
            "compare everything",
        ]
        for msg in messages:
            result = regex_classify_intent(msg)
            assert result in VALID_CATEGORIES, f"{msg!r} → {result!r} not in VALID_CATEGORIES"


# ── get_subagent_block ─────────────────────────────────────────────────────────

class TestGetSubagentBlock:
    def test_portfolio_with_positions_returns_block(self):
        ctx = "You have open positions: AAPL x10"
        block = get_subagent_block("portfolio_analysis", ctx)
        assert "PORTFOLIO ANALYST" in block

    def test_portfolio_without_positions_returns_empty(self):
        ctx = "No financial data."
        block = get_subagent_block("portfolio_analysis", ctx)
        assert block == ""

    def test_portfolio_empty_context_returns_empty(self):
        block = get_subagent_block("portfolio_analysis", "")
        assert block == ""

    def test_stock_research_returns_block(self):
        block = get_subagent_block("stock_research")
        assert "STOCK RESEARCH" in block

    def test_risk_assessment_returns_block(self):
        block = get_subagent_block("risk_assessment")
        assert "RISK ASSESSMENT" in block

    def test_market_overview_returns_block(self):
        block = get_subagent_block("market_overview")
        assert "MARKET INTELLIGENCE" in block

    def test_education_returns_block(self):
        block = get_subagent_block("education")
        assert "EDUCATION" in block

    def test_general_returns_empty_string(self):
        assert get_subagent_block("general") == ""

    def test_unknown_category_returns_empty(self):
        assert get_subagent_block("unknown_category") == ""

    def test_all_valid_categories_return_string(self):
        for cat in VALID_CATEGORIES:
            result = get_subagent_block(cat)
            assert isinstance(result, str)

    def test_subagent_prompts_coverage(self):
        # All keys in SUBAGENT_PROMPTS map to strings
        for key, val in SUBAGENT_PROMPTS.items():
            assert isinstance(val, str)


# ── _classify_via_api ──────────────────────────────────────────────────────────

class TestClassifyViaApi:
    def _mock_openai(self, content: str, status_code: int = 200):
        resp = MagicMock()
        resp.status_code = status_code
        resp.json.return_value = {
            "choices": [{"message": {"content": content}}]
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        return mock_client

    def test_no_api_key_returns_general(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test message", timeout=3.0)
            )
        assert result == "general"

    def test_valid_category_returned(self):
        mock_client = self._mock_openai("portfolio_analysis")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("show me my portfolio", timeout=3.0)
            )
        assert result == "portfolio_analysis"

    def test_non_200_returns_general(self):
        mock_client = self._mock_openai("", status_code=500)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test", timeout=3.0)
            )
        assert result == "general"

    def test_empty_choices_returns_general(self):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"choices": []}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test", timeout=3.0)
            )
        assert result == "general"

    def test_fuzzy_match(self):
        # Model returned "portfolio_analysis." (with period)
        mock_client = self._mock_openai("portfolio_analysis.")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("my holdings", timeout=3.0)
            )
        assert result == "portfolio_analysis"

    def test_unexpected_output_returns_general(self):
        mock_client = self._mock_openai("unknown_category_xyz")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test", timeout=3.0)
            )
        assert result == "general"

    def test_timeout_returns_general(self):
        import httpx
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test", timeout=3.0)
            )
        assert result == "general"

    def test_generic_exception_returns_general(self):
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("network error"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("test", timeout=3.0)
            )
        assert result == "general"

    def test_result_in_valid_categories(self):
        mock_client = self._mock_openai("stock_research")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = asyncio.get_event_loop().run_until_complete(
                _classify_via_api("AAPL price", timeout=3.0)
            )
        assert result in VALID_CATEGORIES
