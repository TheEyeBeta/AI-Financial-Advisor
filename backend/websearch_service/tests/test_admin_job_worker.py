"""Tests for admin job worker execution."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services import admin_job_worker as worker
from app.services.admin_jobs import JOB_TYPE_RANKING


@pytest.mark.asyncio
async def test_execute_admin_job_marks_success():
    job = {"id": "job-1", "job_type": JOB_TYPE_RANKING, "parameters": {}}

    async def _heartbeat_loop():
        await asyncio.sleep(3600)

    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    with patch.object(worker, "complete_job") as complete_mock, patch.object(
        worker,
        "_run_ranking_job",
        new=AsyncMock(return_value={"tickers_scored": 3}),
    ), patch.object(worker, "heartbeat_job"), patch.object(
        worker.asyncio, "create_task", return_value=heartbeat_task
    ):
        await worker.execute_admin_job(job)

    complete_mock.assert_called_once()
    assert complete_mock.call_args.kwargs["status"] == "succeeded"


@pytest.mark.asyncio
async def test_execute_admin_job_marks_failure():
    job = {"id": "job-2", "job_type": JOB_TYPE_RANKING, "parameters": {}}

    async def _heartbeat_loop():
        await asyncio.sleep(3600)

    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    with patch.object(worker, "complete_job") as complete_mock, patch.object(
        worker,
        "_run_ranking_job",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ), patch.object(worker, "heartbeat_job"), patch.object(
        worker.asyncio, "create_task", return_value=heartbeat_task
    ):
        await worker.execute_admin_job(job)

    complete_mock.assert_called_once()
    assert complete_mock.call_args.kwargs["status"] == "failed"


@pytest.mark.asyncio
async def test_execute_admin_job_unknown_type_marks_failed():
    job = {"id": "job-3", "job_type": "unknown", "parameters": {}}
    with patch.object(worker, "complete_job") as complete_mock:
        await worker.execute_admin_job(job)
    assert complete_mock.call_args.kwargs["status"] == "failed"
    with patch.object(worker.asyncio, "to_thread", new=AsyncMock(return_value=None)):
        assert await worker.process_next_admin_job() is False
