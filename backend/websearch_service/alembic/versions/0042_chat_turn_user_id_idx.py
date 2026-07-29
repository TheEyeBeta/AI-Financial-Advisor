"""Add missing index on ai.chat_turn_requests.user_id.

Architecture audit (rip-apart pass): `ai.chat_turn_requests`
(0030_chat_turn_requests) has three RLS policies that filter
`WHERE user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid())`
(0030, lines 39-53), but only `chat_id` and `(status, updated_at)` are
indexed — no index on `user_id`. Current app code scopes queries by
`chat_id`, so this table isn't hot today, but any future "all my
in-flight/failed turns across chats" query, or the RLS subquery itself
when scanning without a `chat_id` predicate, will seq-scan this table as
it grows. Cheap, low-risk fix.
"""
from __future__ import annotations

from alembic import op

revision = "0042_chat_turn_user_id_idx"
down_revision = "0041_education_col_privileges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_chat_turn_requests_user_id
            ON ai.chat_turn_requests(user_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ai.idx_chat_turn_requests_user_id;")
