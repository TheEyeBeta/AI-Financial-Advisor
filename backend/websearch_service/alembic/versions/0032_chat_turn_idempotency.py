"""Idempotency key, single-active-turn guard, and atomic completion for chat turns."""

from alembic import op

revision = "0032_chat_turn_idempotency"
down_revision = "0031_admin_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai.chat_turn_requests
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

        UPDATE ai.chat_turn_requests
            SET idempotency_key = gen_random_uuid()::text
            WHERE idempotency_key IS NULL;

        ALTER TABLE ai.chat_turn_requests
            ALTER COLUMN idempotency_key SET NOT NULL;

        -- A retried/duplicate submission with the same client-generated key
        -- returns the existing turn for that chat instead of erroring.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turn_requests_chat_idempotency
            ON ai.chat_turn_requests(chat_id, idempotency_key);

        -- Only one in-flight generation per conversation at a time.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turn_requests_one_active
            ON ai.chat_turn_requests(chat_id)
            WHERE status IN ('pending', 'processing');

        GRANT SELECT, INSERT, UPDATE ON ai.chat_turn_requests TO authenticated;

        -- Atomically persist the assistant message and complete the turn so a
        -- crash/refresh between the two writes can never leave a completed
        -- turn with no assistant message (or vice versa).
        CREATE OR REPLACE FUNCTION ai.complete_chat_turn(
            p_turn_id UUID,
            p_content TEXT
        )
        RETURNS ai.chat_messages
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ai, core, pg_temp
        AS $$
        DECLARE
            turn ai.chat_turn_requests%ROWTYPE;
            caller_user_id UUID;
            new_message ai.chat_messages%ROWTYPE;
        BEGIN
            SELECT id INTO caller_user_id
            FROM core.users
            WHERE auth_id = auth.uid();

            IF caller_user_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            SELECT * INTO turn
            FROM ai.chat_turn_requests
            WHERE id = p_turn_id
            FOR UPDATE;

            IF turn.id IS NULL THEN
                RAISE EXCEPTION 'Chat turn not found' USING ERRCODE = 'P0002';
            END IF;

            IF turn.user_id <> caller_user_id THEN
                RAISE EXCEPTION 'Not authorized for this chat turn' USING ERRCODE = '42501';
            END IF;

            IF turn.status NOT IN ('pending', 'processing') THEN
                RAISE EXCEPTION 'Chat turn is not active (status=%)', turn.status USING ERRCODE = '55000';
            END IF;

            INSERT INTO ai.chat_messages (user_id, chat_id, role, content)
            VALUES (caller_user_id, turn.chat_id, 'assistant', p_content)
            RETURNING * INTO new_message;

            UPDATE ai.chat_turn_requests
            SET status = 'completed',
                assistant_message_id = new_message.id,
                updated_at = NOW(),
                completed_at = NOW()
            WHERE id = p_turn_id;

            UPDATE ai.chats
            SET updated_at = NOW()
            WHERE id = turn.chat_id;

            RETURN new_message;
        END;
        $$;

        GRANT EXECUTE ON FUNCTION ai.complete_chat_turn(UUID, TEXT) TO authenticated;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS ai.complete_chat_turn(UUID, TEXT);
        DROP INDEX IF EXISTS ai.idx_chat_turn_requests_one_active;
        DROP INDEX IF EXISTS ai.idx_chat_turn_requests_chat_idempotency;
        ALTER TABLE ai.chat_turn_requests DROP COLUMN IF EXISTS idempotency_key;
        """
    )
