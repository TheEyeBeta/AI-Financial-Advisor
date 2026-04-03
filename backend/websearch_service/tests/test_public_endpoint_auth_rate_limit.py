import time

import pytest
from fastapi.testclient import TestClient

import app.routes.news as news_route
import app.routes.stock_ranking as stock_ranking_route
from app.main import create_app
from app.services.auth import validate_auth_configuration
from app.services.rate_limit import RateLimitConfig, rate_limiter
from .conftest import TEST_JWT_SECRET, _make_jwt


@pytest.fixture(autouse=True)
def reset_rate_limiter_state():
    rate_limiter.clear_state()
    yield
    rate_limiter.clear_state()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    return TestClient(create_app())


def _auth_headers() -> dict[str, str]:
    token = _make_jwt(
        role="authenticated",
        sub="test-user-123",
        exp=int(time.time()) + 3600,
        email="test@example.com",
    )
    return {"Authorization": f"Bearer {token}"}


def test_validate_auth_configuration_blocks_production_auth_bypass(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_REQUIRED", "false")

    with pytest.raises(RuntimeError, match="AUTH_REQUIRED=false"):
        validate_auth_configuration()


def test_news_endpoint_allows_anonymous_requests_with_optional_auth(monkeypatch):
    client = _client(monkeypatch)

    response = client.get("/api/news")

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.headers["x-ratelimit-limit-minute"] == "10"


def test_news_endpoint_uses_authenticated_rate_limit(monkeypatch):
    client = _client(monkeypatch)

    response = client.get("/api/news", headers=_auth_headers())

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.headers["x-ratelimit-limit-minute"] == "60"


def test_news_endpoint_accepts_es256_authenticated_jwt(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr("app.services.auth._jwt_algorithm", lambda token: "ES256")

    def _fake_verify(token: str, algorithm: str, *, required_claims):
        assert token == "not-a-real-jwt"
        assert algorithm == "ES256"
        assert tuple(required_claims) == ("sub", "exp", "iat", "role")
        return {
            "sub": "test-user-123",
            "email": "test@example.com",
            "role": "authenticated",
        }

    monkeypatch.setattr("app.services.auth._verify_jwt_with_supabase_jwks", _fake_verify)
    client = TestClient(create_app())

    response = client.get("/api/news", headers={"Authorization": "Bearer not-a-real-jwt"})

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.headers["x-ratelimit-limit-minute"] == "60"


def test_news_endpoint_blocks_after_anonymous_rate_limit(monkeypatch):
    monkeypatch.setattr(
        news_route,
        "ANONYMOUS_RATE_LIMIT",
        RateLimitConfig(requests_per_minute=1, requests_per_hour=60, requests_per_day=1440),
    )
    client = _client(monkeypatch)

    first = client.get("/api/news")
    second = client.get("/api/news")

    assert first.status_code == 200
    assert second.status_code == 429


def test_stock_ranking_endpoint_allows_anonymous_requests_with_optional_auth(monkeypatch):
    class _FakeQuery:
        def select(self, *_args, **_kwargs):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def gte(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def execute(self):
            return type("Result", (), {"data": []})()

    class _FakeSupabase:
        def schema(self, *_args, **_kwargs):
            return self

        def table(self, *_args, **_kwargs):
            return _FakeQuery()

    monkeypatch.setattr(stock_ranking_route, "supabase_client", _FakeSupabase())
    client = _client(monkeypatch)

    response = client.get("/api/stocks/ranking")

    assert response.status_code == 200
    assert response.json()["stocks"] == []
    assert response.headers["x-ratelimit-limit-minute"] == "10"
