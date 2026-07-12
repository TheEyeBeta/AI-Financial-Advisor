"""Map Google OAuth profile metadata in core.handle_new_user().

Revision 0027 — follows 0026_add_stability_score_columns.

Google sign-in supplies given_name/family_name in raw_user_meta_data rather than
first_name/last_name. This revision updates the trigger to map those fields while
preserving existing names for returning users and never resetting onboarding_complete.
"""

from __future__ import annotations

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

HANDLE_NEW_USER_SQL = """
CREATE OR REPLACE FUNCTION core.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    meta JSONB;
    resolved_first_name TEXT;
    resolved_last_name TEXT;
BEGIN
    meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
    resolved_first_name := COALESCE(meta->>'first_name', meta->>'given_name');
    resolved_last_name := COALESCE(meta->>'last_name', meta->>'family_name');

    INSERT INTO core.users (
        auth_id,
        first_name,
        last_name,
        age,
        email,
        experience_level,
        risk_level,
        is_verified,
        email_verified_at,
        onboarding_complete
    )
    VALUES (
        NEW.id,
        resolved_first_name,
        resolved_last_name,
        COALESCE((meta->>'age')::INTEGER, NULL),
        NEW.email,
        COALESCE((meta->>'experience_level')::core.experience_level_enum, 'beginner'),
        COALESCE((meta->>'risk_level')::core.risk_level_enum, 'mid'),
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        FALSE
    )
    ON CONFLICT (auth_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, core.users.email),
        first_name = COALESCE(core.users.first_name, EXCLUDED.first_name),
        last_name = COALESCE(core.users.last_name, EXCLUDED.last_name),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, core.users.is_verified),
        email_verified_at = COALESCE(NEW.email_confirmed_at, core.users.email_verified_at),
        updated_at = NOW();

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
"""


def upgrade() -> None:
    op.execute(HANDLE_NEW_USER_SQL)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION core.handle_new_user()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO core.users (auth_id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, onboarding_complete)
            VALUES (
                NEW.id,
                COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, NULL),
                COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, NULL),
                COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, NULL),
                NEW.email,
                COALESCE((NEW.raw_user_meta_data->>'experience_level')::core.experience_level_enum, 'beginner'),
                COALESCE((NEW.raw_user_meta_data->>'risk_level')::core.risk_level_enum, 'mid'),
                COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
                NEW.email_confirmed_at,
                FALSE
            )
            ON CONFLICT (auth_id) DO UPDATE SET
                email = COALESCE(EXCLUDED.email, core.users.email),
                is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, core.users.is_verified),
                email_verified_at = COALESCE(NEW.email_confirmed_at, core.users.email_verified_at),
                updated_at = NOW();

            RETURN NEW;
        EXCEPTION WHEN OTHERS THEN
            RAISE LOG 'Error in handle_new_user: %', SQLERRM;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
    """)
