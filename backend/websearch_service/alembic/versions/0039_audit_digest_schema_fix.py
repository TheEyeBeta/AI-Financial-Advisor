"""Fix core.audit_events_set_integrity() pgcrypto schema resolution.

Root cause, confirmed against the live staging catalogue (Gate 2 rerun,
account suspend/delete lifecycle): pgcrypto is installed in schema
`extensions` on the staging/production Supabase project, not `public`.
`core.audit_events_set_integrity()` (0036) sets
`SET search_path = core, public, pg_temp` and calls unqualified `digest(...)`.
That resolves fine on a disposable local Postgres, where
`CREATE EXTENSION IF NOT EXISTS pgcrypto` (no schema qualifier, as written in
0036) installs into whatever schema is first in the *migration role's*
search_path — typically `public` — but it does not resolve at all on
Supabase projects, where pgcrypto ships preinstalled in `extensions` and is
never in `public`. Every `core.audit_events` INSERT on staging therefore
fails with "function digest(...) does not exist", which is why the
suspend/delete lifecycle (both write an audit row via this trigger) failed.

Fix: recreate the trigger function with the `digest()` call schema-qualified
to wherever pgcrypto is actually installed, resolved dynamically via
`pg_extension`/`pg_namespace` rather than hard-coded — so this migration
upgrades cleanly whether pgcrypto lives in `extensions` (Supabase's default)
or `public` (plain local Postgres). The function's `search_path` is
tightened to `core, pg_temp` only; it must not rely on an ambient/widened
search_path to find `digest()` ever again — pg_catalog (encode, to_char) is
always implicitly searched regardless of search_path, so nothing else in the
function body needs a schema in search_path.

Everything else from 0036 is left untouched: the table, its indexes, the
chain-head table, the reject-mutation triggers, RLS policies, and grants are
not recreated here — CREATE OR REPLACE FUNCTION preserves the existing
trigger binding (by function name), so no DROP/CREATE TRIGGER is needed.

Forward AND backward migration are both provided: this is a bug fix, not a
security patch, so (unlike 0038) reverting doesn't reopen a hole — it just
reintroduces the pre-existing schema-resolution bug, which is an acceptable,
ordinary Alembic downgrade.
"""
from __future__ import annotations

import re

from alembic import op

revision = "0039_audit_digest_schema_fix"
down_revision = "0038_academy_rpc_authz"
branch_labels = None
depends_on = None

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _resolve_pgcrypto_schema(conn) -> str:
    row = conn.exec_driver_sql(
        """
        SELECT n.nspname
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgcrypto'
        """
    ).fetchone()
    if row is None:
        raise RuntimeError(
            "pgcrypto extension is not installed on this database — cannot "
            "recreate core.audit_events_set_integrity() (migration "
            "0039_audit_digest_schema_fix). Install pgcrypto first."
        )
    schema = row[0]

    digest_row = conn.exec_driver_sql(
        """
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = %s
          AND p.proname = 'digest'
          AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'text, text'
        """,
        (schema,),
    ).fetchone()
    if digest_row is None:
        raise RuntimeError(
            f"pgcrypto is installed in schema {schema!r} but digest(text, text) "
            "was not found there — cannot recreate "
            "core.audit_events_set_integrity() (migration "
            "0039_audit_digest_schema_fix)."
        )

    if not _IDENTIFIER_RE.match(schema):
        raise RuntimeError(
            f"pgcrypto schema name {schema!r} is not a plain identifier — "
            "refusing to interpolate it into DDL (migration "
            "0039_audit_digest_schema_fix)."
        )
    return schema


def upgrade() -> None:
    conn = op.get_bind()
    pgcrypto_schema = _resolve_pgcrypto_schema(conn)

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION core.audit_events_set_integrity()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        -- Hardened on purpose: only the schemas this function actually needs.
        -- pgcrypto's digest() is called fully schema-qualified below instead
        -- of relying on it being reachable via search_path (see 0039
        -- docstring for why the previous `core, public, pg_temp` path broke
        -- on Supabase, where pgcrypto lives in `extensions`).
        SET search_path = core, pg_temp
        AS $$
        DECLARE
            prior_hash TEXT;
        BEGIN
            SELECT integrity_hash INTO prior_hash
            FROM core.audit_events_chain_head
            WHERE id = TRUE
            FOR UPDATE;

            NEW.prev_integrity_hash := prior_hash;
            NEW.integrity_hash := encode(
                {pgcrypto_schema}.digest(
                    COALESCE(prior_hash, '<genesis>') || '|' ||
                    NEW.id::text || '|' ||
                    -- Fixed UTC serialization: NEW.created_at::text is
                    -- session-timezone dependent, which would make the hash
                    -- unreproducible across connections with different
                    -- TimeZone settings.
                    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                    NEW.actor_type || '|' ||
                    COALESCE(NEW.actor_pseudonymous_id, '') || '|' ||
                    NEW.action || '|' ||
                    COALESCE(NEW.target_type, '') || '|' ||
                    COALESCE(NEW.target_pseudonymous_id, '') || '|' ||
                    COALESCE(NEW.request_id::text, '') || '|' ||
                    COALESCE(NEW.release_sha, '') || '|' ||
                    NEW.result || '|' ||
                    COALESCE(NEW.reason_code, '') || '|' ||
                    NEW.metadata::text || '|' ||
                    NEW.schema_version::text,
                    'sha256'
                ),
                'hex'
            );

            UPDATE core.audit_events_chain_head
            SET integrity_hash = NEW.integrity_hash
            WHERE id = TRUE;

            RETURN NEW;
        END;
        $$;
        """
    )


def downgrade() -> None:
    # Restores the exact 0036 definition (unqualified digest(), search_path
    # `core, public, pg_temp`) — this is an ordinary bug-fix downgrade, not a
    # security reversal, so it's safe to provide.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.audit_events_set_integrity()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = core, public, pg_temp
        AS $$
        DECLARE
            prior_hash TEXT;
        BEGIN
            SELECT integrity_hash INTO prior_hash
            FROM core.audit_events_chain_head
            WHERE id = TRUE
            FOR UPDATE;

            NEW.prev_integrity_hash := prior_hash;
            NEW.integrity_hash := encode(
                digest(
                    COALESCE(prior_hash, '<genesis>') || '|' ||
                    NEW.id::text || '|' ||
                    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
                    NEW.actor_type || '|' ||
                    COALESCE(NEW.actor_pseudonymous_id, '') || '|' ||
                    NEW.action || '|' ||
                    COALESCE(NEW.target_type, '') || '|' ||
                    COALESCE(NEW.target_pseudonymous_id, '') || '|' ||
                    COALESCE(NEW.request_id::text, '') || '|' ||
                    COALESCE(NEW.release_sha, '') || '|' ||
                    NEW.result || '|' ||
                    COALESCE(NEW.reason_code, '') || '|' ||
                    NEW.metadata::text || '|' ||
                    NEW.schema_version::text,
                    'sha256'
                ),
                'hex'
            );

            UPDATE core.audit_events_chain_head
            SET integrity_hash = NEW.integrity_hash
            WHERE id = TRUE;

            RETURN NEW;
        END;
        $$;
        """
    )
