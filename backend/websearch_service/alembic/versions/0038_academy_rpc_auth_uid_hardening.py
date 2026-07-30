"""Academy RPC authorization hardening — Gate 2 AUTH-HIGH-02.

Live security review (Gate 2, staging project edmskamnzcqswxayuqgd) found that
five `SECURITY DEFINER` functions in the `public` schema —
`start_lesson`, `complete_lesson`, `complete_assessment`,
`record_question_attempt`, `get_personalized_learning_feed` — accept a
caller-supplied `p_user_id` with no check that it matches the caller's own
identity, and are executable by the unauthenticated `anon` role (confirmed:
none of them were ever created with an explicit `REVOKE`/`GRANT`, so they
kept Postgres's default `EXECUTE ... TO PUBLIC`, which `anon` inherits). This
was live-verified with a single harmless, non-destructive read call using
only the public anon key and an arbitrary `p_user_id` — it succeeded.

None of these functions were ever brought under Alembic (they originated
from `sql/curriculum_migration.sql`, applied out-of-band — see
`AGENTS.md`'s warning against treating `sql/*.sql` as a migration path). This
migration is the first time they're defined here, which also closes that
drift: after this, `alembic upgrade head` is authoritative for their
definition.

Fix, mirroring the already-safe pattern used by `ai.complete_chat_turn` /
`core.is_current_user_admin` elsewhere in this schema:

* Every function now resolves the caller's `core.users.id` from
  `auth.uid()` internally and rejects execution (`RAISE EXCEPTION`,
  SQLSTATE 28000) when `auth.uid()` is NULL or has no matching
  `core.users` row — i.e. an unauthenticated caller can never reach the
  original body at all.
* `p_user_id` is KEPT in each signature for compatibility (no in-repo
  caller — frontend or backend — was found to depend on the current shape,
  but an out-of-repo caller cannot be ruled out, and dropping the parameter
  is a breaking change this migration doesn't need to make to close the
  hole). Instead, the supplied `p_user_id` is validated to exactly equal
  the `auth.uid()`-resolved id (`RAISE EXCEPTION`, SQLSTATE 42501,
  otherwise) — so the parameter can no longer be used to act as, or read,
  another user. This is the documented "compatibility overload" shape: it
  is not left insecurely callable by `anon` (see privilege changes below),
  and any future caller that no longer needs the parameter should prefer
  calling with `p_user_id = auth.uid()`-resolved id, i.e. its own.
* `SECURITY DEFINER` and `SET search_path TO ''` are both preserved
  unchanged from the original definitions (reviewed: switching to
  `SECURITY INVOKER` would additionally require auditing and possibly
  widening RLS/table grants on `public.education_bank`,
  `public.user_learning_progress`, `public.learning_topics`,
  `public.user_module_assessments`, `public.user_question_attempts`, none
  of which this migration otherwise touches — out of scope for closing
  this specific authorization hole, and DEFINER is safe now that identity
  is enforced inside the function itself).
* `EXECUTE` is explicitly revoked from `PUBLIC` and `anon` on all five
  functions and granted only to `authenticated` — closing the default-grant
  gap that caused the live exposure in the first place.

All business logic (lesson start/completion, assessment scoring, question
attempts, the personalized feed) is otherwise byte-for-byte identical to the
live staging definitions captured during the Gate 2 review — this migration
changes only the identity/authorization boundary and privileges.

Forward-only: see `downgrade()`.
"""
from __future__ import annotations

from alembic import op

revision = "0038_academy_rpc_authz"
down_revision = "0037_goal_progress_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. get_personalized_learning_feed(p_user_id uuid) ───────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION public.get_personalized_learning_feed(p_user_id uuid)
         RETURNS TABLE(module_code text, level core.experience_level_enum, track_or_pathway text, title text, summary text, learning_objective text, estimated_minutes integer, tags text[], display_order integer, progress_percent integer, completed_at timestamp with time zone, started_at timestamp with time zone)
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO ''
        AS $function$
        DECLARE
            v_caller_id UUID;
        BEGIN
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT id INTO v_caller_id FROM core.users WHERE auth_id = auth.uid();
            IF v_caller_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            RETURN QUERY
            SELECT
                eb.module_code, eb.level, eb.track_or_pathway, eb.title, eb.summary,
                eb.learning_objective, eb.estimated_minutes, eb.tags, eb.display_order,
                COALESCE(ulp.progress_percent, 0)::INTEGER as progress_percent,
                ulp.completed_at, ulp.started_at
            FROM public.education_bank eb
            LEFT JOIN core.users u ON u.id = p_user_id
            LEFT JOIN public.user_learning_progress ulp ON ulp.user_id = p_user_id AND ulp.module_code = eb.module_code
            WHERE eb.is_active = TRUE
                AND eb.status = 'published'
                AND (
                    eb.level = COALESCE(u.experience_level, 'beginner')::core.experience_level_enum
                    OR (u.experience_level IS NULL AND eb.level = 'beginner')
                )
            ORDER BY
                CASE WHEN ulp.completed_at IS NULL THEN 0 ELSE 1 END,
                eb.display_order ASC,
                ulp.last_accessed_at DESC NULLS LAST;
        END;
        $function$;
    """)

    # ── 2. start_lesson(p_user_id uuid, p_module_code text) ─────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION public.start_lesson(p_user_id uuid, p_module_code text)
         RETURNS void
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO ''
        AS $function$
        DECLARE
            v_caller_id UUID;
        BEGIN
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT id INTO v_caller_id FROM core.users WHERE auth_id = auth.uid();
            IF v_caller_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            INSERT INTO public.user_learning_progress (user_id, module_code, started_at, last_accessed_at)
            VALUES (p_user_id, p_module_code, NOW(), NOW())
            ON CONFLICT (user_id, module_code)
            DO UPDATE SET
                last_accessed_at = NOW(),
                started_at = COALESCE(user_learning_progress.started_at, NOW());
        END;
        $function$;
    """)

    # ── 3. complete_lesson(p_user_id uuid, p_module_code text) ──────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION public.complete_lesson(p_user_id uuid, p_module_code text)
         RETURNS void
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO ''
        AS $function$
        DECLARE
            v_caller_id UUID;
        BEGIN
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT id INTO v_caller_id FROM core.users WHERE auth_id = auth.uid();
            IF v_caller_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            UPDATE public.user_learning_progress
            SET completed_at = NOW(), progress_percent = 100, updated_at = NOW()
            WHERE user_id = p_user_id AND module_code = p_module_code;

            UPDATE public.learning_topics
            SET completed = TRUE, progress = 100, updated_at = NOW()
            WHERE user_id = p_user_id
            AND topic_name = (SELECT title FROM public.education_bank WHERE module_code = p_module_code);
        END;
        $function$;
    """)

    # ── 4. record_question_attempt(p_user_id, p_question_id, p_user_answer) ─
    op.execute("""
        CREATE OR REPLACE FUNCTION public.record_question_attempt(
            p_user_id uuid, p_question_id uuid, p_user_answer text
        )
         RETURNS TABLE(is_correct boolean, explanation text, points_earned integer)
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO ''
        AS $function$
        DECLARE
            v_caller_id UUID;
            v_correct_answer TEXT;
            v_explanation TEXT;
            v_is_correct BOOLEAN;
            v_points INTEGER;
            v_module_code TEXT;
        BEGIN
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT id INTO v_caller_id FROM core.users WHERE auth_id = auth.uid();
            IF v_caller_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            SELECT correct_answer, explanation, points, module_code
            INTO v_correct_answer, v_explanation, v_points, v_module_code
            FROM public.education_questions
            WHERE id = p_question_id;

            v_is_correct := (p_user_answer = v_correct_answer);

            INSERT INTO public.user_question_attempts (
                user_id, question_id, module_code, user_answer, is_correct, points_earned
            )
            VALUES (
                p_user_id, p_question_id, v_module_code, p_user_answer, v_is_correct,
                CASE WHEN v_is_correct THEN v_points ELSE 0 END
            );

            RETURN QUERY SELECT v_is_correct, v_explanation,
                CASE WHEN v_is_correct THEN v_points ELSE 0 END;
        END;
        $function$;
    """)

    # ── 5. complete_assessment(p_user_id uuid, p_module_code text) ──────────
    op.execute("""
        CREATE OR REPLACE FUNCTION public.complete_assessment(p_user_id uuid, p_module_code text)
         RETURNS TABLE(passed boolean, score_percent integer, total_questions integer, correct_answers integer)
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO ''
        AS $function$
        DECLARE
            v_caller_id UUID;
            v_level core.experience_level_enum;
            v_threshold INTEGER;
            v_total INTEGER;
            v_correct INTEGER;
            v_score INTEGER;
            v_passed BOOLEAN;
        BEGIN
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT id INTO v_caller_id FROM core.users WHERE auth_id = auth.uid();
            IF v_caller_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            SELECT level INTO v_level
            FROM public.education_bank
            WHERE module_code = p_module_code;

            v_threshold := CASE v_level
                WHEN 'beginner' THEN 60
                WHEN 'intermediate' THEN 70
                WHEN 'advanced' THEN 80
                ELSE 60
            END;

            SELECT COUNT(*) INTO v_total
            FROM public.education_questions
            WHERE module_code = p_module_code AND is_active = TRUE;

            SELECT COUNT(DISTINCT question_id) INTO v_correct
            FROM (
                SELECT DISTINCT ON (question_id) question_id, is_correct
                FROM public.user_question_attempts
                WHERE user_id = p_user_id
                AND module_code = p_module_code
                ORDER BY question_id, attempted_at DESC
            ) latest_attempts
            WHERE is_correct = TRUE;

            v_score := ROUND((v_correct::NUMERIC / NULLIF(v_total, 0) * 100)::NUMERIC);
            v_passed := (v_score >= v_threshold);

            INSERT INTO public.user_module_assessments (
                user_id, module_code, total_questions, correct_answers,
                score_percent, passed, threshold_required
            )
            VALUES (p_user_id, p_module_code, v_total, v_correct, v_score, v_passed, v_threshold);

            IF v_passed THEN
                PERFORM public.complete_lesson(p_user_id, p_module_code);
            END IF;

            RETURN QUERY SELECT v_passed, v_score, v_total, v_correct;
        END;
        $function$;
    """)

    # ── 6. Privileges: close the default-PUBLIC-EXECUTE gap ─────────────────
    op.execute("""
        REVOKE EXECUTE ON FUNCTION public.get_personalized_learning_feed(uuid) FROM PUBLIC, anon;
        REVOKE EXECUTE ON FUNCTION public.start_lesson(uuid, text) FROM PUBLIC, anon;
        REVOKE EXECUTE ON FUNCTION public.complete_lesson(uuid, text) FROM PUBLIC, anon;
        REVOKE EXECUTE ON FUNCTION public.record_question_attempt(uuid, uuid, text) FROM PUBLIC, anon;
        REVOKE EXECUTE ON FUNCTION public.complete_assessment(uuid, text) FROM PUBLIC, anon;

        GRANT EXECUTE ON FUNCTION public.get_personalized_learning_feed(uuid) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.start_lesson(uuid, text) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.complete_lesson(uuid, text) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.record_question_attempt(uuid, uuid, text) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.complete_assessment(uuid, text) TO authenticated;
    """)


def downgrade() -> None:
    # Forward-only: reverting would mean re-publishing an unauthenticated
    # broken-object-level-authorization hole (Gate 2 AUTH-HIGH-02) on live
    # user progress data. There is no safe downgrade for a security fix like
    # this one — if the compatibility (p_user_id) parameter ever needs to be
    # dropped entirely, that should be a new forward migration, not a
    # reversal of this one.
    pass
