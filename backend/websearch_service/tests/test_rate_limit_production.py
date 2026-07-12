"""Tests for production rate-limit configuration guards."""

from __future__ import annotations

import pytest

from app.services.rate_limit import validate_rate_limit_configuration


def test_production_multi_worker_requires_redis(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("ALLOW_IN_MEMORY_RATE_LIMIT", raising=False)
    with pytest.raises(RuntimeError, match="multiple workers"):
        validate_rate_limit_configuration()


def test_production_single_worker_requires_explicit_memory_opt_in(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("WORKERS", "1")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("ALLOW_IN_MEMORY_RATE_LIMIT", raising=False)
    with pytest.raises(RuntimeError, match="ALLOW_IN_MEMORY_RATE_LIMIT"):
        validate_rate_limit_configuration()


def test_production_single_worker_memory_allowed_with_flag(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("WORKERS", "1")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("ALLOW_IN_MEMORY_RATE_LIMIT", "true")
    validate_rate_limit_configuration()
