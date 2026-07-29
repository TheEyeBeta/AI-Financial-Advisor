"""Revoke direct read access to public.education_questions.correct_answer.

Architecture audit (rip-apart pass) found that 0038 correctly hardened the
*RPC* path for the `public.education_*` curriculum system (identity checks
inside `record_question_attempt`/`complete_assessment`, which never return
`correct_answer` to the caller — see `0038_academy_rpc_auth_uid_hardening`),
but never touched the *table-level* grants on
`public.education_questions` itself.

`sql/curriculum_migration.sql:390-405` gives every `authenticated` user a
row-level SELECT policy on `education_questions` scoped by experience
level — but RLS restricts rows, not columns. `correct_answer` (a plain TEXT
column, `curriculum_migration.sql:67`) is fully selectable by any
authenticated user whose level matches a question's module, via a direct
PostgREST `GET /education_questions?select=*` — completely bypassing the
RPC-layer answer-checking hardening 0038 did. `explanation` (line 68) is
excluded from direct grants too, since it typically restates or implies
the answer and is already returned by `record_question_attempt`'s RPC
response after a real attempt is recorded.

No in-repo code (frontend or backend) queries `public.education_questions`
directly today — confirmed by repo-wide search — so this table is reached
only through the already-hardened RPCs. Column-level REVOKE/GRANT is safe:
`record_question_attempt`/`complete_assessment` are `SECURITY DEFINER`
functions that read `correct_answer` as their owner, not as the invoking
`authenticated` role, so the internal RPC lookups are unaffected by this
change (verified against the 0038 function bodies, which run as definer).

If a future curriculum-admin UI needs to edit `correct_answer` directly, it
should do so via the backend with the service-role key, not by widening
this grant back out to `authenticated`.

Forward-only: reverting would re-expose the answer key to any authenticated
user, same reasoning as 0038/0040.
"""
from __future__ import annotations

from alembic import op

revision = "0041_education_col_privileges"
down_revision = "0040_academy_schema_rls"
branch_labels = None
depends_on = None

_READABLE_COLUMNS = (
    "id",
    "module_code",
    "question_text",
    "question_type",
    "options",
    "points",
    "display_order",
    "is_active",
    "created_at",
    "updated_at",
)


def upgrade() -> None:
    op.execute("REVOKE SELECT ON public.education_questions FROM authenticated;")
    op.execute(
        f"""
        GRANT SELECT ({", ".join(_READABLE_COLUMNS)})
        ON public.education_questions TO authenticated;
        """
    )


def downgrade() -> None:
    # Forward-only: restoring full-column SELECT would re-expose
    # correct_answer/explanation to any authenticated user directly via
    # PostgREST, defeating the 0038 RPC hardening (same reasoning as 0038).
    pass
