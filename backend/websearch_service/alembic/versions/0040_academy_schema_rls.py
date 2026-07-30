"""Enable RLS on academy.* schema — closes cross-tenant read/write hole.

Architecture audit (rip-apart pass) found that all 16 `academy.*` tables
(`academy/0001_runtime_extensions.sql`, lines 171-334) were created with
`ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ... TO
authenticated` (same file, line 508/527-528) but RLS was never enabled on a
single one of them — unlike every other user-scoped schema created in the
same file (`meridian.*`, lines 445-495) and unlike `ai.chat_turn_requests`
(0030), which both pair every user-owned table with
`ENABLE ROW LEVEL SECURITY` plus an owner-scoped policy.

`src/services/academy-api.ts` calls `supabase.schema('academy')` directly
from the browser (anon-key + user JWT, RLS-only defense) and trusts a
caller-supplied `user_id` argument for reads/writes (e.g.
`getUserLessonProgress(user_id)`, `deleteQuizAttempt(attempt_id)` with no
owner check). With RLS off and a blanket authenticated grant, any logged-in
user can read or overwrite *any other user's* row in every academy table —
including reading `quiz_options.is_correct` for arbitrary questions and
deleting/forging other users' quiz attempts, lesson progress, tier
enrollments, and chat history.

Fix, mirroring the already-correct `meridian.*` / `ai.chat_turn_requests`
pattern:

* User-owned tables (`profiles`, `quiz_attempts`, `quiz_answers`,
  `user_lesson_progress`, `user_tier_enrollments`, `chat_sessions`,
  `chat_messages`) get `ENABLE ROW LEVEL SECURITY` plus a `FOR ALL` owner
  policy resolved via `core.users.auth_id = auth.uid()` (academy tables
  reference `core.users(id)`, not `auth.users(id)` directly, so this must
  use the same subquery form as 0030, not `user_id = auth.uid()`).
  `quiz_answers` and `chat_messages` have no `user_id` column of their own;
  ownership is derived through `attempt_id` / `session_id`.
* Content tables (`tiers`, `lessons`, `lesson_sections`, `lesson_blocks`,
  `prompt_templates`, `lesson_prompt_links`, `quizzes`, `quiz_questions`,
  `quiz_options`) get `ENABLE ROW LEVEL SECURITY` plus a `SELECT`-only
  policy for `authenticated`. No in-repo code path (frontend or backend)
  ever inserts/updates/deletes these tables — confirmed by repo-wide
  search — so leaving INSERT/UPDATE/DELETE with no matching policy makes
  those operations deny-by-default (standard Postgres RLS behavior),
  closing the "any authenticated user can vandalize the curriculum" gap
  without touching the read path any current feature relies on.

Known residual gap, intentionally NOT fixed here (flagged for a human
product decision, see final audit report): `quiz_options.is_correct` is
still readable pre-attempt by a *legitimate* SELECT under the new policy,
because `AcademyQuiz.tsx` fetches all options (including `is_correct`) up
front and grades client-side (`selectedOption?.is_correct`,
`AcademyQuiz.tsx:199,396`). RLS can only gate rows, not columns, and this
codebase's academy quiz feature has no server-side grading RPC (unlike the
sibling `public.education_questions` system hardened by 0038, whose
`record_question_attempt` RPC never returns `correct_answer` to the
client). Revoking column access here would silently break every academy
quiz in production; moving grading server-side is real feature work
requiring a product decision on UX (e.g. whether immediate per-question
feedback is still shown), not a mechanical RLS fix.

Forward-only: reverting would re-disable RLS and reopen a live
cross-tenant read/write hole on production user data, same reasoning as
0038.
"""
from __future__ import annotations

from alembic import op

revision = "0040_academy_schema_rls"
down_revision = "0039_audit_digest_schema_fix"
branch_labels = None
depends_on = None

_OWNER_SUBQUERY = "(SELECT id FROM core.users WHERE auth_id = auth.uid())"

_CONTENT_TABLES = (
    "tiers",
    "lessons",
    "lesson_sections",
    "lesson_blocks",
    "prompt_templates",
    "lesson_prompt_links",
    "quizzes",
    "quiz_questions",
    "quiz_options",
)


def upgrade() -> None:
    # ── Content tables: RLS + SELECT-only for authenticated ─────────────────
    for table in _CONTENT_TABLES:
        policy = f"Authenticated users can read academy {table}"
        op.execute(f"ALTER TABLE academy.{table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f'DROP POLICY IF EXISTS "{policy}" ON academy.{table};')
        op.execute(
            f"""
            CREATE POLICY "{policy}"
            ON academy.{table} FOR SELECT
            TO authenticated
            USING (true);
            """
        )

    # ── academy.profiles: id IS the owning user's core.users.id ─────────────
    op.execute("ALTER TABLE academy.profiles ENABLE ROW LEVEL SECURITY;")
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own academy profile" '
        "ON academy.profiles;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own academy profile"
        ON academy.profiles FOR ALL
        USING (id IN {_OWNER_SUBQUERY})
        WITH CHECK (id IN {_OWNER_SUBQUERY});
        """
    )

    # ── academy.quiz_attempts: owned via user_id ─────────────────────────────
    op.execute("ALTER TABLE academy.quiz_attempts ENABLE ROW LEVEL SECURITY;")
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own quiz attempts" '
        "ON academy.quiz_attempts;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own quiz attempts"
        ON academy.quiz_attempts FOR ALL
        USING (user_id IN {_OWNER_SUBQUERY})
        WITH CHECK (user_id IN {_OWNER_SUBQUERY});
        """
    )

    # ── academy.quiz_answers: owned via parent quiz_attempts.user_id ────────
    op.execute("ALTER TABLE academy.quiz_answers ENABLE ROW LEVEL SECURITY;")
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own quiz answers" '
        "ON academy.quiz_answers;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own quiz answers"
        ON academy.quiz_answers FOR ALL
        USING (
            attempt_id IN (
                SELECT id FROM academy.quiz_attempts
                WHERE user_id IN {_OWNER_SUBQUERY}
            )
        )
        WITH CHECK (
            attempt_id IN (
                SELECT id FROM academy.quiz_attempts
                WHERE user_id IN {_OWNER_SUBQUERY}
            )
        );
        """
    )

    # ── academy.user_lesson_progress: owned via user_id ──────────────────────
    op.execute(
        "ALTER TABLE academy.user_lesson_progress ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own lesson progress" '
        "ON academy.user_lesson_progress;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own lesson progress"
        ON academy.user_lesson_progress FOR ALL
        USING (user_id IN {_OWNER_SUBQUERY})
        WITH CHECK (user_id IN {_OWNER_SUBQUERY});
        """
    )

    # ── academy.user_tier_enrollments: owned via user_id ─────────────────────
    op.execute(
        "ALTER TABLE academy.user_tier_enrollments ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own tier enrollments" '
        "ON academy.user_tier_enrollments;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own tier enrollments"
        ON academy.user_tier_enrollments FOR ALL
        USING (user_id IN {_OWNER_SUBQUERY})
        WITH CHECK (user_id IN {_OWNER_SUBQUERY});
        """
    )

    # ── academy.chat_sessions: owned via user_id ─────────────────────────────
    op.execute("ALTER TABLE academy.chat_sessions ENABLE ROW LEVEL SECURITY;")
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own academy chat sessions" '
        "ON academy.chat_sessions;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own academy chat sessions"
        ON academy.chat_sessions FOR ALL
        USING (user_id IN {_OWNER_SUBQUERY})
        WITH CHECK (user_id IN {_OWNER_SUBQUERY});
        """
    )

    # ── academy.chat_messages: owned via parent chat_sessions.user_id ───────
    op.execute("ALTER TABLE academy.chat_messages ENABLE ROW LEVEL SECURITY;")
    op.execute(
        'DROP POLICY IF EXISTS "Users can manage own academy chat messages" '
        "ON academy.chat_messages;"
    )
    op.execute(
        f"""
        CREATE POLICY "Users can manage own academy chat messages"
        ON academy.chat_messages FOR ALL
        USING (
            session_id IN (
                SELECT id FROM academy.chat_sessions
                WHERE user_id IN {_OWNER_SUBQUERY}
            )
        )
        WITH CHECK (
            session_id IN (
                SELECT id FROM academy.chat_sessions
                WHERE user_id IN {_OWNER_SUBQUERY}
            )
        );
        """
    )


def downgrade() -> None:
    # Forward-only: disabling RLS here would reopen a live cross-tenant
    # read/write hole on production user data (same reasoning as 0038).
    pass
