"""Idempotent synthetic staging seeder.

Call ``run_seed(config)`` after ``guard.assert_safe_to_mutate`` has passed.
Every insert is either keyed on a deterministic UUID with
``ON CONFLICT (id) DO NOTHING`` or, where a natural key exists (e.g.
``portfolio_history(user_id, date)``), on that natural key — so running the
seeder twice against the same target changes nothing on the second run.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from . import SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_MARKER
from .auth_client import AuthAdminClient
from .config import SeedConfig
from .db import connect, table_columns
from .generators import (
    CHAT_TOPICS,
    STOCK_SYMBOLS,
    SeedRandom,
    SyntheticUserProfile,
    date_days_ago,
    days_ago,
    deterministic_uuid,
)

logger = logging.getLogger("staging_seed.seeder")

TURN_STATUS_CYCLE = ["completed", "processing", "failed", "completed", "cancelled", "pending"]
ADMIN_JOB_COUNT = 30
ADMIN_JOB_TYPES = ["synthetic_report_job", "synthetic_cleanup_job", "synthetic_digest_job"]
ADMIN_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"]
AUDIT_ACTIONS = ["seed_created", "status_reviewed", "suspension_lifted"]


@dataclass(frozen=True)
class ResolvedUser:
    index: int
    id: str
    auth_id: str
    email: str


@dataclass
class SeedSummary:
    users_total: int = 0
    users_created: int = 0
    chats: int = 0
    messages: int = 0
    turn_requests: int = 0
    portfolio_history_rows: int = 0
    open_positions: int = 0
    journal_entries: int = 0
    academy_rows: int = 0
    admin_jobs: int = 0
    audit_events: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "users_total": self.users_total,
            "users_created": self.users_created,
            "chats": self.chats,
            "messages": self.messages,
            "turn_requests": self.turn_requests,
            "portfolio_history_rows": self.portfolio_history_rows,
            "open_positions": self.open_positions,
            "journal_entries": self.journal_entries,
            "academy_rows": self.academy_rows,
            "admin_jobs": self.admin_jobs,
            "audit_events": self.audit_events,
        }


def _generic_value_for(data_type: str) -> Any:
    data_type = (data_type or "").lower()
    if data_type == "uuid":
        import uuid

        return str(uuid.uuid4())
    if data_type in ("text", "character varying", "varchar", "citext"):
        return "synthetic"
    if data_type in ("integer", "bigint", "smallint", "numeric", "double precision", "real"):
        return 0
    if data_type == "boolean":
        return False
    if data_type in ("timestamp with time zone", "timestamp without time zone"):
        return datetime(2026, 1, 1, tzinfo=timezone.utc)
    if data_type == "date":
        return date_days_ago(0)
    if data_type in ("jsonb", "json"):
        return Jsonb({})
    if data_type == "array":
        return []
    return None


def _insert_generic_row(
    conn: psycopg.Connection, schema: str, table: str, known: dict[str, Any]
) -> bool:
    """Best-effort insert for tables whose exact schema isn't formally tracked
    in Alembic (see sql/README.md — several academy.* tables predate it).
    Returns False (and does nothing) if the table doesn't exist here."""
    columns = table_columns(conn, schema, table)
    if not columns:
        return False

    values = dict(known)
    for col in columns:
        name = col["name"]
        if name in values:
            continue
        if col["nullable"] or col["has_default"]:
            continue
        values[name] = _generic_value_for(col["data_type"])

    col_names = list(values.keys())
    collist = ", ".join(f'"{c}"' for c in col_names)
    placeholders = ", ".join(["%s"] * len(col_names))
    sql = f'INSERT INTO "{schema}"."{table}" ({collist}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    # Some academy.* tables predate formal Alembic tracking (sql/README.md)
    # and may carry FK/CHECK constraints this generic filler can't infer
    # (e.g. a lesson_id referencing a specific curriculum row). Isolate the
    # attempt in a SAVEPOINT so an unexpected constraint failure here never
    # rolls back the rest of an otherwise-successful seed run.
    try:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(sql, [values[c] for c in col_names])
    except psycopg.Error as exc:
        logger.warning(
            "Skipping %s.%s row — constraint this generic filler couldn't "
            "satisfy: %s",
            schema,
            table,
            exc,
        )
        return False
    return True


class Seeder:
    def __init__(self, config: SeedConfig, auth: AuthAdminClient | None = None) -> None:
        self.config = config
        self.rng = SeedRandom(config.random_seed)
        self.auth = auth or AuthAdminClient(config.supabase_url, config.supabase_service_role_key)
        self.summary = SeedSummary()

    # ── Users ────────────────────────────────────────────────────────────

    def _load_existing_users(self, conn: psycopg.Connection) -> dict[str, tuple[str, str]]:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, id, auth_id FROM core.users WHERE email LIKE %s",
                (f"synthetic-seed-%@{SYNTHETIC_EMAIL_DOMAIN}",),
            )
            return {row[0]: (str(row[1]), str(row[2])) for row in cur.fetchall()}

    def ensure_users(self, conn: psycopg.Connection) -> list[ResolvedUser]:
        existing = self._load_existing_users(conn)
        resolved: list[ResolvedUser] = []

        for index in range(1, self.config.user_count + 1):
            profile = self.rng.user_profile(index)

            if profile.email in existing:
                core_id, auth_id = existing[profile.email]
            else:
                created = self.auth.create_user(
                    email=profile.email,
                    first_name=profile.first_name,
                    last_name=profile.last_name,
                )
                auth_id = created.auth_id
                self.summary.users_created += 1
                core_id = self._wait_for_trigger_provisioned_user(conn, auth_id)

            self._sync_user_profile(conn, core_id, profile)
            resolved.append(
                ResolvedUser(index=index, id=core_id, auth_id=auth_id, email=profile.email)
            )

        self.summary.users_total = len(resolved)
        return resolved

    def _wait_for_trigger_provisioned_user(
        self, conn: psycopg.Connection, auth_id: str, attempts: int = 5
    ) -> str:
        """core.handle_new_user() provisions core.users on auth.users INSERT.
        The trigger runs synchronously inside GoTrue's own transaction, which
        commits before the Admin API HTTP call returns — so this should
        succeed on the first read. The tiny retry loop only guards against
        replica-lag style edge cases in hosted Supabase."""
        for attempt in range(attempts):
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM core.users WHERE auth_id = %s", (auth_id,))
                row = cur.fetchone()
            if row:
                return str(row[0])
            if attempt < attempts - 1:
                time.sleep(0.5)
        raise RuntimeError(
            f"core.users row for auth_id={auth_id} was not provisioned by "
            "core.handle_new_user() — check that the on_auth_user_created "
            "trigger is installed on this target."
        )

    def _sync_user_profile(
        self, conn: psycopg.Connection, core_id: str, profile: SyntheticUserProfile
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE core.users
                SET first_name = %s,
                    last_name = %s,
                    age = %s,
                    experience_level = %s,
                    risk_level = %s,
                    marital_status = %s,
                    investment_goal = %s,
                    onboarding_complete = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    profile.first_name,
                    profile.last_name,
                    profile.age,
                    profile.experience_level,
                    profile.risk_level,
                    profile.marital_status,
                    profile.investment_goal,
                    profile.onboarding_complete,
                    days_ago(0),
                    core_id,
                ),
            )

    # ── Chats, messages, AI turn requests ───────────────────────────────

    def seed_chats_and_turns(self, conn: psycopg.Connection, users: list[ResolvedUser]) -> None:
        seed = self.config.random_seed
        for user in users:
            rng = self.rng.rng_for("chat_plan", user.index)
            num_chats = rng.randint(1, 3)

            for chat_i in range(num_chats):
                chat_key = user.index * 10 + chat_i
                chat_id = deterministic_uuid(seed, "chat", chat_key)
                topic = rng.choice(CHAT_TOPICS)

                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO ai.chats (id, user_id, title, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            str(chat_id),
                            user.id,
                            f"Synthetic: {topic}",
                            days_ago(30 - chat_i),
                            days_ago(0),
                        ),
                    )
                self.summary.chats += 1

                num_messages = rng.randint(2, 6)
                message_ids: list[tuple[str, str]] = []
                for msg_i in range(num_messages):
                    message_key = chat_key * 100 + msg_i
                    message_id = deterministic_uuid(seed, "message", message_key)
                    role = "user" if msg_i % 2 == 0 else "assistant"
                    content = (
                        f"Synthetic {role} message {msg_i} about {topic} "
                        f"(user {user.index}, chat {chat_i})."
                    )
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO ai.chat_messages (id, user_id, chat_id, role, content, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO NOTHING
                            """,
                            (str(message_id), user.id, str(chat_id), role, content, days_ago(30 - chat_i)),
                        )
                    self.summary.messages += 1
                    if role == "user" and msg_i + 1 < num_messages:
                        assistant_key = chat_key * 100 + msg_i + 1
                        message_ids.append(
                            (str(message_id), str(deterministic_uuid(seed, "message", assistant_key)))
                        )

                for pair_i, (user_msg_id, assistant_msg_id) in enumerate(message_ids):
                    turn_key = chat_key * 10 + pair_i
                    turn_id = deterministic_uuid(seed, "turn_request", turn_key)
                    status = TURN_STATUS_CYCLE[turn_key % len(TURN_STATUS_CYCLE)]
                    self._insert_turn_request(
                        conn, turn_id, user, chat_id, user_msg_id, assistant_msg_id, status
                    )
                    self.summary.turn_requests += 1

    def _insert_turn_request(
        self,
        conn: psycopg.Connection,
        turn_id,
        user: ResolvedUser,
        chat_id,
        user_message_id: str,
        assistant_message_id: str,
        status: str,
    ) -> None:
        completed_at = None
        failure_code = None
        failure_reason = None
        resolved_assistant_id = None

        if status == "completed":
            resolved_assistant_id = assistant_message_id
            completed_at = days_ago(0)
        elif status == "failed":
            failure_code = "synthetic_provider_error"
            failure_reason = "Synthetic seed data: simulated provider failure."
            completed_at = days_ago(0)
        elif status == "processing":
            pass  # still in flight: no assistant message, no completed_at
        elif status == "cancelled":
            completed_at = days_ago(0)
        # "pending": everything stays NULL/default

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai.chat_turn_requests (
                    id, user_id, chat_id, user_message_id, assistant_message_id,
                    correlation_id, status, failure_code, failure_reason,
                    created_at, updated_at, completed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    str(turn_id),
                    user.id,
                    str(chat_id),
                    user_message_id,
                    resolved_assistant_id,
                    str(deterministic_uuid(self.config.random_seed, "correlation", str(turn_id))),
                    status,
                    failure_code,
                    failure_reason,
                    days_ago(1),
                    days_ago(0),
                    completed_at,
                ),
            )

    # ── Paper trading: portfolio history, positions, journal ───────────

    def seed_trading(self, conn: psycopg.Connection, users: list[ResolvedUser]) -> None:
        seed = self.config.random_seed
        for user in users:
            rng = self.rng.rng_for("trading", user.index)

            value = 10000.0
            for day_offset in range(14, 0, -1):
                value = max(0.0, value * (1 + rng.uniform(-0.02, 0.02)))
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO trading.portfolio_history (id, user_id, date, value, created_at)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (user_id, date) DO NOTHING
                        """,
                        (
                            str(deterministic_uuid(seed, "portfolio_history", user.index * 100 + day_offset)),
                            user.id,
                            date_days_ago(day_offset),
                            round(value, 2),
                            days_ago(day_offset),
                        ),
                    )
                self.summary.portfolio_history_rows += 1

            num_positions = rng.randint(0, 4)
            for pos_i in range(num_positions):
                symbol = rng.choice(STOCK_SYMBOLS)
                quantity = rng.randint(1, 50)
                entry_price = round(rng.uniform(10, 500), 2)
                current_price = round(entry_price * (1 + rng.uniform(-0.15, 0.15)), 2)
                position_type = "LONG" if rng.random() > 0.15 else "SHORT"
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO trading.open_positions (
                            id, user_id, symbol, name, quantity, entry_price,
                            current_price, type, entry_date, updated_at, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            str(deterministic_uuid(seed, "open_position", user.index * 10 + pos_i)),
                            user.id,
                            symbol,
                            f"Synthetic {symbol} Inc.",
                            quantity,
                            entry_price,
                            current_price,
                            position_type,
                            days_ago(rng.randint(1, 20)),
                            days_ago(0),
                            days_ago(rng.randint(1, 20)),
                        ),
                    )
                self.summary.open_positions += 1

            self._seed_journal(conn, user, rng)

    def _seed_journal(self, conn: psycopg.Connection, user: ResolvedUser, rng) -> None:
        """BUY entries first, then bounded SELL entries so the DB's oversell
        trigger (trading.enforce_journal_sell_within_position) never fires."""
        seed = self.config.random_seed
        symbols = rng.sample(STOCK_SYMBOLS, k=rng.randint(1, 2))
        entry_i = 0
        for symbol in symbols:
            buy_quantity = rng.randint(5, 40)
            buy_price = round(rng.uniform(10, 500), 2)
            self._insert_journal_entry(
                conn, user, seed, entry_i, symbol, "BUY", buy_quantity, buy_price,
                date_days_ago(rng.randint(10, 20)),
            )
            entry_i += 1

            if rng.random() > 0.4:
                sell_quantity = rng.randint(1, buy_quantity)
                sell_price = round(buy_price * (1 + rng.uniform(-0.1, 0.2)), 2)
                self._insert_journal_entry(
                    conn, user, seed, entry_i, symbol, "SELL", sell_quantity, sell_price,
                    date_days_ago(rng.randint(1, 9)),
                )
                entry_i += 1

    def _insert_journal_entry(
        self, conn, user: ResolvedUser, seed: int, entry_i: int, symbol: str,
        trade_type: str, quantity: int, price: float, trade_date,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO trading.trade_journal (
                    id, user_id, trade_id, symbol, type, date, quantity, price,
                    strategy, notes, tags, created_at, updated_at
                )
                VALUES (%s, %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    str(deterministic_uuid(seed, "trade_journal", user.index * 100 + entry_i)),
                    user.id,
                    symbol,
                    trade_type,
                    trade_date,
                    quantity,
                    price,
                    "synthetic-strategy",
                    "Synthetic seed data — not a real trade.",
                    ["synthetic-seed"],
                    days_ago(0),
                    days_ago(0),
                ),
            )
        self.summary.journal_entries += 1

    # ── Academy progress ────────────────────────────────────────────────

    def seed_academy(self, conn: psycopg.Connection, users: list[ResolvedUser]) -> None:
        for user in users:
            profile = self.rng.user_profile(user.index)
            created = _insert_generic_row(
                conn,
                "academy",
                "profiles",
                {"id": user.id, "display_name": f"{profile.first_name} {profile.last_name}"},
            )
            if created:
                self.summary.academy_rows += 1

            rng = self.rng.rng_for("academy", user.index)
            for lesson_i in range(rng.randint(1, 3)):
                progress_id = deterministic_uuid(
                    self.config.random_seed, "academy_progress", user.index * 10 + lesson_i
                )
                created = _insert_generic_row(
                    conn,
                    "academy",
                    "user_lesson_progress",
                    {
                        "id": str(progress_id),
                        "user_id": user.id,
                    },
                )
                if created:
                    self.summary.academy_rows += 1

    # ── Admin jobs ───────────────────────────────────────────────────────

    def seed_admin_jobs(self, conn: psycopg.Connection) -> None:
        seed = self.config.random_seed
        rng = self.rng.rng_for("admin_jobs")
        for i in range(ADMIN_JOB_COUNT):
            job_id = deterministic_uuid(seed, "admin_job", i)
            job_type = ADMIN_JOB_TYPES[i % len(ADMIN_JOB_TYPES)]
            status = ADMIN_JOB_STATUSES[i % len(ADMIN_JOB_STATUSES)]
            started_at = days_ago(rng.randint(1, 10)) if status != "queued" else None
            finished_at = days_ago(0) if status in ("succeeded", "failed", "cancelled") else None
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO core.admin_jobs (
                        id, job_type, status, idempotency_key, actor_id, parameters,
                        result_summary, error_code, error_detail, retry_count, max_retries,
                        correlation_id, created_at, updated_at, started_at, finished_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        str(job_id),
                        job_type,
                        status,
                        f"synthetic-seed:{seed}:admin_job:{i}",
                        SYNTHETIC_MARKER,
                        Jsonb({"synthetic": True}),
                        Jsonb({"synthetic": True}) if status == "succeeded" else None,
                        "synthetic_error" if status == "failed" else None,
                        "Synthetic seed data — simulated failure." if status == "failed" else None,
                        0,
                        3,
                        str(deterministic_uuid(seed, "admin_job_correlation", i)),
                        days_ago(10),
                        days_ago(0),
                        started_at,
                        finished_at,
                    ),
                )
            self.summary.admin_jobs += 1

    # ── Audit events ─────────────────────────────────────────────────────

    def seed_audit_events(self, conn: psycopg.Connection, users: list[ResolvedUser]) -> None:
        seed = self.config.random_seed
        audited_users = users[::5] or users[:1]
        for i, user in enumerate(audited_users):
            rng = self.rng.rng_for("audit", user.index)
            action = AUDIT_ACTIONS[i % len(AUDIT_ACTIONS)]
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO core.user_account_audit (
                        id, request_id, actor, target_auth_id, action, reason, result, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        str(deterministic_uuid(seed, "audit_event", user.index)),
                        str(deterministic_uuid(seed, "audit_request", user.index)),
                        SYNTHETIC_MARKER,
                        user.auth_id,
                        action,
                        "Synthetic seed data — audit trail fixture.",
                        "success",
                        days_ago(rng.randint(1, 25)),
                    ),
                )
            self.summary.audit_events += 1


def run_seed(config: SeedConfig) -> dict[str, int]:
    seeder = Seeder(config)
    with connect(config) as conn:
        users = seeder.ensure_users(conn)
        seeder.seed_chats_and_turns(conn, users)
        seeder.seed_trading(conn, users)
        seeder.seed_academy(conn, users)
        seeder.seed_admin_jobs(conn)
        seeder.seed_audit_events(conn, users)
    logger.info("Seed complete: %s", seeder.summary.as_dict())
    return seeder.summary.as_dict()
