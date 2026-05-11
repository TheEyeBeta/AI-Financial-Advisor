"""Ensure ON DELETE CASCADE on all FKs referencing core.users(id).

Without CASCADE the admin delete-user endpoint fails with a FK violation
because child rows (ai.chats, trading.*, academy.*, etc.) block the parent
delete.  Tables created via CREATE TABLE IF NOT EXISTS before CASCADE was
added to the schema file will silently retain the original constraint.

This migration:
1. Dynamically finds every FK that references core.users(id) without
   ON DELETE CASCADE and upgrades it in-place (drop + re-add).
2. Adds admin DELETE RLS policies for ai.chats and ai.chat_messages so the
   admin panel can also delete chats explicitly before removing the user row.
"""

from __future__ import annotations

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Upgrade every FK on core.users(id) that lacks CASCADE ─────────────
    op.execute("""
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN
            SELECT
              c.conname AS constraint_name,
              n.nspname AS table_schema,
              t.relname AS table_name,
              (
                SELECT string_agg(a.attname, ', ' ORDER BY array_position(c.conkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = t.oid
                  AND a.attnum   = ANY(c.conkey)
              ) AS column_names
            FROM pg_constraint c
            JOIN pg_class      t  ON t.oid  = c.conrelid
            JOIN pg_namespace  n  ON n.oid  = t.relnamespace
            JOIN pg_class      rt ON rt.oid = c.confrelid
            JOIN pg_namespace  rn ON rn.oid = rt.relnamespace
            WHERE c.contype     = 'f'
              AND rn.nspname    = 'core'
              AND rt.relname    = 'users'
              AND c.confdeltype != 'c'   -- 'c' = CASCADE; skip already-correct constraints
          LOOP
            EXECUTE format(
              'ALTER TABLE %I.%I DROP CONSTRAINT %I',
              r.table_schema, r.table_name, r.constraint_name
            );
            EXECUTE format(
              'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES core.users(id) ON DELETE CASCADE',
              r.table_schema, r.table_name, r.constraint_name, r.column_names
            );
            RAISE NOTICE 'ON DELETE CASCADE applied: %.% constraint % (%)',
              r.table_schema, r.table_name, r.constraint_name, r.column_names;
          END LOOP;
        END $$;
    """)

    # ── 2. Admin DELETE policies for ai.chats and ai.chat_messages ───────────
    # These allow the admin panel (which uses the authenticated anon client) to
    # explicitly delete another user's chats before removing the user row.
    op.execute("""
        DROP POLICY IF EXISTS "Admins can delete any chat" ON ai.chats;
        CREATE POLICY "Admins can delete any chat"
          ON ai.chats FOR DELETE
          USING (
            EXISTS (
              SELECT 1 FROM core.users
              WHERE auth_id   = auth.uid()
                AND "userType" = 'Admin'
            )
          );
    """)

    op.execute("""
        DROP POLICY IF EXISTS "Admins can delete any chat message" ON ai.chat_messages;
        CREATE POLICY "Admins can delete any chat message"
          ON ai.chat_messages FOR DELETE
          USING (
            EXISTS (
              SELECT 1 FROM core.users
              WHERE auth_id   = auth.uid()
                AND "userType" = 'Admin'
            )
          );
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS \"Admins can delete any chat\" ON ai.chats;")
    op.execute("DROP POLICY IF EXISTS \"Admins can delete any chat message\" ON ai.chat_messages;")
    # The FK upgrades are non-reversible without knowing the prior confdeltype per
    # constraint — leave them in place on downgrade.
