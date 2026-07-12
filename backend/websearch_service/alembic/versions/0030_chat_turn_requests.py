"""Chat turn request lifecycle for non-destructive conversation reads."""

from alembic import op

revision = "0030_chat_turn_requests"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai.chat_turn_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            chat_id UUID NOT NULL REFERENCES ai.chats(id) ON DELETE CASCADE,
            user_message_id UUID NOT NULL REFERENCES ai.chat_messages(id) ON DELETE CASCADE,
            assistant_message_id UUID REFERENCES ai.chat_messages(id) ON DELETE SET NULL,
            correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
            retry_of_request_id UUID REFERENCES ai.chat_turn_requests(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            failure_code TEXT,
            failure_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            CONSTRAINT chat_turn_requests_status_check
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
        );

        CREATE INDEX IF NOT EXISTS idx_chat_turn_requests_chat_id
            ON ai.chat_turn_requests(chat_id);
        CREATE INDEX IF NOT EXISTS idx_chat_turn_requests_status_updated
            ON ai.chat_turn_requests(status, updated_at);

        ALTER TABLE ai.chat_turn_requests ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Users can view own chat turn requests" ON ai.chat_turn_requests;
        CREATE POLICY "Users can view own chat turn requests"
            ON ai.chat_turn_requests FOR SELECT
            USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

        DROP POLICY IF EXISTS "Users can insert own chat turn requests" ON ai.chat_turn_requests;
        CREATE POLICY "Users can insert own chat turn requests"
            ON ai.chat_turn_requests FOR INSERT
            WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

        DROP POLICY IF EXISTS "Users can update own chat turn requests" ON ai.chat_turn_requests;
        CREATE POLICY "Users can update own chat turn requests"
            ON ai.chat_turn_requests FOR UPDATE
            USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
            WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

        GRANT SELECT, INSERT, UPDATE ON ai.chat_turn_requests TO authenticated;
        GRANT ALL ON ai.chat_turn_requests TO service_role;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS ai.chat_turn_requests;
        """
    )
