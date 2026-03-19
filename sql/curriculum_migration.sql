-- ============================================================
-- Financial Education Curriculum - Complete Migration
-- ============================================================
-- Run this in Supabase SQL Editor to set up the curriculum system
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. ENUMS
-- ============================================================

-- Experience level enum (reuse existing if exists)
DO $$ BEGIN
    CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Content status enum
DO $$ BEGIN
    CREATE TYPE content_status_enum AS ENUM ('draft', 'published', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Question type enum
DO $$ BEGIN
    CREATE TYPE question_type_enum AS ENUM ('multiple_choice', 'true_false', 'calculation', 'scenario');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. TABLES
-- ============================================================

-- Education Bank (Lessons/Modules)
CREATE TABLE IF NOT EXISTS public.education_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_code TEXT NOT NULL UNIQUE, -- e.g., 'B1', 'IA1', 'A1.1'
    level experience_level_enum NOT NULL,
    track_or_pathway TEXT, -- e.g., 'IA', 'A1', NULL for beginner
    title TEXT NOT NULL,
    summary TEXT,
    learning_objective TEXT,
    estimated_minutes INTEGER DEFAULT 15,
    tags TEXT[],
    display_order INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    status content_status_enum DEFAULT 'published',
    prerequisites TEXT[], -- Array of module_codes
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_module_code CHECK (module_code ~ '^[A-Z][0-9]+(\.[0-9]+)?$'),
    CONSTRAINT valid_display_order CHECK (display_order > 0),
    CONSTRAINT valid_estimated_minutes CHECK (estimated_minutes > 0)
);

-- Education Questions
CREATE TABLE IF NOT EXISTS public.education_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type question_type_enum DEFAULT 'multiple_choice',
    options JSONB, -- For multiple choice: {"A": "...", "B": "...", ...}
    correct_answer TEXT NOT NULL,
    explanation TEXT,
    points INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_points CHECK (points > 0),
    CONSTRAINT valid_display_order CHECK (display_order > 0)
);

-- User Learning Progress
CREATE TABLE IF NOT EXISTS public.user_learning_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    time_spent_minutes INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, module_code)
);

-- User Question Attempts
CREATE TABLE IF NOT EXISTS public.user_question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.education_questions(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    points_earned INTEGER DEFAULT 0,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Module Assessments
CREATE TABLE IF NOT EXISTS public.user_module_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    score_percent INTEGER NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
    passed BOOLEAN NOT NULL,
    threshold_required INTEGER NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_education_bank_level_active
    ON public.education_bank(level, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_education_bank_track
    ON public.education_bank(track_or_pathway) WHERE track_or_pathway IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_education_bank_status
    ON public.education_bank(status, is_active);
CREATE INDEX IF NOT EXISTS idx_education_questions_module
    ON public.education_questions(module_code, display_order);
CREATE INDEX IF NOT EXISTS idx_user_progress_user_module
    ON public.user_learning_progress(user_id, module_code);
CREATE INDEX IF NOT EXISTS idx_user_progress_user_level
    ON public.user_learning_progress(user_id) INCLUDE (module_code);
CREATE INDEX IF NOT EXISTS idx_user_question_attempts_user_module
    ON public.user_question_attempts(user_id, module_code, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_assessments_user_module
    ON public.user_module_assessments(user_id, module_code, completed_at DESC);

-- ============================================================
-- 4. FUNCTIONS
-- ============================================================

-- Updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Get personalized learning feed
CREATE OR REPLACE FUNCTION get_personalized_learning_feed(p_user_id UUID)
RETURNS TABLE (
    module_code TEXT,
    level experience_level_enum,
    track_or_pathway TEXT,
    title TEXT,
    summary TEXT,
    learning_objective TEXT,
    estimated_minutes INTEGER,
    tags TEXT[],
    display_order INTEGER,
    progress_percent INTEGER,
    completed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        eb.module_code,
        eb.level,
        eb.track_or_pathway,
        eb.title,
        eb.summary,
        eb.learning_objective,
        eb.estimated_minutes,
        eb.tags,
        eb.display_order,
        COALESCE(ulp.progress_percent, 0)::INTEGER as progress_percent,
        ulp.completed_at,
        ulp.started_at
    FROM public.education_bank eb
    LEFT JOIN core.users u ON u.id = p_user_id
    LEFT JOIN public.user_learning_progress ulp ON ulp.user_id = p_user_id AND ulp.module_code = eb.module_code
    WHERE
        eb.is_active = TRUE
        AND eb.status = 'published'
        AND (
            eb.level = COALESCE(u.experience_level, 'beginner')::experience_level_enum
            OR
            (u.experience_level IS NULL AND eb.level = 'beginner')
        )
    ORDER BY
        CASE WHEN ulp.completed_at IS NULL THEN 0 ELSE 1 END,
        eb.display_order ASC,
        ulp.last_accessed_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Start lesson
CREATE OR REPLACE FUNCTION start_lesson(p_user_id UUID, p_module_code TEXT)
RETURNS void AS $$
BEGIN
    INSERT INTO public.user_learning_progress (user_id, module_code, started_at, last_accessed_at)
    VALUES (p_user_id, p_module_code, NOW(), NOW())
    ON CONFLICT (user_id, module_code)
    DO UPDATE SET
        last_accessed_at = NOW(),
        started_at = COALESCE(user_learning_progress.started_at, NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Complete lesson
CREATE OR REPLACE FUNCTION complete_lesson(p_user_id UUID, p_module_code TEXT)
RETURNS void AS $$
BEGIN
    UPDATE public.user_learning_progress
    SET
        completed_at = NOW(),
        progress_percent = 100,
        updated_at = NOW()
    WHERE user_id = p_user_id AND module_code = p_module_code;

    -- Sync to learning_topics if topic_name matches
    UPDATE public.learning_topics
    SET
        completed = TRUE,
        progress = 100,
        updated_at = NOW()
    WHERE user_id = p_user_id
    AND topic_name = (SELECT title FROM public.education_bank WHERE module_code = p_module_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record question attempt
CREATE OR REPLACE FUNCTION record_question_attempt(
    p_user_id UUID,
    p_question_id UUID,
    p_user_answer TEXT
)
RETURNS TABLE (is_correct BOOLEAN, explanation TEXT, points_earned INTEGER) AS $$
DECLARE
    v_correct_answer TEXT;
    v_explanation TEXT;
    v_is_correct BOOLEAN;
    v_points INTEGER;
    v_module_code TEXT;
BEGIN
    SELECT correct_answer, explanation, points, module_code
    INTO v_correct_answer, v_explanation, v_points, v_module_code
    FROM public.education_questions
    WHERE id = p_question_id;

    v_is_correct := (p_user_answer = v_correct_answer);

    INSERT INTO public.user_question_attempts (
        user_id, question_id, module_code, user_answer, is_correct, points_earned
    )
    VALUES (
        p_user_id,
        p_question_id,
        v_module_code,
        p_user_answer,
        v_is_correct,
        CASE WHEN v_is_correct THEN v_points ELSE 0 END
    );

    RETURN QUERY SELECT v_is_correct, v_explanation,
        CASE WHEN v_is_correct THEN v_points ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Complete assessment
CREATE OR REPLACE FUNCTION complete_assessment(
    p_user_id UUID,
    p_module_code TEXT
)
RETURNS TABLE (passed BOOLEAN, score_percent INTEGER, total_questions INTEGER, correct_answers INTEGER) AS $$
DECLARE
    v_level experience_level_enum;
    v_threshold INTEGER;
    v_total INTEGER;
    v_correct INTEGER;
    v_score INTEGER;
    v_passed BOOLEAN;
BEGIN
    SELECT level INTO v_level
    FROM public.education_bank
    WHERE module_code = p_module_code;

    v_threshold := CASE v_level
        WHEN 'beginner' THEN 60
        WHEN 'intermediate' THEN 70
        WHEN 'advanced' THEN 80
        ELSE 60
    END;

    SELECT COUNT(*) INTO v_total
    FROM public.education_questions
    WHERE module_code = p_module_code AND is_active = TRUE;

    SELECT COUNT(DISTINCT question_id) INTO v_correct
    FROM (
        SELECT DISTINCT ON (question_id) question_id, is_correct
        FROM public.user_question_attempts
        WHERE user_id = p_user_id
        AND module_code = p_module_code
        ORDER BY question_id, attempted_at DESC
    ) latest_attempts
    WHERE is_correct = TRUE;

    v_score := ROUND((v_correct::NUMERIC / NULLIF(v_total, 0) * 100)::NUMERIC);
    v_passed := (v_score >= v_threshold);

    INSERT INTO public.user_module_assessments (
        user_id, module_code, total_questions, correct_answers,
        score_percent, passed, threshold_required
    )
    VALUES (p_user_id, p_module_code, v_total, v_correct, v_score, v_passed, v_threshold);

    IF v_passed THEN
        PERFORM complete_lesson(p_user_id, p_module_code);
    END IF;

    RETURN QUERY SELECT v_passed, v_score, v_total, v_correct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. TRIGGERS
-- ============================================================

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_education_bank_updated_at ON public.education_bank;
CREATE TRIGGER update_education_bank_updated_at
    BEFORE UPDATE ON public.education_bank
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_education_questions_updated_at ON public.education_questions;
CREATE TRIGGER update_education_questions_updated_at
    BEFORE UPDATE ON public.education_questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_learning_progress_updated_at ON public.user_learning_progress;
CREATE TRIGGER update_user_learning_progress_updated_at
    BEFORE UPDATE ON public.user_learning_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS
ALTER TABLE public.education_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_learning_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_assessments ENABLE ROW LEVEL SECURITY;

-- Education Bank Policies
DROP POLICY IF EXISTS "Users can view content for their level" ON public.education_bank;
CREATE POLICY "Users can view content for their level"
ON public.education_bank FOR SELECT
TO authenticated
USING (
    level = COALESCE(
        (SELECT experience_level FROM core.users WHERE auth_id = auth.uid())::experience_level_enum,
        'beginner'::experience_level_enum
    )
    AND is_active = TRUE
    AND status = 'published'
);

DROP POLICY IF EXISTS "Admins can manage curriculum" ON public.education_bank;
CREATE POLICY "Admins can manage curriculum"
ON public.education_bank FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM core.users
        WHERE auth_id = auth.uid()
        AND "userType" = 'Admin'
    )
);

-- Education Questions Policies
DROP POLICY IF EXISTS "Users can view questions for their level" ON public.education_questions;
CREATE POLICY "Users can view questions for their level"
ON public.education_questions FOR SELECT
TO authenticated
USING (
    module_code IN (
        SELECT module_code FROM public.education_bank
        WHERE level = COALESCE(
            (SELECT experience_level FROM core.users WHERE auth_id = auth.uid())::experience_level_enum,
            'beginner'::experience_level_enum
        )
        AND is_active = TRUE
        AND status = 'published'
    )
    AND is_active = TRUE
);

DROP POLICY IF EXISTS "Admins can manage questions" ON public.education_questions;
CREATE POLICY "Admins can manage questions"
ON public.education_questions FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM core.users
        WHERE auth_id = auth.uid()
        AND "userType" = 'Admin'
    )
);

-- User Learning Progress Policies
DROP POLICY IF EXISTS "Users can view own progress" ON public.user_learning_progress;
CREATE POLICY "Users can view own progress"
ON public.user_learning_progress FOR SELECT
TO authenticated
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own progress" ON public.user_learning_progress;
CREATE POLICY "Users can update own progress"
ON public.user_learning_progress FOR INSERT, UPDATE
TO authenticated
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- User Question Attempts Policies
DROP POLICY IF EXISTS "Users can view own attempts" ON public.user_question_attempts;
CREATE POLICY "Users can view own attempts"
ON public.user_question_attempts FOR SELECT
TO authenticated
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can record own attempts" ON public.user_question_attempts;
CREATE POLICY "Users can record own attempts"
ON public.user_question_attempts FOR INSERT
TO authenticated
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- User Module Assessments Policies
DROP POLICY IF EXISTS "Users can view own assessments" ON public.user_module_assessments;
CREATE POLICY "Users can view own assessments"
ON public.user_module_assessments FOR SELECT
TO authenticated
USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can record own assessments" ON public.user_module_assessments;
CREATE POLICY "Users can record own assessments"
ON public.user_module_assessments FOR INSERT
TO authenticated
WITH CHECK (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- ============================================================
-- Migration Complete
-- ============================================================

SELECT '✅ Curriculum migration complete!' as status;
