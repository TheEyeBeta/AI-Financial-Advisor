from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Dict

import httpx

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
# Configurable via OPENAI_CLASSIFIER_MODEL env var; defaults to gpt-4o-mini.
# Keep this model lightweight — the call must complete within _CLASSIFIER_TIMEOUT seconds.
_CLASSIFIER_MODEL: str = os.getenv("OPENAI_CLASSIFIER_MODEL", "gpt-4o-mini")
_CLASSIFIER_TIMEOUT = 3.0  # seconds — must return before this or fall back to "general"
_FAST_TIER_TIMEOUT = 2.0   # seconds — tighter cap for non-financial short messages

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

# ── Tier detection constants ───────────────────────────────────────────────────

# Matches any financial domain term using whole-word boundaries (case-insensitive).
# A BALANCED tier is forced whenever any of these appear, regardless of message length.
FINANCIAL_KEYWORDS = re.compile(
    r"\b(?:stock|share|price|portfolio|invest|trade|market|etf|fund|crypto|bitcoin|"
    r"dividend|return|profit|loss|risk|valuation|pe\s+ratio|earnings|revenue|forecast|"
    r"sector|ipo|bond|yield|inflation|interest\s+rate|recession|gdp|equity|hedge|"
    r"bullish|bearish|technical|fundamental|momentum|rsi|macd|moving\s+average|"
    r"reconcil|vat|payroll|invoic|bookkeep|account)\b",
    re.IGNORECASE,
)

# Trivial "atoms" — each is a standalone phrase a user might send with no financial intent.
# Phrases with embedded punctuation (what?, huh?, really?) use escaped metacharacters.
_TRIVIAL_ATOMS: list[str] = [
    "hey", "hi", "hello", "hiya", "howdy", "yo", "sup",
    "ok", "okay", "okok", "sure", r"got\s+it",
    "thanks", r"thank\s+you", "thx", "ty",
    "yes", "no", "yep", "nope", "nah", "yeah",
    "good", "great", "nice", "cool", "awesome", "perfect",
    "bye", "goodbye", r"see\s+ya", "later",
    r"what\?", r"huh\?", r"really\?",
    "continue", r"go\s+on", r"tell\s+me\s+more", "more",
]
_ATOM_PAT = r"(?:" + "|".join(_TRIVIAL_ATOMS) + r")"

# Anchored so that a message like "hey what is my stock portfolio?" does NOT match.
# Allows one or more consecutive trivial atoms (e.g. "ok thanks") with optional
# punctuation separators and a trailing punctuation/space suffix.
TRIVIAL_PATTERNS = re.compile(
    r"^\s*" + _ATOM_PAT + r"(?:[!?.,\s]+" + _ATOM_PAT + r")*[!?.,\s]*$",
    re.IGNORECASE,
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


async def _classify_via_api(message: str, timeout: float) -> str:
    """Make the OpenAI classifier API call and return a member of VALID_CATEGORIES.

    All error and timeout paths return "general" so callers never see an exception.
    """
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        logger.debug("IRIS subagent: OPENAI_API_KEY absent, defaulting to general")
        return "general"

    prompt = _INTENT_CLASSIFIER_PROMPT.format(message=message[:2000])
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
        async with httpx.AsyncClient(timeout=timeout) as client:
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


# ── Regex intent classification patterns (precompiled) ─────────────────────────

_REGEX_PORTFOLIO_PAT = re.compile(
    r"\bmy\s+(?:portfolio|positions|holdings|allocation|stocks|investments|returns|performance)\b"
    r"|\brebalance\b"
    r"|\bhow\s+am\s+i\s+doing\b",
    re.IGNORECASE,
)

# Ticker alone is sufficient; these keywords only fire when paired with a
# financial-domain context (re-uses the existing FINANCIAL_KEYWORDS guard).
_REGEX_STOCK_PAT = re.compile(
    r"\b(?:buy|sell|analysis|analyse|analyze|score|research|valuation|earnings|revenue|fundamentals|technical)\b"
    r"|\bprice\s+target\b",
    re.IGNORECASE,
)

_REGEX_RISK_PAT = re.compile(
    r"\b(?:risk|exposure|hedge|drawdown|volatility|downside|danger|safe|worst\s+case|lose\s+money)\b",
    re.IGNORECASE,
)

_REGEX_MARKET_PAT = re.compile(
    r"\b(?:market|macro|economy|sector|vix|nasdaq|index|indices|overall|economic)\b"
    r"|\bs&p\b"
    r"|\bbroad\s+market\b",
    re.IGNORECASE,
)

_REGEX_EDUCATION_PAT = re.compile(
    r"\b(?:what\s+is|what\s+are|how\s+does|how\s+do|explain|teach\s+me|what\s+does|define|why\s+does|why\s+is)\b"
    r"|\bmeaning\s+of\b"
    r"|\bdifference\s+between\b"
    r"|\bhelp\s+me\s+understand\b",
    re.IGNORECASE,
)

# ── Public API ─────────────────────────────────────────────────────────────────

def classify_tier(message: str) -> str:
    """Classify a raw message into one of three routing tiers with zero I/O.

    Returns one of: "INSTANT", "FAST", or "BALANCED".

    Decision logic (first match wins):
    - INSTANT: short trivial social phrase → skip the API call entirely.
    - FAST:    short, non-financial message → use a 2-second API timeout cap.
    - BALANCED: everything else → full 3-second timeout, normal routing.
    """
    stripped = message.strip()

    if len(stripped) < 60 and TRIVIAL_PATTERNS.fullmatch(stripped):
        tier = "INSTANT"
    elif len(stripped) < 200 and not FINANCIAL_KEYWORDS.search(stripped):
        tier = "FAST"
    else:
        tier = "BALANCED"

    logger.debug(
        "classify_tier: tier=%s len=%d msg='%s'",
        tier,
        len(stripped),
        stripped[:40],
    )
    return tier


async def classify_intent(last_user_message: str, tier: str = "BALANCED") -> str:
    """Classify the user's last message into one of the six routing categories.

    Accepts an optional ``tier`` produced by :func:`classify_tier` to short-circuit
    or time-cap the OpenAI call:

    - ``INSTANT``: returns ``"general"`` immediately without any API call.
    - ``FAST``:    calls the API with a hard 2-second asyncio-level timeout cap.
    - ``BALANCED``: uses the normal 3-second timeout (``_CLASSIFIER_TIMEOUT``).

    Always returns a member of VALID_CATEGORIES; falls back to ``"general"`` on
    any error, unexpected value, or timeout.
    """
    t0 = time.perf_counter()
    intent = "general"

    try:
        if tier == "INSTANT":
            logger.info(
                "classify_intent: INSTANT fast-path, skipping API call | msg='%s'",
                last_user_message[:40],
            )
            return intent

        if tier == "FAST":
            try:
                intent = await asyncio.wait_for(
                    _classify_via_api(last_user_message, timeout=_FAST_TIER_TIMEOUT),
                    timeout=_FAST_TIER_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "classify_intent: FAST-tier API call exceeded %.1fs, defaulting to general",
                    _FAST_TIER_TIMEOUT,
                )
                intent = "general"
        else:  # BALANCED
            intent = await _classify_via_api(last_user_message, timeout=_CLASSIFIER_TIMEOUT)

        return intent

    finally:
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "classify_intent: tier=%s result=%s elapsed=%.1fms",
            tier,
            intent,
            elapsed,
        )


def regex_classify_intent(message: str, ticker: str | None = None) -> str:
    """Classify intent using deterministic regex — zero I/O, under 1ms.

    Returns one of the six VALID_CATEGORIES strings. Priority order is applied
    top-down; the first match wins.

    Priority:
      1. portfolio_analysis — "my portfolio/positions/…", "rebalance", "how am i doing"
      2. stock_research     — ticker detected, OR financial keywords (buy/sell/earnings/…)
      3. risk_assessment    — risk/exposure/hedge/drawdown/…
      4. market_overview    — market/macro/sector/vix/nasdaq/…
      5. education          — what is/explain/how does/…
      6. general            — fallback
    """
    msg = message.strip()

    if _REGEX_PORTFOLIO_PAT.search(msg):
        category = "portfolio_analysis"
    elif ticker is not None or (
        _REGEX_STOCK_PAT.search(msg) and FINANCIAL_KEYWORDS.search(msg)
    ):
        category = "stock_research"
    elif _REGEX_RISK_PAT.search(msg):
        category = "risk_assessment"
    elif _REGEX_MARKET_PAT.search(msg):
        category = "market_overview"
    elif _REGEX_EDUCATION_PAT.search(msg):
        category = "education"
    else:
        category = "general"

    logger.debug(
        f"regex_classify_intent: result={category} ticker={ticker} msg='{msg[:40]}'"
    )
    return category


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
