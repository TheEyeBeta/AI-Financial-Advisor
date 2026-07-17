"""Tests proving the staging seeder refuses to run against production."""
from __future__ import annotations

import pytest

from staging_seed.config import SeedConfig
from staging_seed.guard import (
    SeedGuardError,
    assert_safe_to_inspect,
    assert_safe_to_mutate,
    hostname_from_url,
    project_ref_from_url,
)


def make_config(**overrides) -> SeedConfig:
    defaults = dict(
        environment="staging",
        allow_synthetic_seed=True,
        supabase_url="https://abcdefghijklmnop.supabase.co",
        supabase_service_role_key="fake-service-role-key",
        database_url="postgresql://user:pass@staging-db.example.com:5432/postgres",
        production_denylist=[],
        random_seed=1,
        user_count=200,
    )
    defaults.update(overrides)
    return SeedConfig(**defaults)


# ─── project_ref_from_url / hostname_from_url ────────────────────────────────

def test_project_ref_from_url_extracts_subdomain():
    assert project_ref_from_url("https://abcxyz.supabase.co") == "abcxyz"


def test_project_ref_from_url_falls_back_to_hostname_for_custom_domain():
    assert project_ref_from_url("https://db.mycompany.example.com") == "db.mycompany.example.com"


def test_project_ref_from_url_empty_for_blank_input():
    assert project_ref_from_url("") is None


def test_hostname_from_url():
    assert hostname_from_url("postgresql://u:p@host.example.com:5432/db") == "host.example.com"


def test_hostname_from_url_none_for_none():
    assert hostname_from_url(None) is None


# ─── assert_safe_to_mutate: refusal gates ────────────────────────────────────

def test_refuses_when_environment_is_production():
    config = make_config(environment="production")
    with pytest.raises(SeedGuardError, match="ENVIRONMENT=production"):
        assert_safe_to_mutate(config)


def test_refuses_when_environment_production_uppercase_normalised_by_loader():
    # config.environment is already lowercased by load_config(); guard trusts that.
    config = make_config(environment="production")
    with pytest.raises(SeedGuardError):
        assert_safe_to_inspect(config)


def test_refuses_when_allow_synthetic_seed_flag_is_absent():
    config = make_config(allow_synthetic_seed=False)
    with pytest.raises(SeedGuardError, match="ALLOW_SYNTHETIC_SEED"):
        assert_safe_to_mutate(config)


def test_refuses_when_project_ref_matches_denylist():
    config = make_config(
        supabase_url="https://realprodref.supabase.co",
        production_denylist=["realprodref"],
    )
    with pytest.raises(SeedGuardError, match="denylist"):
        assert_safe_to_mutate(config)


def test_refuses_when_database_hostname_matches_denylist():
    config = make_config(
        database_url="postgresql://user:pass@prod-db.internal.example.com:5432/postgres",
        production_denylist=["prod-db.internal.example.com"],
    )
    with pytest.raises(SeedGuardError, match="denylist"):
        assert_safe_to_mutate(config)


def test_denylist_match_is_case_insensitive():
    config = make_config(
        supabase_url="https://ProdRef.supabase.co",
        production_denylist=["prodref"],
    )
    with pytest.raises(SeedGuardError, match="denylist"):
        assert_safe_to_mutate(config)


def test_refuses_when_supabase_credentials_missing():
    config = make_config(supabase_url="", supabase_service_role_key="")
    with pytest.raises(SeedGuardError, match="SUPABASE_URL"):
        assert_safe_to_mutate(config)


def test_refuses_when_database_url_missing():
    config = make_config(database_url=None)
    with pytest.raises(SeedGuardError, match="ALEMBIC_DATABASE_URL"):
        assert_safe_to_mutate(config)


# ─── assert_safe_to_mutate: happy path ───────────────────────────────────────

def test_passes_when_every_gate_satisfied():
    config = make_config()
    assert_safe_to_mutate(config)  # must not raise


# ─── assert_safe_to_inspect: read-only path is looser ────────────────────────

def test_inspect_does_not_require_allow_synthetic_seed_flag():
    config = make_config(allow_synthetic_seed=False)
    assert_safe_to_inspect(config)  # must not raise — preflight is read-only


def test_inspect_still_refuses_production_environment():
    config = make_config(environment="production", allow_synthetic_seed=False)
    with pytest.raises(SeedGuardError):
        assert_safe_to_inspect(config)


def test_inspect_still_refuses_denylisted_target():
    config = make_config(
        supabase_url="https://banned.supabase.co",
        production_denylist=["banned"],
        allow_synthetic_seed=False,
    )
    with pytest.raises(SeedGuardError):
        assert_safe_to_inspect(config)
