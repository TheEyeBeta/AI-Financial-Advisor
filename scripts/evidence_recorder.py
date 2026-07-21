"""Unified production-readiness evidence recorder (Phase 13).

Emits a single readiness "run" as both machine-readable JSON and human-readable
Markdown, with a stable schema and a tamper-evident content digest. Every
readiness exercise (test run, load profile, security check, recovery drill)
should produce one record so claims are reproducible and auditable.

Design goals
------------
* One schema, two renderings (JSON + Markdown) from one call.
* Tamper-evident: a SHA-256 digest over the canonical payload (digest field
  excluded) is stored alongside; ``verify_record`` recomputes and compares.
* Secret-safe: the recorder never captures environment values; callers pass
  already-sanitised commands and metrics.

This module is import-safe (no side effects) and has no third-party deps.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = "1.0"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def git_sha(default: str = "unknown") -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() or default
    except Exception:  # pragma: no cover - git absent
        return default


def _canonical_digest(payload: Dict[str, Any]) -> str:
    """Deterministic SHA-256 over the payload with the digest field removed."""
    clean = {k: v for k, v in payload.items() if k != "content_sha256"}
    blob = json.dumps(clean, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


@dataclass
class EvidenceRecord:
    work_package: str
    scenario: str
    result: str  # "pass" | "fail" | "partial" | "not_run"
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "development"))
    app_version: str = field(default_factory=lambda: os.getenv("APP_VERSION", "unknown"))
    run_id: str = ""
    started_at: str = ""
    finished_at: str = ""
    commit_sha: str = field(default_factory=git_sha)
    command: str = ""            # sanitised command (no secrets)
    preconditions: List[str] = field(default_factory=list)
    assertions: List[str] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)
    failure_details: str = ""
    artifacts: List[str] = field(default_factory=list)
    remaining_risks: List[str] = field(default_factory=list)
    reviewer_notes: str = ""

    def __post_init__(self) -> None:
        now = _utc_now_iso()
        self.started_at = self.started_at or now
        self.finished_at = self.finished_at or now
        if not self.run_id:
            stamp = now.replace(":", "").replace("-", "")
            self.run_id = f"{self.work_package}-{stamp}"

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "run_id": self.run_id,
            "work_package": self.work_package,
            "environment": self.environment,
            "app_version": self.app_version,
            "commit_sha": self.commit_sha,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "command": self.command,
            "scenario": self.scenario,
            "preconditions": self.preconditions,
            "assertions": self.assertions,
            "result": self.result,
            "metrics": self.metrics,
            "failure_details": self.failure_details,
            "artifacts": self.artifacts,
            "remaining_risks": self.remaining_risks,
            "reviewer_notes": self.reviewer_notes,
        }
        payload["content_sha256"] = _canonical_digest(payload)
        return payload

    def to_markdown(self) -> str:
        p = self.to_payload()
        lines = [
            f"# Evidence — {p['work_package']}: {p['scenario']}",
            "",
            f"- **Run ID:** `{p['run_id']}`",
            f"- **Result:** **{p['result'].upper()}**",
            f"- **Environment:** {p['environment']}  ·  **App version:** {p['app_version']}",
            f"- **Commit:** `{p['commit_sha']}`",
            f"- **Started:** {p['started_at']}  ·  **Finished:** {p['finished_at']}",
            f"- **Command:** `{p['command']}`" if p["command"] else "- **Command:** (n/a)",
            f"- **Content SHA-256:** `{p['content_sha256']}`",
            "",
        ]
        if p["preconditions"]:
            lines += ["## Preconditions", *[f"- {x}" for x in p["preconditions"]], ""]
        if p["assertions"]:
            lines += ["## Assertions", *[f"- {x}" for x in p["assertions"]], ""]
        if p["metrics"]:
            lines += ["## Metrics", "", "| Metric | Value |", "| --- | --- |"]
            lines += [f"| {k} | {v} |" for k, v in p["metrics"].items()]
            lines += [""]
        if p["failure_details"]:
            lines += ["## Failure details", p["failure_details"], ""]
        if p["artifacts"]:
            lines += ["## Artifacts", *[f"- `{x}`" for x in p["artifacts"]], ""]
        if p["remaining_risks"]:
            lines += ["## Remaining risks", *[f"- {x}" for x in p["remaining_risks"]], ""]
        lines += ["## Reviewer notes", p["reviewer_notes"] or "_(pending review)_", ""]
        return "\n".join(lines)

    def write(self, out_dir: str | Path) -> Dict[str, str]:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        json_path = out / f"{self.run_id}.json"
        md_path = out / f"{self.run_id}.md"
        json_path.write_text(json.dumps(self.to_payload(), indent=2) + "\n", encoding="utf-8")
        md_path.write_text(self.to_markdown(), encoding="utf-8")
        return {"json": str(json_path), "markdown": str(md_path)}


def verify_record(payload: Dict[str, Any]) -> bool:
    """Recompute the content digest and compare to the stored one."""
    stored = payload.get("content_sha256")
    return bool(stored) and stored == _canonical_digest(payload)


def verify_file(json_path: str | Path) -> bool:
    return verify_record(json.loads(Path(json_path).read_text(encoding="utf-8")))
