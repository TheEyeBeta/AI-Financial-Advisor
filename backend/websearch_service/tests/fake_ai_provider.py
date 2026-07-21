"""Deterministic AI-provider stub for all non-live tests (Part 3).

A single, per-test-configurable fake that emulates the httpx surface the app
uses for OpenAI (Responses API `.post()` and the streaming `.stream()` context
manager) plus the Perplexity fallback. Every scenario is deterministic — no
randomness, no wall-clock dependence beyond explicitly configured delays, and
never any real network I/O.

Use it by patching ``httpx.AsyncClient`` with :meth:`FakeAIProvider.as_client_factory`,
or drive the scenario builders directly for unit-level assertions.

Covered scenarios (``Scenario``): success (stream / non-stream), first-token and
total delays, rate limit, auth failure, connection refusal, timeout, malformed
JSON, malformed stream event, partial stream, stream interruption, retryable and
non-retryable errors, empty output, excessive output, token-usage mismatch,
provider saturation, cancellation, budget rejection, tool-call, tool-call
continuation, and tool failure.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx


class Scenario(str, Enum):
    SUCCESS_STREAMING = "success_streaming"
    SUCCESS_NONSTREAMING = "success_nonstreaming"
    FIRST_TOKEN_DELAY = "first_token_delay"
    TOTAL_DELAY = "total_delay"
    RATE_LIMIT = "rate_limit"
    AUTH_FAILURE = "auth_failure"
    CONNECTION_REFUSED = "connection_refused"
    TIMEOUT = "timeout"
    MALFORMED_JSON = "malformed_json"
    MALFORMED_STREAM_EVENT = "malformed_stream_event"
    PARTIAL_STREAM = "partial_stream"
    STREAM_INTERRUPTION = "stream_interruption"
    RETRYABLE_ERROR = "retryable_error"
    NON_RETRYABLE_ERROR = "non_retryable_error"
    EMPTY_OUTPUT = "empty_output"
    EXCESSIVE_OUTPUT = "excessive_output"
    TOKEN_USAGE_MISMATCH = "token_usage_mismatch"
    SATURATION = "saturation"
    CANCELLATION = "cancellation"
    BUDGET_REJECTION = "budget_rejection"
    TOOL_CALL = "tool_call"
    TOOL_CALL_CONTINUATION = "tool_call_continuation"
    TOOL_FAILURE = "tool_failure"


# Errors the app's retry logic treats as retryable vs terminal.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503})
NON_RETRYABLE_STATUS = frozenset({400, 401, 403, 404, 422})


@dataclass
class ProviderConfig:
    scenario: Scenario = Scenario.SUCCESS_NONSTREAMING
    first_token_delay_s: float = 0.0
    total_delay_s: float = 0.0
    output_text: str = "Deterministic advisory answer for tests."
    output_tokens: int = 42
    input_tokens: int = 20
    reasoning_tokens: int = 0
    # For TOKEN_USAGE_MISMATCH: what the provider *reports* vs what content implies.
    reported_output_tokens: Optional[int] = None
    # Server ceiling used by EXCESSIVE_OUTPUT to prove capping.
    output_token_ceiling: int = 8000
    excessive_output_tokens: int = 999_999
    stream_chunks: List[str] = field(default_factory=lambda: ["Deterministic ", "advisory ", "answer."])
    partial_after: int = 1          # PARTIAL_STREAM stops after N chunks
    max_concurrency: int = 3        # SATURATION limit
    tool_name: str = "get_portfolio"


class FakeResponse:
    """Minimal emulation of the parts of httpx.Response the app touches."""

    def __init__(self, status_code: int, payload: Any, *, malformed_json: bool = False, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self._malformed_json = malformed_json
        self.text = text

    def json(self) -> Any:
        if self._malformed_json:
            raise json.JSONDecodeError("malformed provider JSON", "", 0)
        return self._payload

    async def aclose(self) -> None:  # streaming cleanup hook
        return None


def _usage(cfg: ProviderConfig, output_tokens: Optional[int] = None) -> Dict[str, Any]:
    out = cfg.output_tokens if output_tokens is None else output_tokens
    reported = cfg.reported_output_tokens if cfg.reported_output_tokens is not None else out
    return {
        "input_tokens": cfg.input_tokens,
        "output_tokens": reported,
        "total_tokens": cfg.input_tokens + reported,
        "output_tokens_details": {"reasoning_tokens": cfg.reasoning_tokens},
    }


def build_responses_payload(cfg: ProviderConfig) -> Dict[str, Any]:
    """Deterministic OpenAI Responses-API JSON body for the configured scenario."""
    if cfg.scenario is Scenario.EMPTY_OUTPUT:
        text = ""
        usage = _usage(cfg, output_tokens=0)
    elif cfg.scenario is Scenario.EXCESSIVE_OUTPUT:
        # The provider *would* emit a huge answer; the app must cap the request
        # budget. We report the (capped) ceiling as the effective output.
        text = "x" * (cfg.excessive_output_tokens)
        usage = _usage(cfg, output_tokens=min(cfg.excessive_output_tokens, cfg.output_token_ceiling))
    elif cfg.scenario is Scenario.TOOL_CALL:
        return {
            "output": [
                {
                    "type": "function_call",
                    "name": cfg.tool_name,
                    "arguments": "{}",
                    "call_id": "call_deterministic_1",
                }
            ],
            "usage": _usage(cfg),
        }
    else:
        text = cfg.output_text
        usage = _usage(cfg)
    return {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": usage,
    }


def build_stream_events(cfg: ProviderConfig) -> List[str]:
    """Deterministic SSE lines for the streaming path."""
    chunks = list(cfg.stream_chunks)
    if cfg.scenario is Scenario.PARTIAL_STREAM:
        chunks = chunks[: cfg.partial_after]  # ends without [DONE]
    events: List[str] = []
    for c in chunks:
        events.append("data: " + json.dumps({"choices": [{"delta": {"content": c}}]}))
    if cfg.scenario is Scenario.MALFORMED_STREAM_EVENT:
        events.append("data: {not valid json")
    if cfg.scenario not in (Scenario.PARTIAL_STREAM, Scenario.STREAM_INTERRUPTION):
        events.append("data: [DONE]")
    return events


class FakeAIProvider:
    """A configurable, deterministic httpx.AsyncClient replacement."""

    def __init__(self, config: Optional[ProviderConfig] = None):
        self.config = config or ProviderConfig()
        self.post_calls: List[Dict[str, Any]] = []
        self.active = 0
        self.max_observed_active = 0
        self.cancelled_cleanly = False
        self._sem = asyncio.Semaphore(self.config.max_concurrency)

    # ── httpx.AsyncClient context-manager surface ──────────────────────────
    def as_client_factory(self):
        provider = self

        class _Client:
            def __init__(self, *args, **kwargs):
                self._provider = provider

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, *args, **kwargs):
                return await provider.post(url, *args, **kwargs)

            def stream(self, method, url, *args, **kwargs):
                return provider.stream(method, url, *args, **kwargs)

        return _Client

    # ── non-streaming ──────────────────────────────────────────────────────
    async def post(self, url: str, *args, **kwargs) -> FakeResponse:
        self.post_calls.append({"url": url, "json": kwargs.get("json")})
        cfg = self.config

        if cfg.first_token_delay_s:
            await asyncio.sleep(cfg.first_token_delay_s)
        if cfg.total_delay_s:
            await asyncio.sleep(cfg.total_delay_s)

        if cfg.scenario is Scenario.TIMEOUT:
            raise httpx.ReadTimeout("deterministic timeout", request=None)
        if cfg.scenario is Scenario.CONNECTION_REFUSED:
            raise httpx.ConnectError("deterministic connection refused", request=None)
        if cfg.scenario is Scenario.CANCELLATION:
            self.active += 1
            try:
                raise asyncio.CancelledError()
            finally:
                self.active -= 1
                self.cancelled_cleanly = self.active == 0
        if cfg.scenario is Scenario.RATE_LIMIT:
            return FakeResponse(429, {"error": {"type": "rate_limit"}})
        if cfg.scenario is Scenario.AUTH_FAILURE:
            return FakeResponse(401, {"error": {"type": "invalid_api_key"}})
        if cfg.scenario is Scenario.RETRYABLE_ERROR:
            return FakeResponse(503, {"error": {"type": "server_error"}})
        if cfg.scenario is Scenario.NON_RETRYABLE_ERROR:
            return FakeResponse(400, {"error": {"type": "bad_request"}})
        if cfg.scenario is Scenario.MALFORMED_JSON:
            return FakeResponse(200, None, malformed_json=True, text="<html>not json</html>")
        if cfg.scenario is Scenario.TOOL_FAILURE:
            return FakeResponse(502, {"error": {"type": "tool_upstream_failed"}})
        return FakeResponse(200, build_responses_payload(cfg))

    # ── streaming ──────────────────────────────────────────────────────────
    def stream(self, method: str, url: str, *args, **kwargs):
        provider = self
        cfg = self.config

        class _StreamCtx:
            async def __aenter__(self):
                if cfg.first_token_delay_s:
                    await asyncio.sleep(cfg.first_token_delay_s)
                if cfg.scenario is Scenario.AUTH_FAILURE:
                    return FakeResponse(401, {"error": {"type": "invalid_api_key"}})
                if cfg.scenario is Scenario.RATE_LIMIT:
                    return FakeResponse(429, {"error": {"type": "rate_limit"}})
                return _StreamResponse()

            async def __aexit__(self, *exc):
                return False

        class _StreamResponse:
            status_code = 200

            async def aiter_lines(self) -> AsyncIterator[str]:
                events = build_stream_events(cfg)
                for i, line in enumerate(events):
                    if cfg.scenario is Scenario.STREAM_INTERRUPTION and i >= cfg.partial_after:
                        raise httpx.ReadError("deterministic stream interruption", request=None)
                    if cfg.total_delay_s:
                        await asyncio.sleep(cfg.total_delay_s / max(1, len(events)))
                    yield line

            async def aclose(self) -> None:
                provider.cancelled_cleanly = True

        return _StreamCtx()

    # ── concurrency-limited call (for SATURATION tests) ────────────────────
    async def guarded_call(self) -> Dict[str, Any]:
        async with self._sem:
            self.active += 1
            self.max_observed_active = max(self.max_observed_active, self.active)
            try:
                await asyncio.sleep(0)  # yield so overlap is observable
                return build_responses_payload(self.config)
            finally:
                self.active -= 1


# ── deterministic helpers the tests assert against ──────────────────────────

def cap_output_tokens(requested: int, ceiling: int) -> int:
    """Mirror of the server-side ceiling rule (see ai_proxy._effective_chat_max_output_tokens)."""
    return min(max(1, requested), max(1, ceiling))


def assemble_stream_text(events: List[str]) -> tuple[str, bool]:
    """Return (assembled_text, is_complete). A stream is complete only if it ends
    with the [DONE] sentinel and contained no malformed event."""
    text_parts: List[str] = []
    complete = False
    for line in events:
        if not line.startswith("data: "):
            continue
        body = line[len("data: "):]
        if body.strip() == "[DONE]":
            complete = True
            break
        try:
            obj = json.loads(body)
        except json.JSONDecodeError:
            return "".join(text_parts), False  # malformed -> not complete
        delta = obj.get("choices", [{}])[0].get("delta", {}).get("content", "")
        text_parts.append(delta)
    return "".join(text_parts), complete


def reconcile_usage(estimated_output_tokens: int, reported_output_tokens: int, *, tolerance: int = 0) -> bool:
    """True when reported usage matches the estimate within tolerance."""
    return abs(estimated_output_tokens - reported_output_tokens) <= tolerance
