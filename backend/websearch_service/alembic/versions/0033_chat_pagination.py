"""Composite indexes and keyset-paginated chat listing for bounded chat retrieval (#212)."""

from alembic import op

revision = "0033_chat_pagination"
down_revision = "0032_chat_turn_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- Keyset pagination for the conversation list: newest-updated first.
        CREATE INDEX IF NOT EXISTS idx_chats_user_updated_id
            ON ai.chats (user_id, updated_at DESC, id DESC);

        -- Keyset pagination for message history: newest window first,
        -- older pages fetched on demand.
        CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created_id
            ON ai.chat_messages (chat_id, created_at DESC, id DESC);

        -- Ownership-scoped exports/context reads (RLS filters on user_id).
        CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created
            ON ai.chat_messages (user_id, created_at);

        -- One-round-trip conversation list page: chats with exact message
        -- count and last-message preview. SECURITY INVOKER, so ai.chats /
        -- ai.chat_messages RLS confines results to the calling user; the
        -- function never needs (or trusts) a client-supplied user id.
        CREATE OR REPLACE FUNCTION ai.get_chat_page(
            p_limit INTEGER DEFAULT 30,
            p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
            p_cursor_id UUID DEFAULT NULL
        )
        RETURNS TABLE (
            id UUID,
            user_id UUID,
            title TEXT,
            created_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ,
            message_count BIGINT,
            last_message_id UUID,
            last_message_role TEXT,
            last_message_content TEXT,
            last_message_created_at TIMESTAMPTZ
        )
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        SET search_path = ai, pg_temp
        AS $$
            SELECT
                c.id,
                c.user_id,
                c.title,
                c.created_at,
                c.updated_at,
                COALESCE(mc.message_count, 0) AS message_count,
                lm.id AS last_message_id,
                lm.role AS last_message_role,
                lm.content AS last_message_content,
                lm.created_at AS last_message_created_at
            FROM ai.chats c
            LEFT JOIN LATERAL (
                SELECT count(*) AS message_count
                FROM ai.chat_messages m
                WHERE m.chat_id = c.id
            ) mc ON TRUE
            LEFT JOIN LATERAL (
                SELECT m.id, m.role, m.content, m.created_at
                FROM ai.chat_messages m
                WHERE m.chat_id = c.id
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) lm ON TRUE
            WHERE (
                p_cursor_updated_at IS NULL
                OR (c.updated_at, c.id) < (p_cursor_updated_at, p_cursor_id)
            )
            ORDER BY c.updated_at DESC, c.id DESC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 101);
        $$;

        GRANT EXECUTE ON FUNCTION ai.get_chat_page(INTEGER, TIMESTAMPTZ, UUID) TO authenticated;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS ai.get_chat_page(INTEGER, TIMESTAMPTZ, UUID);
        DROP INDEX IF EXISTS ai.idx_chat_messages_user_created;
        DROP INDEX IF EXISTS ai.idx_chat_messages_chat_created_id;
        DROP INDEX IF EXISTS ai.idx_chats_user_updated_id;
        """
    )
