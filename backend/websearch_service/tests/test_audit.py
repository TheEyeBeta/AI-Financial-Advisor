"""Tests for audit service."""
import json
import os
import tempfile
from pathlib import Path
import pytest

from app.services.audit import audit_log


@pytest.mark.asyncio
async def test_audit_log_creates_file(tmp_path, monkeypatch):
    """Test that audit log creates a file."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    
    await audit_log("test_event", {"key": "value"})
    
    assert log_path.exists()
    
    with open(log_path) as f:
        lines = f.readlines()
        assert len(lines) == 1
        
        entry = json.loads(lines[0])
        assert entry["event"] == "test_event"
        assert entry["data"] == {"key": "value"}
        assert "timestamp" in entry


@pytest.mark.asyncio
async def test_audit_log_creates_directory(tmp_path, monkeypatch):
    """Test that audit log creates parent directory if it doesn't exist."""
    log_path = tmp_path / "subdir" / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    
    await audit_log("test_event", {"key": "value"})
    
    assert log_path.exists()
    assert log_path.parent.exists()


@pytest.mark.asyncio
async def test_audit_log_default_path(tmp_path, monkeypatch):
    """Test that audit log uses default path when env var is not set."""
    # Change to temp directory to avoid polluting project directory
    original_cwd = os.getcwd()
    try:
        os.chdir(tmp_path)
        monkeypatch.delenv("AI_AUDIT_LOG_PATH", raising=False)
        
        await audit_log("test_event", {"key": "value"})
        
        default_path = Path("logs/audit.jsonl")
        assert default_path.exists()
    finally:
        os.chdir(original_cwd)


@pytest.mark.asyncio
async def test_audit_log_appends_entries(tmp_path, monkeypatch):
    """Test that audit log appends entries to existing file."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    
    await audit_log("event1", {"data": "1"})
    await audit_log("event2", {"data": "2"})
    
    with open(log_path) as f:
        lines = f.readlines()
        assert len(lines) == 2
        
        entry1 = json.loads(lines[0])
        assert entry1["event"] == "event1"
        
        entry2 = json.loads(lines[1])
        assert entry2["event"] == "event2"


@pytest.mark.asyncio
async def test_audit_log_timestamp_format(tmp_path, monkeypatch):
    """Test that audit log includes properly formatted timestamp."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    
    await audit_log("test_event", {})
    
    with open(log_path) as f:
        entry = json.loads(f.readline())
        assert "timestamp" in entry
        # Check that timestamp is ISO format
        assert "T" in entry["timestamp"] or "Z" in entry["timestamp"]
