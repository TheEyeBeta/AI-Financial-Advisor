"""Tests for durable admin job queue helpers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services import admin_jobs as jobs


def test_enqueue_returns_existing_active_job():
    table = MagicMock()
    table.select.return_value.eq.return_value.in_.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "job-1", "status": "queued", "idempotency_key": "idem-12345678"}]
    )

    with patch.object(jobs, "supabase_client") as client:
        client.schema.return_value.table.return_value = table
        job, created = jobs.enqueue_admin_job(
            job_type=jobs.JOB_TYPE_RANKING,
            idempotency_key="idem-12345678",
            actor_id="admin@example.com",
        )

    assert created is False
    assert job["id"] == "job-1"
    table.insert.assert_not_called()


def test_enqueue_inserts_new_job():
    select_chain = MagicMock()
    select_chain.eq.return_value.in_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    insert_chain = MagicMock()
    insert_chain.execute.return_value = MagicMock(
        data=[{"id": "job-new", "status": "queued", "idempotency_key": "idem-12345678"}]
    )

    table = MagicMock()
    table.select.return_value = select_chain
    table.insert.return_value = insert_chain

    with patch.object(jobs, "supabase_client") as client:
        client.schema.return_value.table.return_value = table
        job, created = jobs.enqueue_admin_job(
            job_type=jobs.JOB_TYPE_RANKING,
            idempotency_key="idem-12345678",
            actor_id="admin@example.com",
        )

    assert created is True
    assert job["id"] == "job-new"
    insert_chain.execute.assert_called_once()


def test_enqueue_rejects_short_idempotency_key():
    with pytest.raises(jobs.AdminJobValidationError):
        jobs.enqueue_admin_job(
            job_type=jobs.JOB_TYPE_RANKING,
            idempotency_key="short",
            actor_id="admin@example.com",
        )


def test_list_admin_jobs_filters_by_status():
    table = MagicMock()
    table.select.return_value.order.return_value.limit.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "job-1", "status": "failed"}]
    )
    with patch.object(jobs, "supabase_client") as client:
        client.schema.return_value.table.return_value = table
        rows = jobs.list_admin_jobs(status="failed", limit=5)
    assert rows[0]["id"] == "job-1"


def test_get_admin_job_raises_when_missing():
    table = MagicMock()
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    with patch.object(jobs, "supabase_client") as client:
        client.schema.return_value.table.return_value = table
        with pytest.raises(jobs.AdminJobNotFound):
            jobs.get_admin_job("missing")


def test_claim_next_job_returns_none_when_empty():
    rpc = MagicMock()
    rpc.execute.return_value = MagicMock(data=[])
    with patch.object(jobs, "supabase_client") as client:
        client.schema.return_value.rpc.return_value = rpc
        assert jobs.claim_next_job() is None


def test_complete_job_rejects_non_terminal_status():
    with pytest.raises(jobs.AdminJobValidationError):
        jobs.complete_job("job-1", status="running")


def test_retry_failed_job_requires_failed_status():
    with patch.object(jobs, "get_admin_job", return_value={"status": "queued", "retry_count": 0, "max_retries": 3}):
        with pytest.raises(jobs.AdminJobValidationError):
            jobs.retry_failed_job("job-1", actor_id="admin@example.com")
