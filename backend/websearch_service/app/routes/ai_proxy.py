from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..services.audit import audit_log
from ..services.rate_limit import rate_limiter


router = APIRouter(tags=["ai-proxy"])

OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"
PERPLEXITY_API_KEY_ENV = "PERPLEXITY_API_KEY"
PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions"
PERPLEXITY_MODEL = "llama-3.1-sonar-small-128k-online"  # Cost-effective fallback model
MAX_CHAT_MESSAGE_CONTENT_LENGTH = 50000

# Estimate tokens: ~4 chars per token, add 20% buffer for system messages
def estimate_tokens(text: str, system_overhead: int = 100) -> int:
    """Estimate token count for a text."""
    return int(len(text) / 4 * 1.2) + system_overhead


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_CONTENT_LENGTH)


class ChatRequest(BaseModel):
    messages: Optional[List[Message]] = None
    message: Optional[str] = Field(default=None, min_length=1, max_length=10000)
    user_id: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=300, ge=1, le=2000)


class ChatTitleRequest(BaseModel):
    first_message: str = Field(..., min_length=1, max_length=10000)


class QuantitativeAnalysisRequest(BaseModel):
    quantitative_data: Dict[str, float]


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


async def _call_perplexity(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Call Perplexity API as fallback when OpenAI fails."""
    try:
        # Convert OpenAI format to Perplexity format (they're compatible)
        perplexity_payload = {
            "model": PERPLEXITY_MODEL,
            "messages": payload.get("messages", []),
            "temperature": payload.get("temperature", 0.7),
            "max_tokens": payload.get("max_tokens", 300),
        }
        
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(
                PERPLEXITY_ENDPOINT,
                headers=_build_perplexity_headers(),
                json=perplexity_payload
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach Perplexity provider: {exc}"
        ) from exc
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Perplexity error: {response.text}"
        )
    
    return response.json()


async def _call_openai(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Call OpenAI API with Perplexity fallback on rate limits/errors."""
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(OPENAI_ENDPOINT, headers=_build_headers(), json=payload)
    except httpx.RequestError as exc:
        # Network error - try Perplexity fallback if configured
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {
                "reason": "network_error",
                "error": str(exc)
            })
            return await _call_perplexity(payload)
        raise HTTPException(status_code=502, detail=f"Failed to reach model provider: {exc}") from exc

    # Check for rate limits or errors that should trigger fallback
    if response.status_code == 429:  # Rate limit
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "rate_limit_429"})
            return await _call_perplexity(payload)
        raise HTTPException(
            status_code=429,
            detail="OpenAI rate limit exceeded. Perplexity fallback not configured."
        )
    
    if response.status_code == 503:  # Service unavailable
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "service_unavailable_503"})
            return await _call_perplexity(payload)
        raise HTTPException(
            status_code=503,
            detail="OpenAI service unavailable. Perplexity fallback not configured."
        )
    
    if response.status_code == 402:  # Quota exceeded
        perplexity_key = os.getenv(PERPLEXITY_API_KEY_ENV)
        if perplexity_key:
            await audit_log("openai_fallback_perplexity", {"reason": "quota_exceeded_402"})
            return await _call_perplexity(payload)
        raise HTTPException(
            status_code=402,
            detail="OpenAI quota exceeded. Perplexity fallback not configured."
        )

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()


@router.post("/api/chat")
async def chat_completion(
    request: ChatRequest,
    raw_request: Request,
    response: Response,
) -> Dict[str, str]:
    # Estimate tokens for rate limiting
    messages: List[Dict[str, str]]
    if request.messages and len(request.messages) > 0:
        messages = [m.model_dump() for m in request.messages]
    elif request.message:
        messages = [{"role": "user", "content": request.message}]
    else:
        raise HTTPException(status_code=422, detail="Either 'messages' or 'message' must be provided.")
    
    # Calculate estimated tokens
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
    
    # Add rate limit headers
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

        data = await _call_openai(
            {
                "model": OPENAI_MODEL,
                "messages": messages,
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
            }
        )

        usage = data.get("usage", {})
        actual_tokens = usage.get("total_tokens", 0)
        
        # Record actual token usage
        rate_limiter.record_token_usage(
            raw_request,
            user_id=request.user_id,
            tokens_used=actual_tokens,
        )
        
        await audit_log(
            "chat_response",
            {
                "client_id": client_id,
                "user_id": request.user_id,
                "usage": usage,
                "actual_tokens": actual_tokens,
            },
        )

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty response.")

        return {"response": content}
    finally:
        # Release concurrent request slot
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
    
    # Add rate limit headers
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)
    
    try:
        payload = {
            "model": OPENAI_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "Generate a short, concise title (3-6 words max) for this chat conversation about finance. Only return the title, nothing else.",
                },
                {"role": "user", "content": f'First message: "{request.first_message}"'},
            ],
            "temperature": 0.5,
            "max_tokens": 20,
        }

        data = await _call_openai(payload)
        
        usage = data.get("usage", {})
        actual_tokens = usage.get("total_tokens", 0)
        
        # Record actual token usage
        rate_limiter.record_token_usage(
            raw_request,
            tokens_used=actual_tokens,
        )
        
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty title response.")

        return {"title": content.strip()}
    finally:
        # Release concurrent request slot
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
    
    # Add rate limit headers
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)
    
    try:
        payload = {
            "model": OPENAI_MODEL,
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
            "max_tokens": 500,
        }

        data = await _call_openai(payload)
        
        usage = data.get("usage", {})
        actual_tokens = usage.get("total_tokens", 0)
        
        # Record actual token usage
        rate_limiter.record_token_usage(
            raw_request,
            tokens_used=actual_tokens,
        )
        
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="Model provider returned an empty analysis response.")

        return {"response": content}
    finally:
        # Release concurrent request slot
        rate_limiter.release_request(raw_request)
