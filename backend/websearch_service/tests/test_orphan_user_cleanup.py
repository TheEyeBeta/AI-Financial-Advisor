"""Tests for safe orphan auth-user cleanup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services.orphan_user_cleanup import (
    OrphanCleanupError,
    clear_snapshot_store_for_tests,
    create_dry_run_snapshot,
    execute_snapshot,
    paginate_core_auth_ids,
)


def _mock_http_client(*, get_side_effect=None, delete_side_effect=None):
    client = AsyncMock()

    async def _get(url, **kwargs):
        if get_side_effect:
            return await get_side_effect(url, **kwargs)
        return MagicMock(status_code=404, json=lambda: [], headers={})

    async def _delete(url, **kwargs):
        if delete_side_effect:
            return await delete_side_effect(url, **kwargs)
        return MagicMock(status_code=204)

    client.get = AsyncMock(side_effect=_get)
    client.delete = AsyncMock(side_effect=_delete)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


@pytest.fixture(autouse=True)
def _clear_store():
    clear_snapshot_store_for_tests()
    yield
    clear_snapshot_store_for_tests()


class TestPaginateCoreAuthIds:
    @pytest.mark.asyncio
    async def test_aborts_on_incomplete_pagination_count(self):
        calls = {"n": 0}

        async def get_side_effect(url, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                resp = MagicMock()
                resp.status_code = 206
                resp.headers = httpx.Headers({"content-range": "0-0/2"})
                resp.json.return_value = [{"auth_id": "auth-1"}]
                return resp
            resp = MagicMock()
            resp.status_code = 200
            resp.headers = httpx.Headers({"content-range": "1-1/2"})
            resp.json.return_value = []
            return resp

        client = _mock_http_client(get_side_effect=get_side_effect)
        with pytest.raises(OrphanCleanupError, match="count mismatch"):
            await paginate_core_auth_ids(
                client,
                supabase_url="https://example.supabase.co",
                headers={"Authorization": "Bearer x"},
            )

    @pytest.mark.asyncio
    async def test_paginates_multiple_pages(self):
        calls = {"n": 0}

        async def get_side_effect(url, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                resp = MagicMock()
                resp.status_code = 206
                resp.headers = httpx.Headers({"content-range": "0-999/1001"})
                resp.json.return_value = [{"auth_id": f"auth-{i}"} for i in range(1000)]
                return resp
            resp = MagicMock()
            resp.status_code = 200
            resp.headers = httpx.Headers({"content-range": "1000-1000/1001"})
            resp.json.return_value = [{"auth_id": "auth-1000"}]
            return resp

        client = _mock_http_client(get_side_effect=get_side_effect)
        result = await paginate_core_auth_ids(
            client,
            supabase_url="https://example.supabase.co",
            headers={"Authorization": "Bearer x"},
        )
        assert len(result) == 1001


class TestDryRunAndExecute:
    @pytest.mark.asyncio
    async def test_dry_run_never_deletes(self, monkeypatch):
        async def fake_paginate_core(http, **kwargs):
            return {f"live-{i}" for i in range(9)}

        async def fake_paginate_auth(http, **kwargs):
            return (
                [{"id": f"live-{i}", "email": f"live{i}@example.com"} for i in range(9)]
                + [{"id": "orphan-auth", "email": "orphan@example.com"}]
            )

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_core_auth_ids",
            fake_paginate_core,
        )
        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_auth_users",
            fake_paginate_auth,
        )

        snapshot = await create_dry_run_snapshot(
            supabase_url="https://example.supabase.co",
            service_role_key="service-key",
            actor="admin@test",
        )
        assert snapshot.snapshot_id
        assert len(snapshot.candidates) == 1
        assert snapshot.candidates[0].auth_id == "orphan-auth"

    @pytest.mark.asyncio
    async def test_aborts_when_orphan_fraction_too_high(self, monkeypatch):
        async def fake_paginate_core(http, **kwargs):
            return set()

        async def fake_paginate_auth(http, **kwargs):
            return [{"id": f"orphan-{i}", "email": f"o{i}@example.com"} for i in range(10)]

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_core_auth_ids",
            fake_paginate_core,
        )
        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_auth_users",
            fake_paginate_auth,
        )

        with pytest.raises(OrphanCleanupError, match="safe threshold"):
            await create_dry_run_snapshot(
                supabase_url="https://example.supabase.co",
                service_role_key="service-key",
                actor="admin@test",
            )

    @pytest.mark.asyncio
    async def test_execute_rechecks_before_delete(self, monkeypatch):
        async def fake_paginate_core(http, **kwargs):
            return {f"live-{i}" for i in range(9)}

        async def fake_paginate_auth(http, **kwargs):
            return (
                [{"id": f"live-{i}", "email": f"live{i}@example.com"} for i in range(9)]
                + [{"id": "orphan-auth", "email": "orphan@example.com"}]
            )

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_core_auth_ids",
            fake_paginate_core,
        )
        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_auth_users",
            fake_paginate_auth,
        )

        snapshot = await create_dry_run_snapshot(
            supabase_url="https://example.supabase.co",
            service_role_key="service-key",
            actor="admin@test",
        )

        async def recheck_core(http, **kwargs):
            return {f"live-{i}" for i in range(9)} | {"orphan-auth"}

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_core_auth_ids",
            recheck_core,
        )

        async def has_core_row(http, **kwargs):
            return kwargs["auth_id"] == "orphan-auth"

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup._auth_id_has_core_row",
            has_core_row,
        )

        result = await execute_snapshot(
            snapshot_id=snapshot.snapshot_id,
            confirmation_token=snapshot.confirmation_token,
            supabase_url="https://example.supabase.co",
            service_role_key="service-key",
            actor="admin@test",
        )
        assert result.deleted == []
        assert "orphan-auth" in result.skipped

    @pytest.mark.asyncio
    async def test_invalid_confirmation_token_rejected(self, monkeypatch):
        async def fake_paginate_core(http, **kwargs):
            return {f"live-{i}" for i in range(9)}

        async def fake_paginate_auth(http, **kwargs):
            return (
                [{"id": f"live-{i}", "email": f"live{i}@example.com"} for i in range(9)]
                + [{"id": "orphan-auth", "email": "orphan@example.com"}]
            )

        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_core_auth_ids",
            fake_paginate_core,
        )
        monkeypatch.setattr(
            "app.services.orphan_user_cleanup.paginate_auth_users",
            fake_paginate_auth,
        )

        snapshot = await create_dry_run_snapshot(
            supabase_url="https://example.supabase.co",
            service_role_key="service-key",
            actor="admin@test",
        )

        with pytest.raises(OrphanCleanupError, match="invalid confirmation token"):
            await execute_snapshot(
                snapshot_id=snapshot.snapshot_id,
                confirmation_token="wrong-token",
                supabase_url="https://example.supabase.co",
                service_role_key="service-key",
                actor="admin@test",
            )
