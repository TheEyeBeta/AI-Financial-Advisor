"""Post-seed integrity checks.

Read-only. Returns a report dict; ``run_verify`` raises ``IntegrityError``
if any check fails so CLI/CI callers can exit non-zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg

from . import SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_MARKER
from .config import SeedConfig
from .db import connect

SYNTHETIC_EMAIL_PATTERN = f"synthetic-seed-%@{SYNTHETIC_EMAIL_DOMAIN}"


class IntegrityError(RuntimeError):
    pass


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str


@dataclass
class VerifyReport:
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(c.passed for c in self.checks)

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "checks": [
                {"name": c.name, "passed": c.passed, "detail": c.detail} for c in self.checks
            ],
        }


def _scalar(conn: psycopg.Connection, sql: str, params: tuple = ()) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return int(row[0]) if row else 0


def run_verify(config: SeedConfig) -> VerifyReport:
    report = VerifyReport()

    with connect(config) as conn:
        user_count = _scalar(
            conn, "SELECT COUNT(*) FROM core.users WHERE email LIKE %s", (SYNTHETIC_EMAIL_PATTERN,)
        )
        report.checks.append(
            CheckResult(
                "synthetic_user_count",
                user_count >= config.user_count,
                f"{user_count} synthetic users present (expected >= {config.user_count})",
            )
        )

        orphan_chats = _scalar(
            conn,
            """
            SELECT COUNT(*) FROM ai.chats c
            LEFT JOIN core.users u ON u.id = c.user_id
            WHERE u.id IS NULL
            """,
        )
        report.checks.append(
            CheckResult("no_orphan_chats", orphan_chats == 0, f"{orphan_chats} orphan chats")
        )

        for status in ("completed", "failed", "processing"):
            count = _scalar(
                conn,
                """
                SELECT COUNT(*) FROM ai.chat_turn_requests r
                JOIN core.users u ON u.id = r.user_id
                WHERE r.status = %s AND u.email LIKE %s
                """,
                (status, SYNTHETIC_EMAIL_PATTERN),
            )
            report.checks.append(
                CheckResult(
                    f"turn_requests_status_{status}_present",
                    count > 0,
                    f"{count} synthetic turn requests with status={status}",
                )
            )

        for schema, table in (
            ("trading", "portfolio_history"),
            ("trading", "trade_journal"),
        ):
            count = _scalar(
                conn,
                f"""
                SELECT COUNT(*) FROM "{schema}"."{table}" t
                JOIN core.users u ON u.id = t.user_id
                WHERE u.email LIKE %s
                """,
                (SYNTHETIC_EMAIL_PATTERN,),
            )
            report.checks.append(
                CheckResult(
                    f"{schema}_{table}_present",
                    count > 0,
                    f"{count} synthetic {schema}.{table} rows",
                )
            )

        admin_job_count = _scalar(
            conn, "SELECT COUNT(*) FROM core.admin_jobs WHERE actor_id = %s", (SYNTHETIC_MARKER,)
        )
        report.checks.append(
            CheckResult("admin_jobs_present", admin_job_count > 0, f"{admin_job_count} synthetic admin jobs")
        )

        audit_count = _scalar(
            conn, "SELECT COUNT(*) FROM core.user_account_audit WHERE actor = %s", (SYNTHETIC_MARKER,)
        )
        report.checks.append(
            CheckResult("audit_events_present", audit_count > 0, f"{audit_count} synthetic audit events")
        )

        non_synthetic_touched = _scalar(
            conn,
            "SELECT COUNT(*) FROM core.user_account_audit WHERE actor = %s AND target_auth_id NOT IN "
            "(SELECT auth_id FROM core.users WHERE email LIKE %s)",
            (SYNTHETIC_MARKER, SYNTHETIC_EMAIL_PATTERN),
        )
        report.checks.append(
            CheckResult(
                "audit_events_scoped_to_synthetic_users",
                non_synthetic_touched == 0,
                f"{non_synthetic_touched} synthetic-tagged audit rows point outside the synthetic user set",
            )
        )

    if not report.ok:
        failed = [c.name for c in report.checks if not c.passed]
        raise IntegrityError(f"Integrity check(s) failed: {', '.join(failed)}")

    return report
