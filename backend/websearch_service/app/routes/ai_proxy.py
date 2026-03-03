from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..services.audit import audit_log
from ..services.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ai-proxy"])

OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"        # Chat Completions (title, quantitative)
OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses"     # Responses API (main chat + classifier)
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "").strip() or None  # Backward-compatible single-model override
if OPENAI_MODEL == "gpt-4.5":
    # Prevent stale config from forcing a retired model.
    OPENAI_MODEL = None
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", OPENAI_MODEL or "gpt-5-mini")
OPENAI_CLASSIFIER_MODEL = os.getenv("OPENAI_CLASSIFIER_MODEL", OPENAI_MODEL or "gpt-5-nano")
OPENAI_TITLE_MODEL = os.getenv("OPENAI_TITLE_MODEL", OPENAI_MODEL or "gpt-5-nano")
OPENAI_QUANT_MODEL = os.getenv("OPENAI_QUANT_MODEL", OPENAI_MODEL or "gpt-5-mini")
PERPLEXITY_API_KEY_ENV = "PERPLEXITY_API_KEY"
PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions"
PERPLEXITY_MODEL = "llama-3.1-sonar-small-128k-online"  # Cost-effective fallback model
MAX_CHAT_MESSAGE_CONTENT_LENGTH = 50000
TEST_MODE_DISCLAIMER = "Test mode only. Not financial advice."

# ── Prompts ────────────────────────────────────────────────────────────────────

CLASSIFIER_SYSTEM_PROMPT = (
    "You are a financial query classifier. Analyze the user's message and return ONLY a valid JSON object "
    "with no additional text.\n\n"
    "Classification rules:\n"
    '- complexity "high": multi-step reasoning, tax planning, investment strategy, '
    "large capital allocation (>$100k), retirement modeling\n"
    '- complexity "medium": moderate financial comparison, structured advice, portfolio analysis\n'
    '- complexity "low": general financial explanation, simple budgeting, basic definitions\n\n'
    "Return exactly this JSON structure:\n"
    '{"complexity": "low", "requires_calculation": false, "high_risk_decision": false}'
)

FINANCIAL_ADVISOR_SYSTEM_PROMPT = (
    "You are a rigorous financial analysis engine.\n\n"
    "You must:\n"
    "- Identify missing financial inputs.\n"
    "- Ask clarification questions if critical inputs are missing.\n"
    "- Perform careful calculations when needed.\n"
    "- State assumptions explicitly.\n"
    "- Provide risk-aware advice.\n"
    "- Keep the conversation focused on finance, investing, and money decisions.\n"
    "- You may answer general real-world price/cost questions when asked.\n"
    "- If asked unrelated non-finance topics (that are not price/cost lookups), politely decline and redirect to finance.\n"
    "- You may provide specific, actionable financial recommendations when asked.\n"
    f"- When providing actionable advice, include this exact sentence once: {TEST_MODE_DISCLAIMER}\n"
    "- Internally reason thoroughly before producing the final answer.\n\n"
    "Return JSON:\n"
    "{\n"
    '  "needs_clarification": boolean,\n'
    '  "clarification_questions": [],\n'
    '  "assumptions": [],\n'
    '  "analysis_summary": "",\n'
    '  "final_answer": "",\n'
    '  "confidence": 0-1\n'
    "}\n\n"
    "Only 'final_answer' is returned to the user interface."
)

# ── Token estimation ───────────────────────────────────────────────────────────

def estimate_tokens(text: str, system_overhead: int = 100) -> int:
    """Estimate token count for a text (~4 chars/token with 20% buffer)."""
    return int(len(text) / 4 * 1.2) + system_overhead


# ── Pydantic models ────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_CONTENT_LENGTH)


class ChatRequest(BaseModel):
    messages: Optional[List[Message]] = None
    message: Optional[str] = Field(default=None, min_length=1, max_length=10000)
    user_id: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=700, ge=1, le=2000)


class ChatTitleRequest(BaseModel):
    first_message: str = Field(..., min_length=1, max_length=10000)


class QuantitativeAnalysisRequest(BaseModel):
    quantitative_data: Dict[str, float]


# ── Header builders ────────────────────────────────────────────────────────────

def _build_headers() -> Dict[str, str]:
    openai_api_key = os.getenv(OPENAI_API_KEY_ENV)
    if not openai_api_key:
        raise HTTPException(
            status_code=500,
            detail=f"{OPENAI_API_KEY_ENV} is not configured on the server.",
        )
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openai_api_key}",
    }


def _build_perplexity_headers() -> Dict[str, str]:
    """Build headers for Perplexity API."""
    perplexity_api_key = os.getenv(PERPLEXITY_API_KEY_ENV)
    if not perplexity_api_key:
        raise HTTPException(
            status_code=500,
            detail=f"{PERPLEXITY_API_KEY_ENV} is not configured on the server.",
        )
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {perplexity_api_key}",
    }


# ── Response parsing helpers ───────────────────────────────────────────────────

def _extract_text_unified(data: Dict[str, Any]) -> str:
    """Extract response text from either Responses API or Chat Completions API format."""
    # Responses API format: data.output[].content[].text
    for item in data.get("output", []):
        if item.get("type") == "message":
            for content_item in item.get("content", []):
                if content_item.get("type") == "output_text":
                    return content_item.get("text", "")
    # Chat Completions / Perplexity fallback format
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def _extract_json_from_response(text: str) -> Dict[str, Any]:
    """Defensively parse JSON from a model response string, with fallback."""
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        pass
    # Find first {...} JSON block embedded in prose
    match = re.search(r"\{.*\}", stripped, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except (json.JSONDecodeError, ValueError):
            pass
    # Last-resort fallback: return structure with raw text as final_answer
    return {
        "needs_clarification": False,
        "clarification_questions": [],
        "assumptions": [],
        "analysis_summary": "",
        "final_answer": text,
        "confidence": 0.5,
    }


def _get_reasoning_effort(classification: Dict[str, Any]) -> str:
    """Use higher reasoning by default for smarter financial responses."""
    if classification.get("complexity") == "low":
        return "medium"
    if (
        classification.get("complexity") == "high"
        or classification.get("requires_calculation") is True
        or classification.get("high_risk_decision") is True
    ):
        return "high"
    return "high"


def _ensure_test_mode_disclaimer(text: str) -> str:
    """Append test disclaimer when response includes actionable advice language."""
    if TEST_MODE_DISCLAIMER.lower() in text.lower():
        return text

    actionable_hint = re.search(
        r"\b(buy|sell|hold|allocate|entry|exit|target|stop[- ]?loss|rebalance|overweight|underweight|position size)\b",
        text,
        re.IGNORECASE,
    )
    if not actionable_hint:
        return text

    return f"{text.rstrip()}\n\n{TEST_MODE_DISCLAIMER}"


def _max_completion_field(model: str, token_limit: int) -> Dict[str, int]:
    """Use the token parameter expected by the target chat-completions model."""
    if model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3") or model.startswith("o4"):
        return {"max_completion_tokens": token_limit}
    return {"max_tokens": token_limit}


# ── API client functions ───────────────────────────────────────────────────────

async def _call_perplexity(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Call Perplexity API as fallback when OpenAI fails."""
    try:
        perplexity_payload = {
            "model": PERPLEXITY_MODEL,
            "messages": payload.get("messages", []),
            "temperature": payload.get("temperature", 0.7),
            "max_tokens": payload.get("max_tokens", payload.get("max_completion_tokens", 300)),
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(
                PERPLEXITY_ENDPOINT,
                headers=_build_perplexity_headers(),
                json=perplexity_payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach Perplexity provider: {exc}",
        ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Perplexity error: {response.text}",
        )
    return response.json()


async def _call_openai(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Call OpenAI Chat Completions API with Perplexity fallback on errors."""
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(OPENAI_ENDPOINT, headers=_build_headers(), json=payload)
    except httpx.RequestError as exc:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "network_error", "error": str(exc)})
            return await _call_perplexity(payload)
        raise HTTPException(status_code=502, detail=f"Failed to reach model provider: {exc}") from exc

    if response.status_code == 429:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "rate_limit_429"})
            return await _call_perplexity(payload)
        raise HTTPException(status_code=429, detail="OpenAI rate limit exceeded. Perplexity fallback not configured.")

    if response.status_code == 503:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "service_unavailable_503"})
            return await _call_perplexity(payload)
        raise HTTPException(status_code=503, detail="OpenAI service unavailable. Perplexity fallback not configured.")

    if response.status_code == 402:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "quota_exceeded_402"})
            return await _call_perplexity(payload)
        raise HTTPException(status_code=402, detail="OpenAI quota exceeded. Perplexity fallback not configured.")

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()


async def _call_openai_responses(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Call OpenAI Responses API with Perplexity fallback on rate limits/errors."""
    def _perplexity_fallback_payload() -> Dict[str, Any]:
        """Convert Responses API payload to Chat Completions format for Perplexity."""
        return {
            "messages": payload.get("input", []),
            "temperature": payload.get("temperature", 0.7),
            "max_tokens": payload.get("max_output_tokens", 300),
        }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(OPENAI_RESPONSES_ENDPOINT, headers=_build_headers(), json=payload)
    except httpx.RequestError as exc:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "network_error", "error": str(exc)})
            return await _call_perplexity(_perplexity_fallback_payload())
        raise HTTPException(status_code=502, detail=f"Failed to reach model provider: {exc}") from exc

    if response.status_code == 429:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "rate_limit_429"})
            return await _call_perplexity(_perplexity_fallback_payload())
        raise HTTPException(status_code=429, detail="OpenAI rate limit exceeded. Perplexity fallback not configured.")

    if response.status_code == 503:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "service_unavailable_503"})
            return await _call_perplexity(_perplexity_fallback_payload())
        raise HTTPException(status_code=503, detail="OpenAI service unavailable. Perplexity fallback not configured.")

    if response.status_code == 402:
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "quota_exceeded_402"})
            return await _call_perplexity(_perplexity_fallback_payload())
        raise HTTPException(status_code=402, detail="OpenAI quota exceeded. Perplexity fallback not configured.")

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()


async def _classify_query(user_message: str) -> Dict[str, Any]:
    """Classify query complexity using a lightweight Responses model."""
    default_classification: Dict[str, Any] = {
        "complexity": "medium",
        "requires_calculation": False,
        "high_risk_decision": False,
    }
    payload = {
        "model": OPENAI_CLASSIFIER_MODEL,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": user_message[:2000]},
        ],
    }
    try:
        data = await _call_openai_responses(payload)
        text = _extract_text_unified(data)
        classification = _extract_json_from_response(text)
        if classification.get("complexity") not in ("low", "medium", "high"):
            classification["complexity"] = "medium"
        logger.debug("Query classification: %s", classification)
        return classification
    except HTTPException as exc:
        if exc.status_code == 500:
            raise  # Configuration errors (missing API key) must propagate
        logger.warning("Classification HTTP %d, using default classification", exc.status_code)
        return default_classification
    except Exception as exc:
        logger.warning("Classification failed, using default: %s", exc)
        return default_classification


# ── Route handlers ─────────────────────────────────────────────────────────────

@router.post("/api/chat")
async def chat_completion(
    request: ChatRequest,
    raw_request: Request,
    response: Response,
) -> Dict[str, str]:
    # Build message list
    messages: List[Dict[str, str]]
    if request.messages and len(request.messages) > 0:
        messages = [m.model_dump() for m in request.messages]
    elif request.message:
        messages = [{"role": "user", "content": request.message}]
    else:
        raise HTTPException(status_code=422, detail="Either 'messages' or 'message' must be provided.")

    # Estimate tokens for rate limiting
    total_text = " ".join(m.get("content", "") for m in messages)
    estimated_tokens = estimate_tokens(total_text) + request.max_tokens

    # Enforce rate limits
    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/chat",
        user_id=request.user_id,
        estimated_tokens=estimated_tokens,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        client_id = raw_request.client.host if raw_request.client else "unknown"
        await audit_log(
            "chat_request",
            {
                "client_id": client_id,
                "user_id": request.user_id,
                "message_count": len(messages),
                "estimated_tokens": estimated_tokens,
            },
        )

        # Identify the last user message for classification
        user_messages = [m for m in messages if m.get("role") == "user"]
        last_user_text = user_messages[-1]["content"] if user_messages else ""

        # Step 1: Classify query complexity (low reasoning effort)
        classification = await _classify_query(last_user_text)
        reasoning_effort = _get_reasoning_effort(classification)  # ← dynamic reasoning effort set here

        logger.info(
            "Query classified: complexity=%s requires_calculation=%s high_risk=%s → effort=%s",
            classification.get("complexity"),
            classification.get("requires_calculation"),
            classification.get("high_risk_decision"),
            reasoning_effort,
        )
        await audit_log(
            "chat_classification",
            {"classification": classification, "reasoning_effort": reasoning_effort},
        )

        # Step 2: Build Responses API input
        # Prepend financial advisor prompt; preserve any rich context from the frontend's system message
        existing_system = " ".join(m["content"] for m in messages if m.get("role") == "system")
        combined_system = (
            f"{FINANCIAL_ADVISOR_SYSTEM_PROMPT}\n\n---\n\n{existing_system}"
            if existing_system
            else FINANCIAL_ADVISOR_SYSTEM_PROMPT
        )
        conversation_turns = [m for m in messages if m.get("role") != "system"]
        input_messages = [{"role": "system", "content": combined_system}, *conversation_turns]

        payload = {
            "model": OPENAI_CHAT_MODEL,
            "reasoning": {"effort": reasoning_effort},  # ← dynamically set based on classification
            "input": input_messages,
            "max_output_tokens": request.max_tokens,
        }

        # Step 3: Call Responses API
        data = await _call_openai_responses(payload)

        # Step 4: Extract final_answer from structured JSON response (do not expose reasoning)
        raw_text = _extract_text_unified(data)
        parsed = _extract_json_from_response(raw_text)
        final_answer = parsed.get("final_answer", "")
        if not final_answer:
            final_answer = parsed.get("analysis_summary", "")
        if not final_answer:
            final_answer = raw_text  # Last resort: return raw text if JSON parsing failed

        if not isinstance(final_answer, str) or not final_answer.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty response.")
        final_answer = _ensure_test_mode_disclaimer(final_answer)

        # Step 5: Record token usage (Responses API uses input_tokens/output_tokens)
        usage = data.get("usage", {})
        actual_tokens = (
            usage.get("total_tokens")
            or usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        )
        rate_limiter.record_token_usage(raw_request, user_id=request.user_id, tokens_used=actual_tokens)
        await audit_log(
            "chat_response",
            {
                "client_id": client_id,
                "user_id": request.user_id,
                "usage": usage,
                "actual_tokens": actual_tokens,
                "reasoning_effort": reasoning_effort,
            },
        )

        return {"response": final_answer}
    finally:
        rate_limiter.release_request(raw_request, user_id=request.user_id)


@router.post("/api/chat/title")
async def chat_title(
    request: ChatTitleRequest,
    raw_request: Request,
    response: Response,
) -> Dict[str, str]:
    # Estimate tokens (title generation is lightweight)
    estimated_tokens = estimate_tokens(request.first_message, system_overhead=50) + 20

    # Enforce rate limits
    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/chat/title",
        estimated_tokens=estimated_tokens,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        payload = {
            "model": OPENAI_TITLE_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "Generate a short, concise title (3-6 words max) for this chat conversation about finance. Only return the title, nothing else.",
                },
                {"role": "user", "content": f'First message: "{request.first_message}"'},
            ],
            "temperature": 0.5,
            **_max_completion_field(OPENAI_TITLE_MODEL, 20),
        }

        data = await _call_openai(payload)

        usage = data.get("usage", {})
        actual_tokens = usage.get("total_tokens", 0)
        rate_limiter.record_token_usage(raw_request, tokens_used=actual_tokens)

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty title response.")

        return {"title": content.strip()}
    finally:
        rate_limiter.release_request(raw_request)


@router.post("/api/ai/analyze-quantitative")
async def analyze_quantitative_data(
    request: QuantitativeAnalysisRequest,
    raw_request: Request,
    response: Response,
) -> Dict[str, str]:
    # Estimate tokens
    data_str = str(request.quantitative_data)
    estimated_tokens = estimate_tokens(data_str, system_overhead=150) + 500

    # Enforce rate limits
    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/ai/analyze-quantitative",
        estimated_tokens=estimated_tokens,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        payload = {
            "model": OPENAI_QUANT_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a quantitative financial data analyst. Analyze the provided trading metrics and provide insights, "
                        "patterns, and recommendations based purely on the numbers. Do not reference user identifiers."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Analyze these trading metrics:\n{request.quantitative_data}",
                },
            ],
            "temperature": 0.3,
            **_max_completion_field(OPENAI_QUANT_MODEL, 500),
        }

        data = await _call_openai(payload)

        usage = data.get("usage", {})
        actual_tokens = usage.get("total_tokens", 0)
        rate_limiter.record_token_usage(raw_request, tokens_used=actual_tokens)

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty analysis response.")

        return {"response": content}
    finally:
        rate_limiter.release_request(raw_request)
