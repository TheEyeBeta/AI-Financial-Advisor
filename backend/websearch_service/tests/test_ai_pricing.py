"""Tests for app.services.ai_pricing — versioned internal cost model."""
from __future__ import annotations

import json

from app.services import ai_pricing


def test_known_model_uses_configured_price():
    price = ai_pricing.get_model_price("gpt-4o-mini")
    assert price.input_per_million == 0.15
    assert price.output_per_million == 0.60


def test_unknown_model_uses_conservative_fallback_not_free():
    price = ai_pricing.get_model_price("some-future-model-not-yet-priced")
    assert price.input_per_million > 0
    assert price.output_per_million > 0


def test_estimate_cost_usd_matches_hand_calculation():
    cost = ai_pricing.estimate_cost_usd("gpt-4o-mini", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == 0.15 + 0.60


def test_estimate_cost_usd_negative_tokens_clamped_to_zero():
    cost = ai_pricing.estimate_cost_usd("gpt-4o-mini", input_tokens=-100, output_tokens=-100)
    assert cost == 0.0


def test_env_override_replaces_pricing_for_a_model(monkeypatch):
    monkeypatch.setenv(
        "AI_MODEL_PRICING_JSON",
        json.dumps({"gpt-4o-mini": {"input_per_million": 999.0, "output_per_million": 999.0}}),
    )
    price = ai_pricing.get_model_price("gpt-4o-mini")
    assert price.input_per_million == 999.0


def test_invalid_env_override_is_ignored(monkeypatch):
    monkeypatch.setenv("AI_MODEL_PRICING_JSON", "not valid json")
    price = ai_pricing.get_model_price("gpt-4o-mini")
    assert price.input_per_million == 0.15


def test_negative_price_override_is_rejected(monkeypatch):
    monkeypatch.setenv(
        "AI_MODEL_PRICING_JSON",
        json.dumps({"gpt-4o-mini": {"input_per_million": -1.0, "output_per_million": 0.6}}),
    )
    price = ai_pricing.get_model_price("gpt-4o-mini")
    # Invalid override rejected wholesale — falls back to the real base price.
    assert price.input_per_million == 0.15


def test_non_finite_price_override_is_rejected(monkeypatch):
    monkeypatch.setenv(
        "AI_MODEL_PRICING_JSON",
        json.dumps({"gpt-4o-mini": {"input_per_million": float("inf"), "output_per_million": 0.6}}),
    )
    price = ai_pricing.get_model_price("gpt-4o-mini")
    assert price.input_per_million == 0.15
