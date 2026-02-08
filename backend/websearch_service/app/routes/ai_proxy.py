from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter(tags=["ai-proxy"])

OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"
MAX_REQUESTS_PER_MINUTE = 30


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1, max_length=10000)


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


_request_windows: Dict[str, Deque[float]] = defaultdict(deque)


def _enforce_rate_limit(client_id: str) -> None:
    now = time.time()
    window = _request_windows[client_id]
    while window and now - window[0] > 60:
        window.popleft()

    if len(window) >= MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please retry shortly.")

    window.append(now)


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


async def _call_openai(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(OPENAI_ENDPOINT, headers=_build_headers(), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to reach model provider: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()


@router.post("/api/chat")
async def chat_completion(request: ChatRequest, raw_request: Request) -> Dict[str, str]:
    client_id = raw_request.client.host if raw_request.client else "unknown"
    _enforce_rate_limit(client_id)

    messages: List[Dict[str, str]]
    if request.messages and len(request.messages) > 0:
        messages = [m.model_dump() for m in request.messages]
    elif request.message:
        messages = [{"role": "user", "content": request.message}]
    else:
        raise HTTPException(status_code=422, detail="Either 'messages' or 'message' must be provided.")

    data = await _call_openai(
        {
            "model": OPENAI_MODEL,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
    )

    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=502, detail="Model provider returned an empty response.")

    return {"response": content}


@router.post("/api/chat/title")
async def chat_title(request: ChatTitleRequest, raw_request: Request) -> Dict[str, str]:
    client_id = raw_request.client.host if raw_request.client else "unknown"
    _enforce_rate_limit(client_id)

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
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=502, detail="Model provider returned an empty title response.")

    return {"title": content.strip()}


@router.post("/api/ai/analyze-quantitative")
async def analyze_quantitative_data(request: QuantitativeAnalysisRequest, raw_request: Request) -> Dict[str, str]:
    client_id = raw_request.client.host if raw_request.client else "unknown"
    _enforce_rate_limit(client_id)

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
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=502, detail="Model provider returned an empty analysis response.")

    return {"response": content}
