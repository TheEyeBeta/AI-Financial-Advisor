"""Tests proving the staging seeder is deterministic and idempotent.

Uses a lightweight fake psycopg connection/cursor rather than a real
database, so these run offline in CI without any staging credentials.
"""
from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from staging_seed.auth_client import CreatedAuthUser
from staging_seed.cleanup import SYNTHETIC_EMAIL_PATTERN
from staging_seed.config import SeedConfig
from staging_seed.generators import SeedRandom, deterministic_uuid, synthetic_email
from staging_seed.seeder import Seeder

STAGING_SEED_DIR = Path(__file__).resolve().parent.parent / "staging_seed"


# ─── Deterministic generation ────────────────────────────────────────────────

def test_deterministic_uuid_stable_across_calls():
    a = deterministic_uuid(42, "user", 1)
    b = deterministic_uuid(42, "user", 1)
    assert a == b


def test_deterministic_uuid_differs_by_seed():
    assert deterministic_uuid(1, "user", 1) != deterministic_uuid(2, "user", 1)


def test_deterministic_uuid_differs_by_index():
    assert deterministic_uuid(1, "user", 1) != deterministic_uuid(1, "user", 2)


def test_user_profile_is_deterministic_for_same_seed():
    rng_a = SeedRandom(999)
    rng_b = SeedRandom(999)
    profile_a = rng_a.user_profile(7)
    profile_b = rng_b.user_profile(7)
    assert profile_a == profile_b


def test_user_profile_differs_across_seeds():
    profile_a = SeedRandom(1).user_profile(7)
    profile_b = SeedRandom(2).user_profile(7)
    assert profile_a.first_name != profile_b.first_name or profile_a.age != profile_b.age


def test_synthetic_email_is_clearly_synthetic_and_non_deliverable():
    email = synthetic_email(1)
    assert email.startswith("synthetic-seed-")
    assert email.endswith("@staging.invalid")  # RFC 2606 reserved, non-resolvable TLD


def test_synthetic_email_matches_cleanup_lookup_pattern():
    # cleanup.py and verify.py must be able to find every row this
    # generator produces via a single SQL LIKE pattern.
    email = synthetic_email(123)
    like_regex = "^" + re.escape(SYNTHETIC_EMAIL_PATTERN).replace("%", ".*") + "$"
    assert re.match(like_regex, email)


# ─── Every mutating INSERT is conflict-safe (static contract check) ────────

def test_every_insert_in_seeder_has_on_conflict_clause():
    source = (STAGING_SEED_DIR / "seeder.py").read_text()
    statements = re.split(r"(?=INSERT INTO)", source)
    insert_statements = [s for s in statements if s.strip().startswith("INSERT INTO")]
    assert len(insert_statements) >= 8  # sanity: we expect one per entity type

    for statement in insert_statements:
        # Look only at the SQL text up to the closing triple-quote of this
        # cursor.execute(...) call, not the rest of the file.
        sql_chunk = statement.split('"""', 2)[0]
        assert "ON CONFLICT" in sql_chunk, f"Missing ON CONFLICT in:\n{sql_chunk[:200]}"


def test_every_delete_in_cleanup_is_scoped_with_where():
    source = (STAGING_SEED_DIR / "cleanup.py").read_text()
    statements = re.split(r"(?=DELETE FROM)", source)
    delete_statements = [s for s in statements if s.strip().startswith("DELETE FROM")]
    assert len(delete_statements) >= 3

    for statement in delete_statements:
        sql_chunk = statement.split("\n", 4)
        sql_text = " ".join(sql_chunk[:4])
        assert "WHERE" in sql_text, f"Unscoped DELETE found:\n{sql_text}"


# ─── Fake-DB idempotency test for the trickiest logic: ensure_users ────────

class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn
        self._result: list[tuple] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.conn.executed.append((sql.strip(), params))
        normalised = " ".join(sql.split())

        if normalised.startswith("SELECT email, id, auth_id FROM core.users"):
            self._result = [
                (email, uid, aid) for email, (uid, aid) in self.conn.existing_users.items()
            ]
        elif normalised.startswith("SELECT id FROM core.users WHERE auth_id"):
            auth_id = params[0]
            match = next(
                ((uid, aid) for uid, aid in self.conn.existing_users.values() if aid == auth_id),
                None,
            )
            self._result = [(match[0],)] if match else []
        elif normalised.startswith("UPDATE core.users"):
            self._result = []
        else:
            self._result = []

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return list(self._result)

    @property
    def rowcount(self) -> int:
        return len(self._result)


class FakeConn:
    def __init__(self, existing_users: dict[str, tuple[str, str]] | None = None) -> None:
        self.existing_users = existing_users or {}
        self.executed: list[tuple[str, tuple]] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


def make_config(**overrides) -> SeedConfig:
    defaults = dict(
        environment="staging",
        allow_synthetic_seed=True,
        supabase_url="https://fakeproject.supabase.co",
        supabase_service_role_key="fake-key",
        database_url="postgresql://user:pass@fake-staging-db:5432/postgres",
        production_denylist=[],
        random_seed=555,
        user_count=3,
    )
    defaults.update(overrides)
    return SeedConfig(**defaults)


def test_ensure_users_creates_new_users_when_none_exist():
    config = make_config()
    conn = FakeConn(existing_users={})

    def fake_create_user(*, email, first_name, last_name):
        # Simulate core.handle_new_user() provisioning core.users the moment
        # the auth user is created — same as it would on a real database.
        index = int(email.split("-")[-1].split("@")[0])
        auth_id = f"auth-{index}"
        conn.existing_users[email] = (f"core-{index}", auth_id)
        return CreatedAuthUser(auth_id=auth_id, email=email, created=True)

    fake_auth = MagicMock()
    fake_auth.create_user.side_effect = fake_create_user

    seeder = Seeder(config, auth=fake_auth)
    users = seeder.ensure_users(conn)

    assert fake_auth.create_user.call_count == config.user_count
    assert len(users) == config.user_count
    assert seeder.summary.users_created == config.user_count


def test_ensure_users_is_idempotent_when_all_users_already_exist():
    config = make_config()
    existing = {
        synthetic_email(i): (f"core-{i}", f"auth-{i}") for i in range(1, config.user_count + 1)
    }
    fake_auth = MagicMock()

    seeder = Seeder(config, auth=fake_auth)
    conn = FakeConn(existing_users=existing)

    users = seeder.ensure_users(conn)

    fake_auth.create_user.assert_not_called()
    assert len(users) == config.user_count
    assert seeder.summary.users_created == 0
    assert {u.id for u in users} == {f"core-{i}" for i in range(1, config.user_count + 1)}


def test_ensure_users_only_creates_the_missing_users():
    config = make_config(user_count=5)
    existing = {synthetic_email(i): (f"core-{i}", f"auth-{i}") for i in [1, 2]}
    conn = FakeConn(existing_users=dict(existing))

    def fake_create_user(*, email, first_name, last_name):
        index = int(email.split("-")[-1].split("@")[0])
        auth_id = f"auth-{index}"
        conn.existing_users[email] = (f"core-{index}", auth_id)
        return CreatedAuthUser(auth_id=auth_id, email=email, created=True)

    fake_auth = MagicMock()
    fake_auth.create_user.side_effect = fake_create_user

    seeder = Seeder(config, auth=fake_auth)
    users = seeder.ensure_users(conn)

    assert fake_auth.create_user.call_count == 3
    assert len(users) == 5


def test_ensure_users_raises_if_trigger_never_provisions_core_user(monkeypatch):
    monkeypatch.setattr("staging_seed.seeder.time.sleep", lambda *_: None)
    config = make_config(user_count=1)
    fake_auth = MagicMock()
    fake_auth.create_user.return_value = CreatedAuthUser(
        auth_id="auth-orphan", email=synthetic_email(1), created=True
    )

    seeder = Seeder(config, auth=fake_auth)
    conn = FakeConn(existing_users={})  # trigger never fires -> lookup stays empty

    with pytest.raises(RuntimeError, match="was not provisioned"):
        seeder.ensure_users(conn)
