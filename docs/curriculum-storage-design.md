# Financial Education Curriculum Storage Design

**Status**: Production-Ready Implementation Plan  
**Last Updated**: 2025-02-14  
**Author**: Senior Product Architect & Data Engineer

---

## 1. Data Model Options

### Option A: Single `education_bank` Table

**Structure:**
- One table with `content_kind` enum: `'lesson' | 'question'`
- Lessons and questions stored together
- Questions reference parent lesson via `parent_module_code`

**Pros:**
- Simpler schema (one table)
- Easier to query all content for a module
- Atomic operations for module + questions
- Less joins needed

**Cons:**
- Mixed content types in one table
- Some columns only relevant to one type (e.g., `correct_answer` only for questions)
- Slightly more complex filtering
- Potential for larger table size

### Option B: Split Tables (`education_bank` + `education_questions`)

**Structure:**
- `education_bank`: Lessons only
- `education_questions`: Questions with FK to `education_bank.module_code`

**Pros:**
- Clear separation of concerns
- Type-safe columns (no nullable question-only fields)
- Better for analytics (separate queries)
- Easier to scale questions independently

**Cons:**
- More joins required
- Two tables to manage
- Slightly more complex inserts

### Recommendation: **Option B (Split Tables)**

**Rationale:**
- Better scalability (questions can grow independently)
- Cleaner data model (no nullable question-only columns)
- Easier to add question-specific features later
- Better for analytics and reporting
- More maintainable long-term

---

## 2. Final Recommended Schema

### Enums

```sql
CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE content_status_enum AS ENUM ('draft', 'published', 'archived');
CREATE TYPE question_type_enum AS ENUM ('multiple_choice', 'true_false', 'calculation', 'scenario');
```

### Tables

#### `education_bank` (Lessons/Modules)

```sql
CREATE TABLE public.education_bank (
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
    CONSTRAINT valid_display_order CHECK (display_order > 0)
);
```

#### `education_questions`

```sql
CREATE TABLE public.education_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type question_type_enum DEFAULT 'multiple_choice',
    options JSONB, -- For multiple choice: {"A": "...", "B": "...", ...}
    correct_answer TEXT NOT NULL, -- Answer key (e.g., "A", "true", calculated value)
    explanation TEXT, -- Explanation shown after answer
    points INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `user_learning_progress` (Enhanced Progress Tracking)

```sql
CREATE TABLE public.user_learning_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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
```

#### `user_question_attempts`

```sql
CREATE TABLE public.user_question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.education_questions(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    points_earned INTEGER DEFAULT 0,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_user_module_attempts (user_id, module_code, attempted_at DESC)
);
```

#### `user_module_assessments` (Quiz Results)

```sql
CREATE TABLE public.user_module_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL REFERENCES public.education_bank(module_code) ON DELETE CASCADE,
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    score_percent INTEGER NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
    passed BOOLEAN NOT NULL,
    threshold_required INTEGER NOT NULL, -- Level-based threshold
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, module_code, completed_at)
);
```

### Indexes

```sql
CREATE INDEX idx_education_bank_level_active ON public.education_bank(level, is_active, display_order);
CREATE INDEX idx_education_bank_track ON public.education_bank(track_or_pathway) WHERE track_or_pathway IS NOT NULL;
CREATE INDEX idx_education_questions_module ON public.education_questions(module_code, display_order);
CREATE INDEX idx_user_progress_user_module ON public.user_learning_progress(user_id, module_code);
CREATE INDEX idx_user_progress_user_level ON public.user_learning_progress(user_id) INCLUDE (module_code);
```

---

## 3. Auto-Personalized Feed Logic

### SQL Query

```sql
-- Get personalized feed for user
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
        COALESCE(ulp.progress_percent, 0) as progress_percent,
        ulp.completed_at,
        ulp.started_at
    FROM public.education_bank eb
    LEFT JOIN public.users u ON u.id = p_user_id
    LEFT JOIN public.user_learning_progress ulp ON ulp.user_id = p_user_id AND ulp.module_code = eb.module_code
    WHERE 
        eb.is_active = TRUE
        AND eb.status = 'published'
        AND (
            -- Match user's experience level
            eb.level = COALESCE(u.experience_level, 'beginner')::experience_level_enum
            OR
            -- Fallback: show beginner if no level set
            (u.experience_level IS NULL AND eb.level = 'beginner')
        )
    ORDER BY 
        -- Incomplete first
        CASE WHEN ulp.completed_at IS NULL THEN 0 ELSE 1 END,
        -- Then by display order
        eb.display_order ASC,
        -- Then by recency (most recently accessed)
        ulp.last_accessed_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Pseudocode

```
function getPersonalizedFeed(userId):
    1. Get user's experience_level from users table
    2. If null, default to 'beginner'
    3. Query education_bank WHERE:
       - level = user.experience_level
       - is_active = TRUE
       - status = 'published'
    4. LEFT JOIN user_learning_progress to get progress
    5. ORDER BY:
       a. Incomplete modules first (completed_at IS NULL)
       b. display_order ASC
       c. last_accessed_at DESC (most recent first)
    6. Return results
```

### Fallback Behavior

- If `users.experience_level` is NULL → show beginner content
- If user has no progress → show all modules for their level
- If user completed all modules → show completed modules (for review)

---

## 4. Progress + Assessments

### Lesson Start Event

```sql
-- Function to start a lesson
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
```

### Lesson Completion Event

```sql
-- Function to complete a lesson
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
```

### Question Attempt

```sql
-- Function to record question attempt
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
BEGIN
    -- Get correct answer and explanation
    SELECT correct_answer, explanation, points
    INTO v_correct_answer, v_explanation, v_points
    FROM public.education_questions
    WHERE id = p_question_id;
    
    -- Check if correct
    v_is_correct := (p_user_answer = v_correct_answer);
    
    -- Record attempt
    INSERT INTO public.user_question_attempts (
        user_id, question_id, module_code, user_answer, is_correct, points_earned
    )
    SELECT 
        p_user_id, 
        p_question_id,
        module_code,
        p_user_answer,
        v_is_correct,
        CASE WHEN v_is_correct THEN v_points ELSE 0 END
    FROM public.education_questions
    WHERE id = p_question_id;
    
    RETURN QUERY SELECT v_is_correct, v_explanation, 
        CASE WHEN v_is_correct THEN v_points ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Assessment Scoring

**Pass Thresholds:**
- Beginner: 60%
- Intermediate: 70%
- Advanced: 80%

```sql
-- Function to complete module assessment
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
    -- Get module level
    SELECT level INTO v_level
    FROM public.education_bank
    WHERE module_code = p_module_code;
    
    -- Set threshold based on level
    v_threshold := CASE v_level
        WHEN 'beginner' THEN 60
        WHEN 'intermediate' THEN 70
        WHEN 'advanced' THEN 80
        ELSE 60
    END;
    
    -- Count total questions for module
    SELECT COUNT(*) INTO v_total
    FROM public.education_questions
    WHERE module_code = p_module_code AND is_active = TRUE;
    
    -- Count correct attempts (most recent per question)
    SELECT COUNT(DISTINCT question_id) INTO v_correct
    FROM (
        SELECT DISTINCT ON (question_id) question_id, is_correct
        FROM public.user_question_attempts
        WHERE user_id = p_user_id 
        AND module_code = p_module_code
        ORDER BY question_id, attempted_at DESC
    ) latest_attempts
    WHERE is_correct = TRUE;
    
    -- Calculate score
    v_score := ROUND((v_correct::NUMERIC / NULLIF(v_total, 0) * 100)::NUMERIC);
    v_passed := (v_score >= v_threshold);
    
    -- Record assessment
    INSERT INTO public.user_module_assessments (
        user_id, module_code, total_questions, correct_answers, 
        score_percent, passed, threshold_required
    )
    VALUES (p_user_id, p_module_code, v_total, v_correct, v_score, v_passed, v_threshold);
    
    -- If passed, mark lesson as complete
    IF v_passed THEN
        PERFORM complete_lesson(p_user_id, p_module_code);
    END IF;
    
    RETURN QUERY SELECT v_passed, v_score, v_total, v_correct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Remediation on Fail

- If score < threshold: User can retake questions
- Track retake attempts in `user_question_attempts`
- Assessment uses most recent attempt per question
- Show explanation for incorrect answers
- Allow unlimited retakes until passing

### Sync to `learning_topics`

- On lesson completion: Update matching `learning_topics` row
- Match by `topic_name = education_bank.title`
- Update `progress` and `completed` fields
- Maintain backward compatibility with existing UI

---

## 5. Supabase SQL Migration Bundle

See `sql/curriculum_migration.sql` for complete executable SQL.

---

## 6. Full Curriculum Seed Payload

See `sql/curriculum_seed_data.sql` for complete seed data.

**Question Generation Rule:**
- Minimum 3 questions per module
- Mix of question types (multiple_choice, true_false, calculation)
- At least 1 calculation/scenario question for intermediate+ modules
- All questions have explanations

---

## 7. API Contracts

### GET /api/learning-feed

**Request:**
```typescript
GET /api/learning-feed
Headers: { Authorization: "Bearer <token>" }
```

**Response:**
```json
{
  "items": [
    {
      "module_code": "B1",
      "level": "beginner",
      "track_or_pathway": null,
      "title": "What Does Finance Actually Do?",
      "summary": "Introduction to finance fundamentals...",
      "learning_objective": "Understand the role of finance...",
      "estimated_minutes": 15,
      "tags": ["basics", "introduction"],
      "display_order": 1,
      "progress_percent": 0,
      "completed_at": null,
      "started_at": null
    }
  ],
  "total": 12,
  "user_level": "beginner"
}
```

### GET /api/learning-item/:moduleCode

**Request:**
```typescript
GET /api/learning-item/B1
Headers: { Authorization: "Bearer <token>" }
```

**Response:**
```json
{
  "module": {
    "module_code": "B1",
    "title": "What Does Finance Actually Do?",
    "summary": "...",
    "learning_objective": "...",
    "estimated_minutes": 15,
    "tags": ["basics"],
    "prerequisites": []
  },
  "questions": [
    {
      "id": "uuid",
      "question_text": "What is the primary purpose of finance?",
      "question_type": "multiple_choice",
      "options": {
        "A": "To make money",
        "B": "To allocate resources efficiently",
        "C": "To predict markets",
        "D": "To avoid taxes"
      },
      "points": 1,
      "display_order": 1
    }
  ],
  "user_progress": {
    "progress_percent": 45,
    "started_at": "2025-02-14T10:00:00Z",
    "completed_at": null
  }
}
```

### POST /api/learning-item/:moduleCode/complete

**Request:**
```typescript
POST /api/learning-item/B1/complete
Headers: { Authorization: "Bearer <token>" }
Body: {
  "time_spent_minutes": 18
}
```

**Response:**
```json
{
  "success": true,
  "module_code": "B1",
  "completed_at": "2025-02-14T10:18:00Z"
}
```

### POST /api/learning-question/:questionId/answer

**Request:**
```typescript
POST /api/learning-question/uuid/answer
Headers: { Authorization: "Bearer <token>" }
Body: {
  "user_answer": "B"
}
```

**Response:**
```json
{
  "is_correct": true,
  "explanation": "Finance allocates resources efficiently...",
  "points_earned": 1,
  "correct_answer": "B"
}
```

---

## 8. Validation + Testing Plan

### Enum Enforcement Tests

```sql
-- Test: Invalid level should fail
INSERT INTO education_bank (module_code, level, title, display_order)
VALUES ('TEST1', 'invalid_level', 'Test', 1);
-- Expected: ERROR

-- Test: Valid enum should succeed
INSERT INTO education_bank (module_code, level, title, display_order)
VALUES ('TEST1', 'beginner', 'Test', 1);
-- Expected: SUCCESS
```

### Level Leakage Prevention

```sql
-- Test: User with 'beginner' level should NOT see 'advanced' content
SELECT * FROM get_personalized_learning_feed('beginner_user_id');
-- Expected: Only beginner modules returned

-- Test RLS: User cannot directly query advanced content
SET ROLE authenticated_user;
SELECT * FROM education_bank WHERE level = 'advanced';
-- Expected: RLS blocks if user level doesn't match
```

### RLS Boundaries

```sql
-- Test: User can only read their own progress
SET ROLE user_a;
SELECT * FROM user_learning_progress WHERE user_id = 'user_b_id';
-- Expected: Empty result (RLS blocks)

-- Test: User can only write their own progress
INSERT INTO user_learning_progress (user_id, module_code)
VALUES ('other_user_id', 'B1');
-- Expected: ERROR or RLS blocks
```

### Feed Correctness by Level

```sql
-- Test: Beginner user gets only beginner modules
-- Test: Intermediate user gets only intermediate modules
-- Test: Advanced user gets only advanced modules
-- Test: NULL level defaults to beginner
```

### Score Calculation Correctness

```sql
-- Test: 3/5 correct = 60% (beginner threshold)
-- Test: 4/5 correct = 80% (passes intermediate)
-- Test: 4/5 correct = 80% (passes advanced)
-- Test: Most recent attempt per question is used
```

### Progress Persistence

```sql
-- Test: Starting lesson creates progress record
-- Test: Completing lesson updates progress to 100%
-- Test: Answering questions updates progress
-- Test: Completing assessment marks lesson complete
```

### Duplicate Prevention

```sql
-- Test: Duplicate module_code should fail
INSERT INTO education_bank (module_code, level, title, display_order)
VALUES ('B1', 'beginner', 'Duplicate', 1);
-- Expected: UNIQUE constraint violation
```

---

## Immediate Next Actions (Top 7)

1. **Run SQL Migration** - Execute `sql/curriculum_migration.sql` in Supabase SQL Editor
2. **Seed Curriculum Data** - Run `sql/curriculum_seed_data.sql` to populate all 86 modules
3. **Test RLS Policies** - Verify users can only see content for their level
4. **Implement Feed API** - Create `/api/learning-feed` endpoint using `get_personalized_learning_feed()` function
5. **Build Lesson Viewer** - Create UI component to display lesson content and questions
6. **Integrate Progress Tracking** - Connect lesson completion to `learning_topics` sync
7. **Add Assessment UI** - Build quiz interface with scoring and remediation

---

## Recommended Option Summary

**Chosen: Option B (Split Tables)**

**Key Benefits:**
- Clean separation: lessons vs questions
- Better scalability for large question banks
- Type-safe schema (no nullable question-only columns)
- Easier analytics and reporting
- More maintainable long-term

**Trade-offs:**
- Requires joins (minimal performance impact with proper indexes)
- Two tables to manage (offset by cleaner design)

**Production Readiness:**
- ✅ Full RLS policies
- ✅ Level-based access control
- ✅ Progress tracking
- ✅ Assessment scoring
- ✅ Backward compatibility with `learning_topics`
- ✅ Comprehensive seed data
- ✅ Validation tests included
