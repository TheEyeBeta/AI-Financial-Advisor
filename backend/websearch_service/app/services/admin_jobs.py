"""Durable admin job queue backed by core.admin_jobs."""

from __future__ import annotations

import logging
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]

ACTIVE_STATUSES = frozenset({"queued", "running"})
TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})

JOB_TYPE_RANKING = "ranking_engine"
JOB_TYPE_MEMORY_SCAN = "memory_history_scan"
JOB_TYPE_INTELLIGENCE = "intelligence_engine"
JOB_TYPE_MEMORY_EXTRACTION = "memory_extraction"
JOB_TYPE_MERIDIAN_REFRESH = "meridian_refresh"

ALL_JOB_TYPES = frozenset(
    {
        JOB_TYPE_RANKING,
        JOB_TYPE_MEMORY_SCAN,
        JOB_TYPE_INTELLIGENCE,
        JOB_TYPE_MEMORY_EXTRACTION,
        JOB_TYPE_MERIDIAN_REFRESH,
    }
)

DEFAULT_LEASE_SECONDS = 300


class AdminJobError(Exception):
    """Base error for admin job operations."""


class AdminJobNotFound(AdminJobError):
    pass


class AdminJobValidationError(AdminJobError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table():
    return supabase_client.schema("core").table("admin_jobs")


def _normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    return dict(row)


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def enqueue_admin_job(
    *,
    job_type: str,
    idempotency_key: str,
    actor_id: str | None,
    parameters: dict[str, Any] | None = None,
    correlation_id: str | None = None,
    max_retries: int = 3,
) -> tuple[dict[str, Any], bool]:
    """Queue a job. Returns (job, created) where created=False means an active job already existed."""
    if job_type not in ALL_JOB_TYPES:
        raise AdminJobValidationError(f"Unsupported job_type: {job_type}")

    key = idempotency_key.strip()
    if len(key) < 8:
        raise AdminJobValidationError("idempotency_key must be at least 8 characters")

    existing = (
        _table()
        .select("*")
        .eq("idempotency_key", key)
        .in_("status", list(ACTIVE_STATUSES))
        .limit(1)
        .execute()
    )
    if existing.data:
        return _normalize_row(existing.data[0]), False

    row = {
        "job_type": job_type,
        "status": "queued",
        "idempotency_key": key,
        "actor_id": actor_id,
        "parameters": parameters or {},
        "max_retries": max_retries,
        "correlation_id": correlation_id or str(uuid.uuid4()),
    }
    try:
        inserted = _table().insert(row).execute()
        return _normalize_row(inserted.data[0]), True
    except Exception as exc:
        # Race: another request inserted the active job first.
        logger.warning("admin_jobs enqueue race for key=%s: %s", key, exc)
        raced = (
            _table()
            .select("*")
            .eq("idempotency_key", key)
            .in_("status", list(ACTIVE_STATUSES))
            .limit(1)
            .execute()
        )
        if raced.data:
            return _normalize_row(raced.data[0]), False
        raise


def get_admin_job(job_id: str) -> dict[str, Any]:
    result = _table().select("*").eq("id", job_id).limit(1).execute()
    if not result.data:
        raise AdminJobNotFound(job_id)
    return _normalize_row(result.data[0])


def list_admin_jobs(*, status: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    query = _table().select("*").order("created_at", desc=True).limit(limit)
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return [_normalize_row(row) for row in result.data or []]


def claim_next_job(*, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> dict[str, Any] | None:
    result = (
        supabase_client.schema("core")
        .rpc(
            "claim_admin_job",
            {"p_worker_id": worker_id(), "p_lease_seconds": lease_seconds},
        )
        .execute()
    )
    if not result.data:
        return None
    row = result.data[0] if isinstance(result.data, list) else result.data
    return _normalize_row(row)


def heartbeat_job(job_id: str, *, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> None:
    expires = datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)
    _table().update(
        {
            "heartbeat_at": _now_iso(),
            "lease_expires_at": expires.isoformat(),
            "updated_at": _now_iso(),
        }
    ).eq("id", job_id).eq("status", "running").execute()


def update_job_progress(job_id: str, progress: dict[str, Any]) -> None:
    _table().update({"progress": progress, "updated_at": _now_iso()}).eq("id", job_id).execute()


def complete_job(
    job_id: str,
    *,
    status: JobStatus,
    result_summary: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_detail: str | None = None,
) -> dict[str, Any]:
    if status not in TERMINAL_STATUSES:
        raise AdminJobValidationError(f"Invalid terminal status: {status}")

    payload: dict[str, Any] = {
        "status": status,
        "finished_at": _now_iso(),
        "updated_at": _now_iso(),
        "lease_owner": None,
        "lease_expires_at": None,
    }
    if result_summary is not None:
        payload["result_summary"] = result_summary
    if error_code is not None:
        payload["error_code"] = error_code
    if error_detail is not None:
        payload["error_detail"] = error_detail

    updated = _table().update(payload).eq("id", job_id).execute()
    if not updated.data:
        raise AdminJobNotFound(job_id)
    return _normalize_row(updated.data[0])


def retry_failed_job(job_id: str, *, actor_id: str | None) -> dict[str, Any]:
    job = get_admin_job(job_id)
    if job["status"] != "failed":
        raise AdminJobValidationError("Only failed jobs can be retried")
    if int(job.get("retry_count") or 0) >= int(job.get("max_retries") or 3):
        raise AdminJobValidationError("Maximum retry count reached")

    retry_key = f"{job['idempotency_key']}:retry:{uuid.uuid4().hex[:12]}"
    return enqueue_admin_job(
        job_type=job["job_type"],
        idempotency_key=retry_key,
        actor_id=actor_id,
        parameters=job.get("parameters") or {},
        correlation_id=job.get("correlation_id"),
        max_retries=job.get("max_retries") or 3,
    )[0]
