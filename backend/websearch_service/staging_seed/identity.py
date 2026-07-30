"""Preflight: print non-sensitive environment identity only.

Never prints URLs with embedded credentials, keys, or connection strings —
only a one-way hash of the project ref, the environment name, schema
revisions, and the bare target hostname.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import SeedConfig
from .db import connect, current_schema_revision, expected_schema_revision, project_ref_hash, target_hostname


@dataclass(frozen=True)
class PreflightIdentity:
    project_ref_hash: str
    environment: str
    expected_schema_revision: str | None
    actual_schema_revision: str | None
    target_hostname: str | None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "project_ref_hash": self.project_ref_hash,
            "environment": self.environment,
            "expected_schema_revision": self.expected_schema_revision,
            "actual_schema_revision": self.actual_schema_revision,
            "target_hostname": self.target_hostname,
        }


def gather_identity(config: SeedConfig) -> PreflightIdentity:
    actual_revision = None
    if config.database_url:
        with connect(config) as conn:
            actual_revision = current_schema_revision(conn)

    return PreflightIdentity(
        project_ref_hash=project_ref_hash(config),
        environment=config.environment,
        expected_schema_revision=expected_schema_revision(),
        actual_schema_revision=actual_revision,
        target_hostname=target_hostname(config),
    )
