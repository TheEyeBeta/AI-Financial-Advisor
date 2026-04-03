from __future__ import annotations

import logging
import os
from typing import Dict

import httpx

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
# Configurable via OPENAI_CLASSIFIER_MODEL env var; defaults to gpt-4o-mini.
# Keep this model lightweight — the call must complete within _CLASSIFIER_TIMEOUT seconds.
_CLASSIFIER_MODEL: str = os.getenv("OPENAI_CLASSIFIER_MODEL", "gpt-4o-mini")
_CLASSIFIER_TIMEOUT = 3.0  # seconds — must return before this or fall back to "general"

VALID_CATEGORIES = frozenset({
    "portfolio_analysis",
    "stock_research",
    "risk_assessment",
    "market_overview",
    "education",
    "general",
})

_INTENT_CLASSIFIER_PROMPT = (
    "Classify this message into exactly one category. Reply with only the "
    "category name, nothing else.\n"
    "Categories: portfolio_analysis, stock_research, risk_assessment, "
    "market_overview, education, general\n"
    "Message: {message}"
)

# ── Subagent specialist prompt blocks ──────────────────────────────────────────

SUBAGENT_PROMPTS: Dict[str, str] = {
    "portfolio_analysis": (
        "=== PORTFOLIO ANALYST MODE ===\n"
        "The user is asking about their portfolio. You have their positions and "
        "goal data in the Meridian context above. Use it. Do not ask them what "
        "they hold — you already know. Focus on: current allocation, performance "
        "against goals, risk concentration, and actionable next steps.\n"
        "State every figure you use. If a figure is absent from the context, "
        "say so — do not estimate."
    ),
    "stock_research": (
        "=== STOCK RESEARCH MODE ===\n"
        "The user wants analysis on a specific stock or set of stocks. Lead with "
        "the scoring data if present in the injected context. Structure your "
        "response: Signal → Thesis → Risk → Context (macro conditions).\n"
        "Price history and fundamentals for the requested ticker are in the "
        "=== PRICE HISTORY === and === FUNDAMENTALS === sections above. "
        "Always reference the 90-day price change and current RSI before "
        "giving a directional view. Never state a price that is not in the "
        "injected data.\n"
        "Do not generate price targets. Do not generate earnings estimates. "
        "If score data is absent for a ticker, say so and offer the analytical "
        "framework instead."
    ),
    "risk_assessment": (
        "=== RISK ASSESSMENT MODE ===\n"
        "The user is asking about risk — to a position, their portfolio, or the "
        "market. Be precise about what type of risk: market risk, concentration "
        "risk, liquidity risk, or macro risk. Use the Meridian risk alerts if "
        "present. Quantify where data allows. Flag what you cannot quantify "
        "and why."
    ),
    "market_overview": (
        "=== MARKET INTELLIGENCE MODE ===\n"
        "The user wants a view on the current market. Use the injected market data "
        "and news context. Lead with what the data shows, not with narrative. "
        "Structure: Macro picture → Sector signals → Key risks → What to watch. "
        "Distinguish clearly between what the injected data shows and what you "
        "are reasoning from training knowledge.\n"
        "Current macro context is in the === MACRO CONTEXT === section above. "
        "Lead with the regime classification and VIX level before anything else. "
        "If the yield curve spread is negative, flag this explicitly — "
        "it is the single most important macro signal for long-term investors."
    ),
    "education": (
        "=== EDUCATION MODE ===\n"
        "The user is learning. Adapt to their knowledge tier from the Meridian "
        "context. Build understanding, not just answers. Use the Socratic method "
        "where appropriate. Never make them feel behind. Connect every concept "
        "to their actual financial situation if Meridian data is available."
    ),
    "general": "",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def _has_positions_data(meridian_context: str) -> bool:
    """Return True only when the Meridian context string contains position data.

    Prevents the portfolio_analysis block from being injected when there is
    nothing for IRIS to reason about, which would cause it to hallucinate
    or confusingly claim data is present that isn't.
    """
    if not meridian_context:
        return False
    lower = meridian_context.lower()
    return any(k in lower for k in ("position", "holding", "portfolio", "allocation"))


# ── Public API ─────────────────────────────────────────────────────────────────

async def classify_intent(last_user_message: str) -> str:
    """Classify the user's last message into one of the six routing categories.

    Uses a lightweight gpt-4o-mini call with a hard 3-second timeout.
    Always returns a member of VALID_CATEGORIES; falls back to "general" on
    any error, unexpected value, or timeout.
    """
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        logger.debug("IRIS subagent: OPENAI_API_KEY absent, defaulting to general")
        return "general"

    prompt = _INTENT_CLASSIFIER_PROMPT.format(message=last_user_message[:2000])
    payload = {
        "model": _CLASSIFIER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 20,
        "temperature": 0,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openai_api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=_CLASSIFIER_TIMEOUT) as client:
            response = await client.post(_OPENAI_ENDPOINT, headers=headers, json=payload)

        if response.status_code != 200:
            logger.debug(
                "IRIS subagent classifier returned HTTP %d, defaulting to general",
                response.status_code,
            )
            return "general"

        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return "general"

        raw = choices[0].get("message", {}).get("content", "").strip().lower()

        # Exact match — the happy path
        if raw in VALID_CATEGORIES:
            return raw

        # Fuzzy match: model may have returned "portfolio_analysis." or wrapped text
        for cat in VALID_CATEGORIES:
            if cat in raw:
                return cat

        logger.debug(
            "IRIS subagent: unexpected classifier output %r, defaulting to general", raw
        )
        return "general"

    except httpx.TimeoutException:
        logger.debug("IRIS subagent: classifier timed out, defaulting to general")
        return "general"
    except Exception as exc:
        logger.debug("IRIS subagent: classifier error %s, defaulting to general", exc)
        return "general"


def get_subagent_block(category: str, meridian_context: str = "") -> str:
    """Return the specialist prompt block for the given intent category.

    Safety guarantees:
    - Any unrecognised category returns "" (SUBAGENT_PROMPTS.get default).
    - portfolio_analysis only injects when positions data is present in the
      Meridian context; otherwise returns "" to avoid hallucination.
    """
    # Conditional injection: portfolio block requires actual positions data
    if category == "portfolio_analysis" and not _has_positions_data(meridian_context):
        logger.debug(
            "IRIS subagent: portfolio_analysis requested but no positions data in context, "
            "skipping block injection"
        )
        return ""

    return SUBAGENT_PROMPTS.get(category, "")
