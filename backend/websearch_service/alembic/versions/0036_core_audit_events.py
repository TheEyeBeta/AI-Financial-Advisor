"""Durable append-only audit trail: core.audit_events.

Replaces the production local-file audit log (logs/audit.jsonl on ephemeral
Railway storage) with a database-backed, append-only, hash-chained table.
Only the service role may INSERT; there is no UPDATE/DELETE grant to anyone
for normal operation (retention is handled by export, never by silent
deletion — see docs/security/AUDIT_TRAIL.md).
"""

from __future__ import annotations

from alembic import op

revision = "0036_core_audit_events"
down_revision = "0035_consolidate_manual_fixes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- digest() for the integrity hash chain.
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        CREATE TABLE IF NOT EXISTS core.audit_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            actor_type TEXT NOT NULL,
            actor_pseudonymous_id TEXT,

            action TEXT NOT NULL,

            target_type TEXT,
            target_pseudonymous_id TEXT,

            request_id UUID,
            release_sha TEXT,

            result TEXT NOT NULL,
            reason_code TEXT,

            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

            schema_version SMALLINT NOT NULL DEFAULT 1,
            prev_integrity_hash TEXT,
            integrity_hash TEXT NOT NULL,

            CONSTRAINT audit_events_actor_type_check
                CHECK (actor_type IN ('admin', 'service_role', 'system', 'user')),
            CONSTRAINT audit_events_result_check
                CHECK (result IN ('success', 'failure', 'denied', 'error', 'pending'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
            ON core.audit_events (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_action
            ON core.audit_events (action);
        CREATE INDEX IF NOT EXISTS idx_audit_events_actor
            ON core.audit_events (actor_pseudonymous_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_target
            ON core.audit_events (target_pseudonymous_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
            ON core.audit_events (request_id);

        -- Append-only hash chain: each row's integrity_hash commits to the
        -- previous row's hash plus this row's own content, computed inside
        -- the trigger (not supplied by the application) so a compromised
        -- or buggy app-layer client cannot forge or omit the chain.
        CREATE OR REPLACE FUNCTION core.audit_events_set_integrity()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            prior_hash TEXT;
        BEGIN
            SELECT integrity_hash INTO prior_hash
            FROM core.audit_events
            ORDER BY created_at DESC, id DESC
            LIMIT 1;

            NEW.prev_integrity_hash := prior_hash;
            NEW.integrity_hash := encode(
                digest(
                    COALESCE(prior_hash, '<genesis>') || '|' ||
                    NEW.id::text || '|' ||
                    NEW.created_at::text || '|' ||
                    NEW.actor_type || '|' ||
                    COALESCE(NEW.actor_pseudonymous_id, '') || '|' ||
                    NEW.action || '|' ||
                    COALESCE(NEW.target_type, '') || '|' ||
                    COALESCE(NEW.target_pseudonymous_id, '') || '|' ||
                    NEW.result || '|' ||
                    COALESCE(NEW.reason_code, '') || '|' ||
                    NEW.metadata::text,
                    'sha256'
                ),
                'hex'
            );
            RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS trg_audit_events_set_integrity ON core.audit_events;
        CREATE TRIGGER trg_audit_events_set_integrity
            BEFORE INSERT ON core.audit_events
            FOR EACH ROW
            EXECUTE FUNCTION core.audit_events_set_integrity();

        -- Immutability: reject UPDATE/DELETE outright, independent of grants,
        -- so "no update/delete policy for normal operation" holds even if a
        -- future migration accidentally grants those privileges.
        CREATE OR REPLACE FUNCTION core.audit_events_reject_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'core.audit_events is append-only: % is not permitted (see docs/security/AUDIT_TRAIL.md)',
                TG_OP
                USING ERRCODE = '0LTR0';
        END;
        $$;

        DROP TRIGGER IF EXISTS trg_audit_events_reject_update ON core.audit_events;
        CREATE TRIGGER trg_audit_events_reject_update
            BEFORE UPDATE ON core.audit_events
            FOR EACH ROW
            EXECUTE FUNCTION core.audit_events_reject_mutation();

        DROP TRIGGER IF EXISTS trg_audit_events_reject_delete ON core.audit_events;
        CREATE TRIGGER trg_audit_events_reject_delete
            BEFORE DELETE ON core.audit_events
            FOR EACH ROW
            EXECUTE FUNCTION core.audit_events_reject_mutation();

        ALTER TABLE core.audit_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.audit_events FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Service role inserts audit events" ON core.audit_events;
        CREATE POLICY "Service role inserts audit events"
            ON core.audit_events
            FOR INSERT
            TO service_role
            WITH CHECK (TRUE);

        DROP POLICY IF EXISTS "Service role reads audit events" ON core.audit_events;
        CREATE POLICY "Service role reads audit events"
            ON core.audit_events
            FOR SELECT
            TO service_role
            USING (TRUE);

        -- No policy at all for anon/authenticated: PostgREST default-denies
        -- both roles for every command on this table.

        REVOKE ALL ON core.audit_events FROM PUBLIC;
        REVOKE ALL ON core.audit_events FROM anon;
        REVOKE ALL ON core.audit_events FROM authenticated;
        -- core has a pre-existing default ACL (from an earlier migration)
        -- granting service_role/authenticated full arwd on any new table in
        -- this schema — REVOKE ALL first so the following GRANT is the only
        -- source of truth: SELECT + INSERT, never UPDATE/DELETE.
        REVOKE ALL ON core.audit_events FROM service_role;
        GRANT SELECT, INSERT ON core.audit_events TO service_role;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_audit_events_reject_delete ON core.audit_events;
        DROP TRIGGER IF EXISTS trg_audit_events_reject_update ON core.audit_events;
        DROP TRIGGER IF EXISTS trg_audit_events_set_integrity ON core.audit_events;
        DROP FUNCTION IF EXISTS core.audit_events_reject_mutation();
        DROP FUNCTION IF EXISTS core.audit_events_set_integrity();
        DROP TABLE IF EXISTS core.audit_events;
        """
    )
