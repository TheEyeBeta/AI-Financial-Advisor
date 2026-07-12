"""Orphan auth-user purge audit tables."""

from __future__ import annotations

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS core.orphan_purge_snapshots (
            id UUID PRIMARY KEY,
            confirmation_token_hash TEXT NOT NULL,
            candidate_auth_ids JSONB NOT NULL,
            candidates JSONB NOT NULL,
            total_auth_users INTEGER NOT NULL,
            actor TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            CONSTRAINT orphan_purge_snapshots_status_check
                CHECK (status IN ('pending', 'executed', 'expired', 'aborted'))
        );

        CREATE TABLE IF NOT EXISTS core.orphan_purge_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_id UUID REFERENCES core.orphan_purge_snapshots(id),
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            outcome TEXT NOT NULL,
            candidate_count INTEGER NOT NULL DEFAULT 0,
            deleted_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            details JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS core.orphan_purge_audit;
        DROP TABLE IF EXISTS core.orphan_purge_snapshots;
    """)
