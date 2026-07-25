"""Database-level tests for the Academy RPC authorization fix (migration 0038).

Gate 2 AUTH-HIGH-02: `start_lesson`, `complete_lesson`, `complete_assessment`,
`record_question_attempt`, `get_personalized_learning_feed` accepted a
caller-supplied `p_user_id` with no check against the caller's own identity,
and were executable by the unauthenticated `anon` role. 0038 closes this by
(a) revoking EXECUTE from PUBLIC/anon and granting it only to authenticated,
and (b) resolving the caller's identity from auth.uid() inside each function
and rejecting execution when it's NULL or doesn't match the supplied
p_user_id.

Like test_goal_progress_migration.py, these run against the migrated
Postgres from ALEMBIC_DATABASE_URL and are skipped when no database is
configured so the unit suite stays runnable standalone. Role-switching
(`SET ROLE`) requires the connecting role to be a superuser or a member of
`anon`/`authenticated` — the CI/rehearsal bootstrap grants this to whichever
role ALEMBIC_DATABASE_URL connects as.
"""
from __future__ import annotations

import contextlib
import os
import subprocess
import sys
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

_RAW_URL = (os.getenv("ALEMBIC_DATABASE_URL") or "").strip()
DSN = _RAW_URL.replace("postgresql+psycopg://", "postgresql://")

pytestmark = pytest.mark.skipif(
    not DSN, reason="ALEMBIC_DATABASE_URL not set — requires a migrated Postgres"
)

RPC_SIGNATURES = {
    "get_personalized_learning_feed": "public.get_personalized_learning_feed(uuid)",
    "start_lesson": "public.start_lesson(uuid,text)",
    "complete_lesson": "public.complete_lesson(uuid,text)",
    "record_question_attempt": "public.record_question_attempt(uuid,uuid,text)",
    "complete_assessment": "public.complete_assessment(uuid,text)",
}


@pytest.fixture(scope="module")
def db():
    conn = psycopg.connect(DSN, autocommit=True)
    yield conn
    conn.close()


@pytest.fixture()
def two_users(db):
    """Two real core.users rows (via the handle_new_user trigger), and a
    published module so lesson/assessment RPC calls have something to act on."""
    auth_a, auth_b = str(uuid.uuid4()), str(uuid.uuid4())
    # valid_module_code CHECK requires ^[A-Z]+[0-9]+(\.[0-9]+)?$ — letters
    # then digits only, so the suffix must be purely numeric.
    module_code = f"TEST{uuid.uuid4().int % 1_000_000}"

    db.execute("INSERT INTO auth.users (id) VALUES (%s)", (auth_a,))
    db.execute("INSERT INTO auth.users (id) VALUES (%s)", (auth_b,))
    db.execute(
        "INSERT INTO public.education_bank (module_code, level, title, display_order) "
        "VALUES (%s, 'beginner', 'Gate 2 test module', 1)",
        (module_code,),
    )

    user_a = db.execute(
        "SELECT id FROM core.users WHERE auth_id = %s", (auth_a,)
    ).fetchone()[0]
    user_b = db.execute(
        "SELECT id FROM core.users WHERE auth_id = %s", (auth_b,)
    ).fetchone()[0]

    yield {"auth_a": auth_a, "auth_b": auth_b, "user_a": user_a, "user_b": user_b,
           "module_code": module_code}

    db.execute("DELETE FROM public.education_bank WHERE module_code = %s", (module_code,))
    db.execute("DELETE FROM auth.users WHERE id IN (%s, %s)", (auth_a, auth_b))


@contextlib.contextmanager
def acting_as(db, auth_id: str | None, role: str = "authenticated"):
    """Simulate a request from `auth_id` (or an unauthenticated caller when
    None) under `role`, always restoring the shared connection's role/GUC
    afterwards — even if the body raises, and even if SET ROLE itself fails,
    so one broken test can't strand the module-scoped connection in a
    restricted role for every test that runs after it.

    Postgres's SET does not accept protocol-level bind parameters for its
    value, so auth_id (always a uuid.uuid4() this module generated itself,
    never external input) is validated and interpolated as a literal.
    """
    assert role in {"anon", "authenticated"}
    try:
        db.execute(f"SET ROLE {role}")
        if auth_id is None:
            db.execute("RESET request.jwt.claim.sub")
        else:
            uuid.UUID(str(auth_id))
            db.execute(f"SET request.jwt.claim.sub = '{auth_id}'")
        yield
    finally:
        db.execute("RESET request.jwt.claim.sub")
        db.execute("RESET ROLE")


class TestFunctionsExistWithIntendedSignatures:
    def test_all_five_functions_exist(self, db):
        for name, sig in RPC_SIGNATURES.items():
            row = db.execute("SELECT to_regprocedure(%s)", (sig,)).fetchone()
            assert row[0] is not None, f"{sig} does not exist"

    def test_no_insecure_overload_with_different_signature(self, db):
        """Only the exact (p_user_id, ...) compatibility signature should
        exist — no second, parameter-less or differently-shaped overload
        left callable."""
        for name in RPC_SIGNATURES:
            rows = db.execute(
                "SELECT p.oid FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND p.proname = %s",
                (name,),
            ).fetchall()
            assert len(rows) == 1, f"expected exactly one overload of {name}, found {len(rows)}"


class TestPrivileges:
    @pytest.mark.parametrize("name,sig", list(RPC_SIGNATURES.items()))
    def test_public_has_no_execute(self, db, name, sig):
        row = db.execute("SELECT has_function_privilege('public', %s, 'EXECUTE')", (sig,)).fetchone()
        assert row[0] is False, f"PUBLIC retains EXECUTE on {sig}"

    @pytest.mark.parametrize("name,sig", list(RPC_SIGNATURES.items()))
    def test_anon_has_no_execute(self, db, name, sig):
        row = db.execute("SELECT has_function_privilege('anon', %s, 'EXECUTE')", (sig,)).fetchone()
        assert row[0] is False, f"anon retains EXECUTE on {sig}"

    @pytest.mark.parametrize("name,sig", list(RPC_SIGNATURES.items()))
    def test_authenticated_has_execute(self, db, name, sig):
        row = db.execute("SELECT has_function_privilege('authenticated', %s, 'EXECUTE')", (sig,)).fetchone()
        assert row[0] is True, f"authenticated is missing EXECUTE on {sig}"


class TestAnonExecutionImpossible:
    def test_anon_call_rejected_at_privilege_layer(self, db, two_users):
        with acting_as(db, None, role="anon"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                db.execute(
                    "SELECT public.start_lesson(%s, %s)",
                    (two_users["user_a"], two_users["module_code"]),
                )


class TestNullAuthUidRejected:
    def test_missing_auth_uid_rejected(self, db, two_users):
        with acting_as(db, None):
            with pytest.raises(psycopg.Error) as excinfo:
                db.execute(
                    "SELECT public.start_lesson(%s, %s)",
                    (two_users["user_a"], two_users["module_code"]),
                )
            assert excinfo.value.sqlstate == "28000"


class TestCrossUserAcademyAccessImpossible:
    def test_user_a_can_start_lesson_as_self(self, db, two_users):
        with acting_as(db, two_users["auth_a"]):
            db.execute(
                "SELECT public.start_lesson(%s, %s)",
                (two_users["user_a"], two_users["module_code"]),
            )

        row = db.execute(
            "SELECT started_at IS NOT NULL FROM public.user_learning_progress "
            "WHERE user_id = %s AND module_code = %s",
            (two_users["user_a"], two_users["module_code"]),
        ).fetchone()
        assert row is not None and row[0] is True

    def test_user_a_cannot_start_lesson_as_user_b(self, db, two_users):
        with acting_as(db, two_users["auth_a"]):
            with pytest.raises(psycopg.Error) as excinfo:
                db.execute(
                    "SELECT public.start_lesson(%s, %s)",
                    (two_users["user_b"], two_users["module_code"]),
                )
            assert excinfo.value.sqlstate == "42501"

        row = db.execute(
            "SELECT count(*) FROM public.user_learning_progress "
            "WHERE user_id = %s AND module_code = %s",
            (two_users["user_b"], two_users["module_code"]),
        ).fetchone()
        assert row[0] == 0, "cross-user write must not land"

    def test_user_b_cannot_read_user_a_personalized_feed(self, db, two_users):
        with acting_as(db, two_users["auth_b"]):
            with pytest.raises(psycopg.Error) as excinfo:
                db.execute(
                    "SELECT * FROM public.get_personalized_learning_feed(%s)",
                    (two_users["user_a"],),
                )
            assert excinfo.value.sqlstate == "42501"

    def test_user_b_can_read_own_personalized_feed(self, db, two_users):
        with acting_as(db, two_users["auth_b"]):
            db.execute(
                "SELECT * FROM public.get_personalized_learning_feed(%s)",
                (two_users["user_b"],),
            )

    def test_caller_supplied_id_cannot_override_auth_uid_for_question_attempts(self, db, two_users):
        question = db.execute(
            "INSERT INTO public.education_questions "
            "(module_code, question_text, correct_answer) VALUES (%s, %s, %s) RETURNING id",
            (two_users["module_code"], "2+2?", "4"),
        ).fetchone()[0]

        with acting_as(db, two_users["auth_a"]):
            with pytest.raises(psycopg.Error) as excinfo:
                db.execute(
                    "SELECT * FROM public.record_question_attempt(%s, %s, %s)",
                    (two_users["user_b"], question, "4"),
                )
            assert excinfo.value.sqlstate == "42501"

        row = db.execute(
            "SELECT count(*) FROM public.user_question_attempts WHERE user_id = %s",
            (two_users["user_b"],),
        ).fetchone()
        assert row[0] == 0


class TestIdempotencySemanticsPreserved:
    def test_repeated_start_lesson_does_not_duplicate_progress_row(self, db, two_users):
        with acting_as(db, two_users["auth_a"]):
            db.execute(
                "SELECT public.start_lesson(%s, %s)",
                (two_users["user_a"], two_users["module_code"]),
            )
            db.execute(
                "SELECT public.start_lesson(%s, %s)",
                (two_users["user_a"], two_users["module_code"]),
            )

        row = db.execute(
            "SELECT count(*) FROM public.user_learning_progress "
            "WHERE user_id = %s AND module_code = %s",
            (two_users["user_a"], two_users["module_code"]),
        ).fetchone()
        assert row[0] == 1


class TestUpgradeFromPreviousHead:
    """Mirrors test_goal_progress_migration.py's upgrade-from-previous-head
    pattern: stamp back to 0037, upgrade to head, confirm 0038 is current,
    then re-apply to prove idempotency (no duplicate functions/grants)."""

    def _run_alembic(self, *args: str) -> subprocess.CompletedProcess:
        repo_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
            cwd=repo_backend,
            env={**os.environ, "ALEMBIC_DATABASE_URL": _RAW_URL},
            capture_output=True,
            text=True,
            timeout=120,
        )

    def test_upgrade_from_previous_head_and_idempotent_reapply(self, db):
        stamp_back = self._run_alembic("stamp", "0037_goal_progress_reconcile")
        assert stamp_back.returncode == 0, stamp_back.stderr

        first_upgrade = self._run_alembic("upgrade", "head")
        assert first_upgrade.returncode == 0, first_upgrade.stderr

        current = self._run_alembic("current")
        # Head moved forward when 0039_audit_digest_schema_fix was added —
        # this test's job is to prove upgrade-from-0037 lands cleanly, not to
        # pin the exact head, so it tracks the alembic history's own current
        # head (see the identical fix in test_goal_progress_migration.py).
        heads = self._run_alembic("heads")
        assert heads.stdout.split()[0] in current.stdout

        # Idempotency: re-running upgrade head from head must be a safe no-op
        # — no duplicate function overloads, no duplicate/changed grants.
        second_upgrade = self._run_alembic("upgrade", "head")
        assert second_upgrade.returncode == 0, second_upgrade.stderr

        for name in RPC_SIGNATURES:
            rows = db.execute(
                "SELECT p.oid FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND p.proname = %s",
                (name,),
            ).fetchall()
            assert len(rows) == 1, f"reapply duplicated {name}"

        for name, sig in RPC_SIGNATURES.items():
            anon_row = db.execute(
                "SELECT has_function_privilege('anon', %s, 'EXECUTE')", (sig,)
            ).fetchone()
            authenticated_row = db.execute(
                "SELECT has_function_privilege('authenticated', %s, 'EXECUTE')", (sig,)
            ).fetchone()
            assert anon_row[0] is False
            assert authenticated_row[0] is True
