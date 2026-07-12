"""User account lifecycle columns and audit table."""

from alembic import op

revision = "0029_user_account_lifecycle"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.users
            ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

        ALTER TABLE core.users
            DROP CONSTRAINT IF EXISTS users_account_status_check;
        ALTER TABLE core.users
            ADD CONSTRAINT users_account_status_check
            CHECK (account_status IN ('active', 'suspended', 'pending_deletion', 'deleted'));

        CREATE TABLE IF NOT EXISTS core.user_account_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id UUID NOT NULL,
            actor TEXT NOT NULL,
            target_auth_id UUID NOT NULL,
            action TEXT NOT NULL,
            reason TEXT,
            result TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.user_account_audit;
        ALTER TABLE core.users DROP CONSTRAINT IF EXISTS users_account_status_check;
        ALTER TABLE core.users
            DROP COLUMN IF EXISTS suspension_reason,
            DROP COLUMN IF EXISTS suspended_at,
            DROP COLUMN IF EXISTS account_status;
        """
    )
