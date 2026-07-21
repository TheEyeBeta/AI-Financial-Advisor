"""Non-destructive database recovery validator (Part 9).

Verifies that a database (a fresh restore, a staging rehearsal target, or the
live DB in read-only mode) is structurally complete and internally consistent,
WITHOUT performing any destructive operation. Every query is a read
(``SELECT`` / catalog lookups); the validator never writes, drops, or restores.

Injectable design: the caller supplies a ``run_sql(sql, params) -> list[tuple]``
callable (psycopg / SQLAlchemy / Supabase-backed in production, a fake in tests)
and an optional ``backup_metadata`` mapping. This keeps the validator fully unit
-testable against synthetic database states and mocks.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

RunSql = Callable[..., List[Sequence[Any]]]

# Only bare `schema.table` identifiers may be interpolated into a count query.
# Table names come from trusted config, but we still refuse anything that could
# be an injection vector — defence in depth.
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$")


def _is_safe_identifier(name: str) -> bool:
    return bool(_IDENTIFIER_RE.match(name or ""))


class CheckStatus(str, Enum):
    OK = "ok"
    FAIL = "fail"
    SKIP = "skip"


@dataclass
class RecoveryCheck:
    name: str
    status: CheckStatus
    detail: str = ""

    def to_dict(self) -> dict:
        return {"name": self.name, "status": self.status.value, "detail": self.detail}


@dataclass
class RecoveryReport:
    checks: List[RecoveryCheck] = field(default_factory=list)

    def add(self, name: str, status: CheckStatus, detail: str = "") -> None:
        self.checks.append(RecoveryCheck(name, status, detail))

    @property
    def failures(self) -> List[RecoveryCheck]:
        return [c for c in self.checks if c.status is CheckStatus.FAIL]

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "counts": {
                s.value: sum(1 for c in self.checks if c.status is s) for s in CheckStatus
            },
            "checks": [c.to_dict() for c in self.checks],
        }


# Sensible defaults for TheEye's six-schema model.
DEFAULT_REQUIRED_SCHEMAS = ("core", "ai", "trading", "market", "academy", "meridian")
# Verified against the migrated schema at head 0036 (Batch 3 Phase 7 execution on
# real Postgres) — the chat table is `ai.chats`, not the earlier guess.
DEFAULT_REQUIRED_TABLES = (
    "core.users",
    "ai.chats",
    "ai.chat_messages",
)
DEFAULT_REQUIRED_EXTENSIONS = ("uuid-ossp", "pgcrypto")
DEFAULT_MAX_BACKUP_AGE_HOURS = 26  # daily backup + margin


def _scalar(rows: List[Sequence[Any]], default: Any = None) -> Any:
    if rows and rows[0]:
        return rows[0][0]
    return default


def _column(rows: List[Sequence[Any]]) -> List[Any]:
    return [r[0] for r in rows if r]


def validate_recovery(
    run_sql: RunSql,
    *,
    expected_migration_head: Optional[str] = None,
    required_schemas: Sequence[str] = DEFAULT_REQUIRED_SCHEMAS,
    required_tables: Sequence[str] = DEFAULT_REQUIRED_TABLES,
    required_extensions: Sequence[str] = DEFAULT_REQUIRED_EXTENSIONS,
    required_functions: Sequence[str] = (),
    required_triggers: Sequence[str] = (),
    required_indexes: Sequence[str] = (),
    row_count_minimums: Optional[Mapping[str, int]] = None,
    backup_metadata: Optional[Mapping[str, Any]] = None,
    now: Optional[datetime] = None,
) -> RecoveryReport:
    """Run all non-destructive recovery checks and return a structured report."""
    report = RecoveryReport()
    now = now or datetime.now(timezone.utc)

    # 1) Connectivity
    try:
        if _scalar(run_sql("SELECT 1")) == 1:
            report.add("connectivity", CheckStatus.OK)
        else:
            report.add("connectivity", CheckStatus.FAIL, "SELECT 1 did not return 1")
            return report  # nothing else will work
    except Exception as exc:  # noqa: BLE001
        report.add("connectivity", CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")
        return report

    # 2) Migration head
    if expected_migration_head is None:
        report.add("migration_head", CheckStatus.SKIP, "no expected head provided")
    else:
        try:
            head = _scalar(run_sql("SELECT version_num FROM alembic_version"))
            if head == expected_migration_head:
                report.add("migration_head", CheckStatus.OK, f"at {head}")
            else:
                report.add("migration_head", CheckStatus.FAIL,
                           f"expected {expected_migration_head}, found {head}")
        except Exception as exc:  # noqa: BLE001
            report.add("migration_head", CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")

    # 3) Schemas
    try:
        present = set(_column(run_sql("SELECT schema_name FROM information_schema.schemata")))
        missing = [s for s in required_schemas if s not in present]
        report.add("critical_schemas", CheckStatus.OK if not missing else CheckStatus.FAIL,
                   "all present" if not missing else f"missing: {', '.join(missing)}")
    except Exception as exc:  # noqa: BLE001
        report.add("critical_schemas", CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")

    # 4) Tables (schema.table)
    try:
        rows = run_sql("SELECT table_schema, table_name FROM information_schema.tables")
        present_tbl = {f"{r[0]}.{r[1]}" for r in rows}
        missing = [t for t in required_tables if t not in present_tbl]
        report.add("critical_tables", CheckStatus.OK if not missing else CheckStatus.FAIL,
                   "all present" if not missing else f"missing: {', '.join(missing)}")
    except Exception as exc:  # noqa: BLE001
        report.add("critical_tables", CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")

    # 5) Extensions
    _catalog_presence(report, run_sql, "required_extensions",
                      "SELECT extname FROM pg_extension", required_extensions)
    # 6) Functions
    _catalog_presence(report, run_sql, "required_functions",
                      "SELECT proname FROM pg_proc", required_functions)
    # 7) Triggers
    _catalog_presence(report, run_sql, "required_triggers",
                      "SELECT tgname FROM pg_trigger", required_triggers)
    # 8) Indexes
    _catalog_presence(report, run_sql, "required_indexes",
                      "SELECT indexname FROM pg_indexes", required_indexes)

    # 9) Row-count sanity
    if row_count_minimums:
        for table, minimum in row_count_minimums.items():
            if not _is_safe_identifier(table):
                report.add(f"row_count[{table}]", CheckStatus.FAIL, "unsafe table identifier — refused")
                continue
            try:
                count = int(_scalar(run_sql(f"SELECT count(*) FROM {table}"), 0) or 0)
                if count >= minimum:
                    report.add(f"row_count[{table}]", CheckStatus.OK, f"{count} >= {minimum}")
                else:
                    report.add(f"row_count[{table}]", CheckStatus.FAIL, f"{count} < {minimum}")
            except Exception as exc:  # noqa: BLE001
                report.add(f"row_count[{table}]", CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")

    # 10) Auth-user profile provisioning (no orphaned auth users)
    try:
        orphaned = _scalar(run_sql(
            "SELECT count(*) FROM auth.users a "
            "LEFT JOIN core.users c ON c.id = a.id WHERE c.id IS NULL"
        ), None)
        if orphaned is None:
            report.add("auth_profile_provisioning", CheckStatus.SKIP, "auth.users not visible")
        elif int(orphaned) == 0:
            report.add("auth_profile_provisioning", CheckStatus.OK, "no orphaned auth users")
        else:
            report.add("auth_profile_provisioning", CheckStatus.FAIL,
                       f"{orphaned} auth users without a core.users profile")
    except Exception as exc:  # noqa: BLE001
        report.add("auth_profile_provisioning", CheckStatus.SKIP, f"{type(exc).__name__}")

    # 11) Backup metadata + restore timestamp freshness (from provided metadata)
    _check_backup_metadata(report, backup_metadata, now)

    return report


def _catalog_presence(report, run_sql, name, sql, required) -> None:
    if not required:
        report.add(name, CheckStatus.SKIP, "none required")
        return
    try:
        present = set(_column(run_sql(sql)))
        missing = [x for x in required if x not in present]
        report.add(name, CheckStatus.OK if not missing else CheckStatus.FAIL,
                   "all present" if not missing else f"missing: {', '.join(missing)}")
    except Exception as exc:  # noqa: BLE001
        report.add(name, CheckStatus.FAIL, f"{type(exc).__name__}: {exc}")


def _check_backup_metadata(report, backup_metadata, now) -> None:
    if not backup_metadata:
        report.add("backup_metadata", CheckStatus.SKIP, "no backup metadata provided")
        return
    available = backup_metadata.get("available")
    if not available:
        report.add("backup_metadata", CheckStatus.FAIL, "backup not marked available")
        return
    ts = backup_metadata.get("last_backup_at") or backup_metadata.get("restore_timestamp")
    if not ts:
        report.add("backup_metadata", CheckStatus.FAIL, "no backup/restore timestamp")
        return
    try:
        when = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        age_hours = (now - when).total_seconds() / 3600.0
        max_age = float(backup_metadata.get("max_age_hours", DEFAULT_MAX_BACKUP_AGE_HOURS))
        if age_hours <= max_age:
            report.add("backup_metadata", CheckStatus.OK, f"age {age_hours:.1f}h <= {max_age:.0f}h")
        else:
            report.add("backup_metadata", CheckStatus.FAIL, f"stale: age {age_hours:.1f}h > {max_age:.0f}h")
    except (ValueError, TypeError) as exc:
        report.add("backup_metadata", CheckStatus.FAIL, f"bad timestamp: {exc}")
