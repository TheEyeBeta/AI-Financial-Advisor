-- Runtime tables that are used by the application but are not present in
-- sql/schema.sql. This keeps the Alembic baseline aligned with the deployed
-- six-schema application, while the legacy raw SQL files remain available for
-- reference in /sql.

-- ---------------------------------------------------------------------------
-- Legacy compatibility tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.learning_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    topic_name TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, topic_name)
);

ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own learning topics" ON public.learning_topics;
CREATE POLICY "Users can view own learning topics"
ON public.learning_topics FOR SELECT
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own learning topics" ON public.learning_topics;
CREATE POLICY "Users can insert own learning topics"
ON public.learning_topics FOR INSERT
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own learning topics" ON public.learning_topics;
CREATE POLICY "Users can update own learning topics"
ON public.learning_topics FOR UPDATE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own learning topics" ON public.learning_topics;
CREATE POLICY "Users can delete own learning topics"
ON public.learning_topics FOR DELETE
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- core schema extensions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    age_range TEXT,
    income_range TEXT,
    monthly_expenses NUMERIC,
    total_debt NUMERIC,
    dependants INTEGER DEFAULT 0,
    risk_profile TEXT,
    knowledge_tier INTEGER DEFAULT 1,
    investment_horizon TEXT,
    emergency_fund_months NUMERIC,
    monthly_investable NUMERIC
);

ALTER TABLE core.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own core profile" ON core.user_profiles;
CREATE POLICY "Users can view own core profile"
ON core.user_profiles FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own core profile" ON core.user_profiles;
CREATE POLICY "Users can insert own core profile"
ON core.user_profiles FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own core profile" ON core.user_profiles;
CREATE POLICY "Users can update own core profile"
ON core.user_profiles FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_core_user_profiles_updated_at ON core.user_profiles;
CREATE TRIGGER update_core_user_profiles_updated_at
    BEFORE UPDATE ON core.user_profiles
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- ai schema extensions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.iris_context_cache (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    profile_summary JSONB,
    active_goals JSONB,
    active_alerts JSONB,
    plan_status JSONB,
    knowledge_tier INTEGER,
    financial_plan JSONB,
    goal_progress_summary JSONB,
    intelligence_digest JSONB,
    life_events JSONB,
    user_positions JSONB,
    trading_positions JSONB,
    closed_trades JSONB,
    academy_progress JSONB,
    recent_chat_summaries JSONB,
    user_insights JSONB
);

-- Migration: add columns introduced after initial deployment.
-- Safe to re-run — IF NOT EXISTS prevents errors on fresh installs.
DO $$
BEGIN
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS financial_plan JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS goal_progress_summary JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS intelligence_digest JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS life_events JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS user_positions JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS trading_positions JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS closed_trades JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS academy_progress JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS recent_chat_summaries JSONB;
    ALTER TABLE ai.iris_context_cache ADD COLUMN IF NOT EXISTS user_insights JSONB;
END $$;

ALTER TABLE ai.iris_context_cache ENABLE ROW LEVEL SECURITY;

-- Backend/service role owns this table; no browser write policies.

-- ---------------------------------------------------------------------------
-- trading schema extensions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trading.paper_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    buy_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    buy_quantity INTEGER NOT NULL CHECK (buy_quantity > 0),
    buy_price NUMERIC NOT NULL CHECK (buy_price > 0),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    tags TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trading.paper_trade_closes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    buy_trade_id UUID NOT NULL REFERENCES trading.paper_trades(id) ON DELETE CASCADE,
    close_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    close_quantity INTEGER NOT NULL CHECK (close_quantity > 0),
    close_price NUMERIC NOT NULL CHECK (close_price > 0),
    reason TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_paper_trades_updated_at ON trading.paper_trades;
CREATE TRIGGER update_paper_trades_updated_at
    BEFORE UPDATE ON trading.paper_trades
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- academy schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academy.profiles (
    id UUID PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
    display_name TEXT,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    order_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id UUID REFERENCES academy.tiers(id) ON DELETE SET NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    short_summary TEXT,
    order_index INTEGER NOT NULL,
    estimated_minutes INTEGER,
    prerequisite_ids UUID[],
    is_published BOOLEAN DEFAULT TRUE,
    seo_description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.lesson_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID REFERENCES academy.lessons(id) ON DELETE CASCADE,
    title TEXT,
    order_index INTEGER NOT NULL,
    anchor TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.lesson_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID REFERENCES academy.lessons(id) ON DELETE CASCADE,
    section_id UUID REFERENCES academy.lesson_sections(id) ON DELETE SET NULL,
    block_type TEXT,
    content_md TEXT,
    data JSONB,
    order_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    role TEXT,
    template_text TEXT NOT NULL,
    description TEXT,
    output_format JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.lesson_prompt_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID REFERENCES academy.lessons(id) ON DELETE CASCADE,
    prompt_template_id UUID REFERENCES academy.prompt_templates(id) ON DELETE CASCADE,
    use_case TEXT,
    config JSONB
);

CREATE TABLE IF NOT EXISTS academy.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID UNIQUE REFERENCES academy.lessons(id) ON DELETE CASCADE,
    title TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    pass_score INTEGER,
    max_attempts INTEGER,
    shuffle_questions BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID REFERENCES academy.quizzes(id) ON DELETE CASCADE,
    question_type TEXT,
    prompt_md TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    points INTEGER DEFAULT 1,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy.quiz_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES academy.quiz_questions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    feedback_md TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS academy.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID REFERENCES academy.quizzes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES core.users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    score INTEGER,
    passed BOOLEAN,
    attempt_number INTEGER DEFAULT 1,
    ai_feedback_md TEXT,
    raw_result JSONB
);

CREATE TABLE IF NOT EXISTS academy.quiz_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES academy.quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID REFERENCES academy.quiz_questions(id) ON DELETE CASCADE,
    selected_option_ids UUID[],
    free_text_answer TEXT,
    is_correct BOOLEAN,
    score_awarded INTEGER,
    ai_rationale_md TEXT
);

CREATE TABLE IF NOT EXISTS academy.user_lesson_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES core.users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES academy.lessons(id) ON DELETE CASCADE,
    status TEXT,
    last_opened_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    best_quiz_score INTEGER,
    last_quiz_attempt_id UUID REFERENCES academy.quiz_attempts(id) ON DELETE SET NULL,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS academy.user_tier_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES core.users(id) ON DELETE CASCADE,
    tier_id UUID REFERENCES academy.tiers(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    unlocked_via TEXT,
    UNIQUE (user_id, tier_id)
);

CREATE TABLE IF NOT EXISTS academy.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES core.users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES academy.lessons(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS academy.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES academy.chat_sessions(id) ON DELETE CASCADE,
    sender TEXT,
    role TEXT,
    content_md TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_academy_profiles_updated_at ON academy.profiles;
CREATE TRIGGER update_academy_profiles_updated_at
    BEFORE UPDATE ON academy.profiles
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS update_academy_lessons_updated_at ON academy.lessons;
CREATE TRIGGER update_academy_lessons_updated_at
    BEFORE UPDATE ON academy.lessons
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS update_academy_quizzes_updated_at ON academy.quizzes;
CREATE TRIGGER update_academy_quizzes_updated_at
    BEFORE UPDATE ON academy.quizzes
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

INSERT INTO academy.tiers (id, name, slug, description, order_index)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Beginner', 'beginner', 'Foundational finance lessons.', 1),
    ('00000000-0000-0000-0000-000000000002', 'Intermediate', 'intermediate', 'Applied investing and portfolio lessons.', 2),
    ('00000000-0000-0000-0000-000000000003', 'Advanced', 'advanced', 'Advanced strategy, research, and quantitative lessons.', 3)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- meridian schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meridian.user_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    goal_name TEXT NOT NULL,
    target_amount NUMERIC NOT NULL,
    current_amount NUMERIC DEFAULT 0,
    target_date DATE,
    monthly_contribution NUMERIC,
    required_return_pct NUMERIC,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meridian.risk_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    alert_type TEXT,
    severity TEXT,
    message TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meridian.meridian_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ DEFAULT NOW(),
    event_type TEXT,
    event_data JSONB,
    source TEXT
);

CREATE TABLE IF NOT EXISTS meridian.financial_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    plan_data JSONB NOT NULL,
    trigger TEXT,
    is_current BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS meridian.goal_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES meridian.user_goals(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    actual_amount NUMERIC,
    plan_amount NUMERIC,
    variance_pct NUMERIC,
    on_track BOOLEAN
);

CREATE TABLE IF NOT EXISTS meridian.intelligence_digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    digest_type TEXT,
    content JSONB,
    delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meridian.life_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT,
    event_date DATE,
    notes TEXT,
    plan_recalculated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meridian.user_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    quantity NUMERIC,
    avg_cost NUMERIC,
    current_value NUMERIC,
    pct_of_portfolio NUMERIC,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meridian.user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.risk_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.meridian_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.financial_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.goal_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.intelligence_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.life_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meridian.user_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own meridian goals" ON meridian.user_goals;
CREATE POLICY "Users can manage own meridian goals"
ON meridian.user_goals FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own meridian risk alerts" ON meridian.risk_alerts;
CREATE POLICY "Users can view own meridian risk alerts"
ON meridian.risk_alerts FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own meridian events" ON meridian.meridian_events;
CREATE POLICY "Users can read own meridian events"
ON meridian.meridian_events FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can write own meridian events" ON meridian.meridian_events;
CREATE POLICY "Users can write own meridian events"
ON meridian.meridian_events FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own financial plans" ON meridian.financial_plans;
CREATE POLICY "Users can view own financial plans"
ON meridian.financial_plans FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own intelligence digests" ON meridian.intelligence_digests;
CREATE POLICY "Users can view own intelligence digests"
ON meridian.intelligence_digests FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own life events" ON meridian.life_events;
CREATE POLICY "Users can manage own life events"
ON meridian.life_events FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own meridian positions" ON meridian.user_positions;
CREATE POLICY "Users can manage own meridian positions"
ON meridian.user_positions FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- goal_progress remains service-managed via the parent goal table.

-- ---------------------------------------------------------------------------
-- grants for custom schemas
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA core, ai, trading, market, academy, meridian TO authenticated, service_role;
GRANT USAGE ON SCHEMA ai, market TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA trading TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA academy TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA meridian TO authenticated, service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA market TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ai TO service_role;
GRANT SELECT ON TABLE ai.iris_context_cache TO service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE ai.iris_context_cache TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.learning_topics TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA trading
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA academy
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA meridian
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA market
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;
