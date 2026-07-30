"""Versioned internal pricing table for AI spend accounting.

This is **not** billing-accurate to the cent — it is the internal cost
model used to reserve and reconcile spend against the global budget guard
(see ``ai_budget_guard.py``). Prices are per-1M-tokens in USD and mirror
OpenAI's published list prices at the time ``PRICING_VERSION`` was set.

Operators can override or extend the table via ``AI_MODEL_PRICING_JSON``
(a JSON object of ``{model: {"input_per_million": x, "output_per_million": y}}``)
without a code change — useful when OpenAI reprices a model or a new model
is rolled out ahead of a pricing table update landing in code.
"""
from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Bump whenever the table below changes. Recorded on every cost calculation
# so historical reservations/reconciliations stay attributable to the price
# schedule that produced them.
PRICING_VERSION = "2026-07-beta-1"


@dataclass(frozen=True)
class ModelPrice:
    input_per_million: float
    output_per_million: float


# Internal cost model, USD per 1,000,000 tokens. Update alongside
# PRICING_VERSION when OpenAI's published pricing changes.
_BASE_PRICING: dict[str, ModelPrice] = {
    "gpt-5": ModelPrice(input_per_million=1.25, output_per_million=10.00),
    "gpt-5-mini": ModelPrice(input_per_million=0.25, output_per_million=2.00),
    "gpt-5-nano": ModelPrice(input_per_million=0.05, output_per_million=0.40),
    "gpt-4o": ModelPrice(input_per_million=2.50, output_per_million=10.00),
    "gpt-4o-mini": ModelPrice(input_per_million=0.15, output_per_million=0.60),
}

# A conservative fallback used for unknown/unmapped models so an unrecognized
# model name never bypasses cost accounting (fail toward "count it as
# expensive", not "count it as free").
_FALLBACK_PRICE = ModelPrice(input_per_million=10.00, output_per_million=30.00)


def _load_overrides() -> dict[str, ModelPrice]:
    raw = (os.getenv("AI_MODEL_PRICING_JSON") or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        overrides: dict[str, ModelPrice] = {}
        for model, entry in parsed.items():
            input_rate = float(entry["input_per_million"])
            output_rate = float(entry["output_per_million"])
            if not all(math.isfinite(rate) and rate >= 0 for rate in (input_rate, output_rate)):
                raise ValueError(f"Invalid pricing for model {model!r}: rates must be finite and >= 0")
            overrides[model] = ModelPrice(input_per_million=input_rate, output_per_million=output_rate)
        return overrides
    except Exception as exc:
        logger.error("Invalid AI_MODEL_PRICING_JSON, ignoring overrides: %s", exc)
        return {}


def _pricing_table() -> dict[str, ModelPrice]:
    table = dict(_BASE_PRICING)
    table.update(_load_overrides())
    return table


def get_model_price(model: str) -> ModelPrice:
    return _pricing_table().get((model or "").strip(), _FALLBACK_PRICE)


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Blended cost estimate in USD for a completed or projected call."""
    price = get_model_price(model)
    input_tokens = max(0, int(input_tokens))
    output_tokens = max(0, int(output_tokens))
    return (
        (input_tokens / 1_000_000.0) * price.input_per_million
        + (output_tokens / 1_000_000.0) * price.output_per_million
    )


def estimate_cost_from_total_tokens(model: str, total_tokens: int, *, output_share: float = 0.35) -> float:
    """Blended cost estimate when only a combined token count is known.

    ``output_share`` assumes a typical chat completion output-token ratio;
    used for pre-flight reservations before usage is returned by the
    provider. Reconciliation after completion uses actual input/output
    splits when available and this estimate otherwise.
    """
    total_tokens = max(0, int(total_tokens))
    output_tokens = int(total_tokens * output_share)
    input_tokens = total_tokens - output_tokens
    return estimate_cost_usd(model, input_tokens, output_tokens)
