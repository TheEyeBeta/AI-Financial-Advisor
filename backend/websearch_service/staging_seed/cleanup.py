"""Cleanup and reset for synthetic staging data.

Only ever deletes rows keyed by the synthetic markers this package itself
writes (``synthetic-seed-*@staging.invalid`` emails, and the
``synthetic-seed-script`` actor tag). It never issues an unscoped DELETE.
"""

from __future__ import annotations

import logging

import psycopg

from . import SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_MARKER
from .auth_client import AuthAdminClient
from .config import SeedConfig
from .db import connect, table_exists

logger = logging.getLogger("staging_seed.cleanup")

SYNTHETIC_EMAIL_PATTERN = f"synthetic-seed-%@{SYNTHETIC_EMAIL_DOMAIN}"


def _synthetic_users(conn: psycopg.Connection) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, auth_id FROM core.users WHERE email LIKE %s",
            (SYNTHETIC_EMAIL_PATTERN,),
        )
        return [(str(row[0]), str(row[1])) for row in cur.fetchall()]


def run_cleanup(config: SeedConfig) -> dict[str, int]:
    auth = AuthAdminClient(config.supabase_url, config.supabase_service_role_key)
    removed = {"users": 0, "admin_jobs": 0, "audit_events": 0, "academy_rows": 0}

    with connect(config) as conn:
        users = _synthetic_users(conn)
        user_ids = [uid for uid, _ in users]

        if user_ids:
            for schema, table in (("academy", "user_lesson_progress"), ("academy", "profiles")):
                if not table_exists(conn, schema, table):
                    continue
                with conn.cursor() as cur:
                    cur.execute(
                        f'DELETE FROM "{schema}"."{table}" WHERE user_id = ANY(%s) OR id = ANY(%s)',
                        (user_ids, user_ids),
                    )
                    removed["academy_rows"] += cur.rowcount

        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM core.admin_jobs WHERE actor_id = %s",
                (SYNTHETIC_MARKER,),
            )
            removed["admin_jobs"] = cur.rowcount

        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM core.user_account_audit WHERE actor = %s",
                (SYNTHETIC_MARKER,),
            )
            removed["audit_events"] = cur.rowcount

        # Deleting the auth user cascades to core.users, and from there to
        # ai.chats/chat_messages/chat_turn_requests and every trading.* table
        # via their `ON DELETE CASCADE` foreign keys — see sql/schema.sql.
        for _, auth_id in users:
            auth.delete_user(auth_id)
            removed["users"] += 1

    logger.info("Cleanup complete: %s", removed)
    return removed


def run_reset(config: SeedConfig) -> dict[str, dict[str, int]]:
    from .seeder import run_seed

    cleanup_result = run_cleanup(config)
    seed_result = run_seed(config)
    return {"cleanup": cleanup_result, "seed": seed_result}
