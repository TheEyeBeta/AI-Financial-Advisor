"""Safe orphan auth-user cleanup with dry-run / confirm workflow."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CORE_PAGE_SIZE = 1000
AUTH_PER_PAGE = 1000
MAX_DELETES_PER_RUN = 50
MAX_ORPHAN_FRACTION = 0.25
SNAPSHOT_TTL_SECONDS = 900


class OrphanCleanupError(Exception):
    """Base error for orphan cleanup failures."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class OrphanCandidate:
    auth_id: str
    email: str | None
    reason: str


@dataclass
class DryRunSnapshot:
    snapshot_id: str
    confirmation_token: str
    candidates: list[OrphanCandidate]
    total_auth_users: int
    expires_at: datetime


@dataclass
class ExecuteResult:
    snapshot_id: str
    deleted: list[str]
    skipped: list[str]
    failed: list[str]
    quarantined: list[str]


# In-process snapshot store (single-worker); persisted audit via Supabase when configured.
_SNAPSHOT_STORE: dict[str, dict[str, Any]] = {}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _signing_key(service_role_key: str) -> bytes:
    return service_role_key.encode("utf-8")


def _parse_content_range_total(headers: httpx.Headers) -> int | None:
    content_range = headers.get("content-range", "")
    if "/" not in content_range:
        return None
    total = content_range.split("/")[-1].strip()
    if not total or total == "*":
        return None
    try:
        return int(total)
    except ValueError:
        return None


async def paginate_core_auth_ids(
    http: httpx.AsyncClient,
    *,
    supabase_url: str,
    headers: dict[str, str],
) -> set[str]:
    """Fetch every core.users.auth_id via PostgREST pagination. Fail closed on errors."""
    auth_ids: set[str] = set()
    offset = 0
    expected_total: int | None = None

    while True:
        end = offset + CORE_PAGE_SIZE - 1
        page_headers = {
            **headers,
            "Accept-Profile": "core",
            "Range": f"{offset}-{end}",
            "Prefer": "count=exact",
        }
        resp = await http.get(
            f"{supabase_url}/rest/v1/users",
            params={"select": "auth_id"},
            headers=page_headers,
        )
        if resp.status_code not in (200, 206):
            raise OrphanCleanupError(
                f"core.users query failed: HTTP {resp.status_code}",
                status_code=502,
            )

        page_total = _parse_content_range_total(resp.headers)
        if expected_total is None and page_total is not None:
            expected_total = page_total

        rows = resp.json()
        if not isinstance(rows, list):
            raise OrphanCleanupError("core.users returned unexpected payload", status_code=502)

        for row in rows:
            auth_id = row.get("auth_id")
            if auth_id:
                auth_ids.add(str(auth_id))

        if len(rows) < CORE_PAGE_SIZE:
            break
        offset += CORE_PAGE_SIZE

    if expected_total is not None and len(auth_ids) != expected_total:
        raise OrphanCleanupError(
            "core.users pagination count mismatch; aborting to prevent unsafe deletes",
            status_code=502,
        )

    return auth_ids


async def paginate_auth_users(
    http: httpx.AsyncClient,
    *,
    supabase_url: str,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    """Page through all auth.users records."""
    users: list[dict[str, Any]] = []
    page = 1

    while True:
        resp = await http.get(
            f"{supabase_url}/auth/v1/admin/users",
            params={"page": page, "per_page": AUTH_PER_PAGE},
            headers=headers,
        )
        if resp.status_code != 200:
            raise OrphanCleanupError(
                f"auth.users list failed: HTTP {resp.status_code}",
                status_code=502,
            )

        data = resp.json()
        batch = data.get("users", [])
        if not batch:
            break

        users.extend(batch)
        if len(batch) < AUTH_PER_PAGE:
            break
        page += 1

    return users


def _find_candidates(
    auth_users: list[dict[str, Any]],
    live_auth_ids: set[str],
) -> list[OrphanCandidate]:
    candidates: list[OrphanCandidate] = []
    for user in auth_users:
        auth_id = user.get("id")
        if not auth_id:
            continue
        if str(auth_id) not in live_auth_ids:
            candidates.append(
                OrphanCandidate(
                    auth_id=str(auth_id),
                    email=user.get("email"),
                    reason="no matching core.users.auth_id",
                )
            )
    return candidates


def _enforce_safety_limits(candidates: list[OrphanCandidate], total_auth_users: int) -> None:
    if total_auth_users <= 0:
        return
    fraction = len(candidates) / total_auth_users
    if fraction > MAX_ORPHAN_FRACTION:
        raise OrphanCleanupError(
            f"orphan candidate fraction {fraction:.1%} exceeds safe threshold "
            f"({MAX_ORPHAN_FRACTION:.0%}); aborting",
            status_code=409,
        )
    if len(candidates) > MAX_DELETES_PER_RUN:
        raise OrphanCleanupError(
            f"{len(candidates)} orphan candidates exceeds per-run cap of {MAX_DELETES_PER_RUN}; "
            "run dry-run again after manual review",
            status_code=409,
        )


async def _auth_id_has_core_row(
    http: httpx.AsyncClient,
    *,
    supabase_url: str,
    headers: dict[str, str],
    auth_id: str,
) -> bool:
    resp = await http.get(
        f"{supabase_url}/rest/v1/users",
        params={"select": "auth_id", "auth_id": f"eq.{auth_id}"},
        headers={**headers, "Accept-Profile": "core"},
    )
    if resp.status_code != 200:
        raise OrphanCleanupError(
            f"core.users re-check failed for {auth_id}: HTTP {resp.status_code}",
            status_code=502,
        )
    rows = resp.json()
    return bool(rows)


def _store_snapshot(
    *,
    snapshot_id: str,
    token_hash: str,
    candidates: list[OrphanCandidate],
    total_auth_users: int,
    actor: str,
    expires_at: datetime,
) -> None:
    _SNAPSHOT_STORE[snapshot_id] = {
        "token_hash": token_hash,
        "candidate_auth_ids": [c.auth_id for c in candidates],
        "candidates": candidates,
        "total_auth_users": total_auth_users,
        "actor": actor,
        "expires_at": expires_at,
        "status": "pending",
    }


async def create_dry_run_snapshot(
    *,
    supabase_url: str,
    service_role_key: str,
    actor: str,
) -> DryRunSnapshot:
    """Build orphan candidate snapshot without deleting anything."""
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    async with httpx.AsyncClient(timeout=60.0) as http:
        live_auth_ids = await paginate_core_auth_ids(http, supabase_url=supabase_url, headers=headers)
        auth_users = await paginate_auth_users(http, supabase_url=supabase_url, headers=headers)

    candidates = _find_candidates(auth_users, live_auth_ids)
    total_auth_users = len(auth_users)
    _enforce_safety_limits(candidates, total_auth_users)

    snapshot_id = str(uuid.uuid4())
    confirmation_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(confirmation_token)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=SNAPSHOT_TTL_SECONDS)

    _store_snapshot(
        snapshot_id=snapshot_id,
        token_hash=token_hash,
        candidates=candidates,
        total_auth_users=total_auth_users,
        actor=actor,
        expires_at=expires_at,
    )

    logger.info(
        "Orphan purge dry-run by %s: snapshot=%s candidates=%d total_auth=%d",
        actor,
        snapshot_id,
        len(candidates),
        total_auth_users,
    )

    return DryRunSnapshot(
        snapshot_id=snapshot_id,
        confirmation_token=confirmation_token,
        candidates=candidates,
        total_auth_users=total_auth_users,
        expires_at=expires_at,
    )


def _load_snapshot(snapshot_id: str) -> dict[str, Any]:
    snapshot = _SNAPSHOT_STORE.get(snapshot_id)
    if not snapshot:
        raise OrphanCleanupError("snapshot not found or expired", status_code=404)
    if snapshot["status"] != "pending":
        raise OrphanCleanupError("snapshot already consumed", status_code=409)
    if datetime.now(timezone.utc) > snapshot["expires_at"]:
        snapshot["status"] = "expired"
        raise OrphanCleanupError("snapshot expired; run dry-run again", status_code=410)
    return snapshot


def _verify_confirmation_token(snapshot: dict[str, Any], confirmation_token: str, service_role_key: str) -> None:
    expected = snapshot["token_hash"]
    actual = _hash_token(confirmation_token)
    if not hmac.compare_digest(expected, actual):
        raise OrphanCleanupError("invalid confirmation token", status_code=403)


async def execute_snapshot(
    *,
    snapshot_id: str,
    confirmation_token: str,
    supabase_url: str,
    service_role_key: str,
    actor: str,
) -> ExecuteResult:
    """Execute deletions for a dry-run snapshot after revalidation."""
    snapshot = _load_snapshot(snapshot_id)
    if snapshot["actor"] != actor:
        raise OrphanCleanupError("snapshot actor mismatch", status_code=403)

    _verify_confirmation_token(snapshot, confirmation_token, service_role_key)

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    candidate_ids: list[str] = list(snapshot["candidate_auth_ids"])
    deleted: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []
    quarantined: list[str] = []

    async with httpx.AsyncClient(timeout=60.0) as http:
        # Rebuild live set and abort if pagination fails.
        live_auth_ids = await paginate_core_auth_ids(http, supabase_url=supabase_url, headers=headers)

        for auth_id in candidate_ids:
            if auth_id in live_auth_ids:
                skipped.append(auth_id)
                continue

            if await _auth_id_has_core_row(
                http, supabase_url=supabase_url, headers=headers, auth_id=auth_id
            ):
                skipped.append(auth_id)
                continue

            # Quarantine marker: record intent before destructive delete.
            quarantined.append(auth_id)

            try:
                del_resp = await http.delete(
                    f"{supabase_url}/auth/v1/admin/users/{auth_id}",
                    headers=headers,
                )
                if del_resp.status_code in (200, 204):
                    deleted.append(auth_id)
                else:
                    failed.append(auth_id)
            except httpx.HTTPError:
                failed.append(auth_id)

    snapshot["status"] = "executed"

    logger.info(
        "Orphan purge execute by %s: snapshot=%s deleted=%d skipped=%d failed=%d",
        actor,
        snapshot_id,
        len(deleted),
        len(skipped),
        len(failed),
    )

    return ExecuteResult(
        snapshot_id=snapshot_id,
        deleted=deleted,
        skipped=skipped,
        failed=failed,
        quarantined=quarantined,
    )


def clear_snapshot_store_for_tests() -> None:
    """Test helper."""
    _SNAPSHOT_STORE.clear()
