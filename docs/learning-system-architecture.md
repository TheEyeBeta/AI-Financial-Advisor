# Financial Learning Hub - System Architecture

**Status**: Architecture Template - Ready for Curriculum Ingestion  
**Last Updated**: 2025-02-13  
**Author**: Senior Learning Product Architect

---

## Executive Summary

This document defines the architecture for a modular, progress-trackable financial learning system integrated into the AI Financial Advisor app. The system preserves backward compatibility with existing `learning_topics` while enabling advanced features like adaptive recommendations, badges, and structured learning paths.

---

## 1. Curriculum Normalization Structure

### Standard Module Format

Each learning module follows this structure:

```typescript
interface NormalizedModule {
  level: 'beginner' | 'intermediate' | 'advanced';
  track: string;                    // e.g., 'trading-fundamentals', 'portfolio-management'
  module_code: string;              // Unique identifier: 'BEG-001', 'INT-042'
  module_title: string;             // Display name
  estimated_minutes: number;        // Expected completion time
  prerequisites: string[];          // Array of module_codes that must be completed
  now_you_can_outcome: string;      // Practical outcome statement
  key_takeaways: string[];          // 3-5 bullet points
  mini_exercise: {
    type: 'calculation' | 'scenario' | 'reflection' | 'practice';
    prompt: string;
    solution_hint?: string;
  };
  quiz_3_questions: QuizQuestion[];
}
```

### Example Normalized Module

```json
{
  "level": "beginner",
  "track": "trading-fundamentals",
  "module_code": "BEG-001",
  "module_title": "What is a Stock?",
  "estimated_minutes": 8,
  "prerequisites": [],
  "now_you_can_outcome": "Explain what a stock represents and why companies issue them",
  "key_takeaways": [
    "A stock represents ownership in a company",
    "Companies issue stock to raise capital",
    "Stock prices fluctuate based on supply and demand",
    "Owning stock makes you a shareholder with voting rights"
  ],
  "mini_exercise": {
    "type": "scenario",
    "prompt": "If you own 100 shares of a company with 1 million total shares, what percentage do you own?",
    "solution_hint": "Divide your shares by total shares and multiply by 100"
  },
  "quiz_3_questions": [
    {
      "question": "What does owning stock represent?",
      "options": ["A loan to the company", "Ownership in the company", "A promise to buy later", "A tax deduction"],
      "correct_answer": 1,
      "explanation": "Stock represents partial ownership (equity) in a company"
    }
  ]
}
```

### Gaps Detection

When ingesting curriculum, identify:
- Missing `now_you_can_outcome` statements
- Modules without practical exercises
- Weak prerequisite chains
- Missing level-appropriate assessments
- Content that's too theoretical without application

---

## 2. Supabase Schema Plan

### Core Tables

#### `learning_tracks`
Learning pathways/tracks (e.g., "Trading Fundamentals", "Portfolio Management")

```sql
CREATE TABLE public.learning_tracks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    track_code TEXT NOT NULL UNIQUE,           -- 'trading-fundamentals'
    track_name TEXT NOT NULL,                   -- 'Trading Fundamentals'
    description TEXT,
    level experience_level_enum NOT NULL,       -- beginner | intermediate | advanced
    icon TEXT,                                  -- Icon identifier
    estimated_hours INTEGER,                    -- Total track duration
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_tracks_level ON public.learning_tracks(level);
CREATE INDEX idx_learning_tracks_active ON public.learning_tracks(is_active) WHERE is_active = TRUE;
```

#### `learning_modules`
Individual learning modules

```sql
CREATE TABLE public.learning_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_code TEXT NOT NULL UNIQUE,           -- 'BEG-001'
    track_id UUID NOT NULL REFERENCES public.learning_tracks(id) ON DELETE CASCADE,
    module_title TEXT NOT NULL,
    level experience_level_enum NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    now_you_can_outcome TEXT NOT NULL,
    key_takeaways TEXT[] NOT NULL,              -- Array of strings
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_modules_track ON public.learning_modules(track_id);
CREATE INDEX idx_learning_modules_level ON public.learning_modules(level);
CREATE INDEX idx_learning_modules_code ON public.learning_modules(module_code);
CREATE INDEX idx_learning_modules_active ON public.learning_modules(is_active) WHERE is_active = TRUE;
```

#### `module_prerequisites`
Prerequisite relationships between modules

```sql
CREATE TABLE public.module_prerequisites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    prerequisite_module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, prerequisite_module_id),
    CHECK (module_id != prerequisite_module_id)
);

CREATE INDEX idx_module_prereqs_module ON public.module_prerequisites(module_id);
CREATE INDEX idx_module_prereqs_prereq ON public.module_prerequisites(prerequisite_module_id);
```

#### `module_blocks`
Content blocks within modules (content/exercise/quiz)

```sql
CREATE TABLE public.module_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    block_type TEXT NOT NULL CHECK (block_type IN ('content', 'exercise', 'quiz')),
    block_order INTEGER NOT NULL,
    title TEXT,
    content TEXT,                               -- Markdown content
    exercise_prompt TEXT,                        -- For exercise blocks
    exercise_type TEXT CHECK (exercise_type IN ('calculation', 'scenario', 'reflection', 'practice')),
    solution_hint TEXT,                          -- For exercises
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, block_order)
);

CREATE INDEX idx_module_blocks_module ON public.module_blocks(module_id);
CREATE INDEX idx_module_blocks_type ON public.module_blocks(block_type);
```

#### `user_module_progress`
User progress tracking per module

```sql
CREATE TABLE public.user_module_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    exercise_completed BOOLEAN DEFAULT FALSE,
    quiz_passed BOOLEAN DEFAULT FALSE,
    quiz_score INTEGER CHECK (quiz_score >= 0 AND quiz_score <= 100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, module_id)
);

CREATE INDEX idx_user_module_progress_user ON public.user_module_progress(user_id);
CREATE INDEX idx_user_module_progress_module ON public.user_module_progress(module_id);
CREATE INDEX idx_user_module_progress_completed ON public.user_module_progress(user_id, completed_at) WHERE completed_at IS NOT NULL;
```

#### `quiz_questions`
Quiz questions for modules

```sql
CREATE TABLE public.quiz_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    options TEXT[] NOT NULL,                    -- Array of answer options
    correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index >= 0),
    explanation TEXT,                            -- Explanation shown after answer
    question_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, question_order)
);

CREATE INDEX idx_quiz_questions_module ON public.quiz_questions(module_id);
```

#### `quiz_attempts`
User quiz attempt tracking

```sql
CREATE TABLE public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
    selected_answer_index INTEGER NOT NULL,
    is_correct BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_attempts_user_module ON public.quiz_attempts(user_id, module_id);
CREATE INDEX idx_quiz_attempts_module ON public.quiz_attempts(module_id);
```

#### `learning_badges`
Badge definitions

```sql
CREATE TABLE public.learning_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    badge_code TEXT NOT NULL UNIQUE,            -- 'first-module-complete'
    badge_name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    unlock_condition JSONB NOT NULL,            -- e.g., {"type": "modules_completed", "count": 5}
    level experience_level_enum,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_badges_code ON public.learning_badges(badge_code);
CREATE INDEX idx_learning_badges_level ON public.learning_badges(level);
```

#### `user_badges`
User badge unlocks (extends existing achievements table)

```sql
-- Extends existing achievements table
-- Can use achievements table with name matching badge_code
-- Or create separate table for better structure

CREATE TABLE public.user_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES public.learning_badges(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, badge_id)
);

CREATE INDEX idx_user_badges_user ON public.user_badges(user_id);
CREATE INDEX idx_user_badges_badge ON public.user_badges(badge_id);
```

#### `module_recommendations`
Stored recommendations for users (cache)

```sql
CREATE TABLE public.module_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    recommendation_score DECIMAL(5,2) NOT NULL, -- 0.00 to 100.00
    recommendation_reason TEXT,                  -- Why this was recommended
    recommended_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, module_id)
);

CREATE INDEX idx_module_recommendations_user ON public.module_recommendations(user_id);
CREATE INDEX idx_module_recommendations_score ON public.module_recommendations(user_id, recommendation_score DESC);
CREATE INDEX idx_module_recommendations_expires ON public.module_recommendations(expires_at) WHERE expires_at < NOW();
```

### RLS Policies

```sql
-- Learning tracks: public read, admin write
ALTER TABLE public.learning_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active tracks" ON public.learning_tracks FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage tracks" ON public.learning_tracks FOR ALL USING (public.is_current_user_admin());

-- Learning modules: public read, admin write
ALTER TABLE public.learning_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active modules" ON public.learning_modules FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage modules" ON public.learning_modules FOR ALL USING (public.is_current_user_admin());

-- User progress: users see only their own
ALTER TABLE public.user_module_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own progress" ON public.user_module_progress FOR SELECT
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
CREATE POLICY "Users update own progress" ON public.user_module_progress FOR ALL
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Quiz attempts: users see only their own
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own quiz attempts" ON public.quiz_attempts FOR ALL
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Recommendations: users see only their own
ALTER TABLE public.module_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own recommendations" ON public.module_recommendations FOR SELECT
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
```

---

## 3. Compatibility Bridge

### Mapping Strategy

The new normalized system maps to existing `learning_topics` table:

```typescript
// Sync logic: Normalized → learning_topics
function syncModuleToLearningTopic(
  userId: string,
  module: NormalizedModule,
  progress: UserModuleProgress
): LearningTopic {
  return {
    user_id: userId,
    topic_name: module.module_code,  // Use module_code as topic_name
    progress: progress.progress_percent,
    completed: progress.completed_at !== null
  };
}

// Reverse mapping: learning_topics → Normalized
function mapLearningTopicToModule(
  topic: LearningTopic
): { module_code: string; progress: number; completed: boolean } {
  return {
    module_code: topic.topic_name,  // topic_name stores module_code
    progress: topic.progress,
    completed: topic.completed
  };
}
```

### Sync Function

```sql
-- Function to sync user_module_progress to learning_topics
CREATE OR REPLACE FUNCTION sync_learning_topics()
RETURNS TRIGGER AS $$
BEGIN
    -- Upsert into learning_topics for backward compatibility
    INSERT INTO public.learning_topics (user_id, topic_name, progress, completed)
    VALUES (
        NEW.user_id,
        (SELECT module_code FROM public.learning_modules WHERE id = NEW.module_id),
        NEW.progress_percent,
        NEW.completed_at IS NOT NULL
    )
    ON CONFLICT (user_id, topic_name) 
    DO UPDATE SET
        progress = NEW.progress_percent,
        completed = NEW.completed_at IS NOT NULL,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-sync
CREATE TRIGGER sync_learning_topics_trigger
    AFTER INSERT OR UPDATE ON public.user_module_progress
    FOR EACH ROW
    EXECUTE FUNCTION sync_learning_topics();
```

### Conflict Resolution Rules

1. **New system writes**: Always win (user_module_progress is source of truth)
2. **Legacy writes**: Migrated on first access
3. **Concurrent writes**: Last write wins (timestamp-based)
4. **Migration**: One-time script to migrate existing `learning_topics` to `user_module_progress`

---

## 4. Recommendation Engine Rules

### Scoring Formula

```typescript
interface RecommendationScore {
  module_id: string;
  total_score: number;  // 0-100
  breakdown: {
    level_match: number;        // 0-30 points
    prerequisite_readiness: number;  // 0-25 points
    weak_area_reinforcement: number; // 0-20 points
    recency_bonus: number;       // 0-15 points
    track_continuity: number;    // 0-10 points
  };
}

function calculateRecommendationScore(
  user: User,
  module: Module,
  userProgress: UserProgress[]
): RecommendationScore {
  const breakdown = {
    level_match: calculateLevelMatch(user.experience_level, module.level),
    prerequisite_readiness: calculatePrerequisiteReadiness(userProgress, module.prerequisites),
    weak_area_reinforcement: calculateWeakAreaReinforcement(userProgress, module),
    recency_bonus: calculateRecencyBonus(userProgress, module),
    track_continuity: calculateTrackContinuity(userProgress, module.track_id)
  };
  
  return {
    module_id: module.id,
    total_score: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
    breakdown
  };
}
```

### Pseudocode Implementation

```typescript
// Level Match (0-30 points)
function calculateLevelMatch(userLevel: string, moduleLevel: string): number {
  if (userLevel === moduleLevel) return 30;
  if (userLevel === 'beginner' && moduleLevel === 'intermediate') return 15;
  if (userLevel === 'intermediate' && moduleLevel === 'advanced') return 15;
  if (userLevel === 'advanced' && moduleLevel === 'intermediate') return 20;
  return 0; // Mismatch (beginner trying advanced)
}

// Prerequisite Readiness (0-25 points)
function calculatePrerequisiteReadiness(
  userProgress: UserProgress[],
  prerequisites: string[]
): number {
  if (prerequisites.length === 0) return 25; // No prerequisites = ready
  
  const completedPrereqs = prerequisites.filter(prereq =>
    userProgress.find(p => p.module_code === prereq && p.completed)
  ).length;
  
  const readinessRatio = completedPrereqs / prerequisites.length;
  return Math.floor(readinessRatio * 25);
}

// Weak Area Reinforcement (0-20 points)
function calculateWeakAreaReinforcement(
  userProgress: UserProgress[],
  module: Module
): number {
  // Find modules user struggled with (low quiz scores, multiple attempts)
  const weakModules = userProgress.filter(p => 
    p.quiz_score < 70 || p.quiz_attempts > 2
  );
  
  // Check if current module addresses similar concepts
  const relatedWeakModules = weakModules.filter(wm => 
    modulesShareConcepts(wm.module_id, module.id)
  );
  
  if (relatedWeakModules.length > 0) return 20;
  return 0;
}

// Recency Bonus (0-15 points)
function calculateRecencyBonus(
  userProgress: UserProgress[],
  module: Module
): number {
  // Find last completed module in same track
  const lastInTrack = userProgress
    .filter(p => p.track_id === module.track_id && p.completed)
    .sort((a, b) => b.completed_at - a.completed_at)[0];
  
  if (!lastInTrack) return 0;
  
  const daysSince = (Date.now() - lastInTrack.completed_at) / (1000 * 60 * 60 * 24);
  
  // Bonus decreases over time
  if (daysSince < 1) return 15;
  if (daysSince < 3) return 12;
  if (daysSince < 7) return 8;
  if (daysSince < 14) return 5;
  return 0;
}

// Track Continuity (0-10 points)
function calculateTrackContinuity(
  userProgress: UserProgress[],
  module: Module
): number {
  const trackProgress = userProgress.filter(p => p.track_id === module.track_id);
  const inProgressModules = trackProgress.filter(p => 
    p.progress_percent > 0 && p.progress_percent < 100
  );
  
  // Bonus for continuing current track
  if (inProgressModules.length > 0) return 10;
  return 0;
}
```

### Cold-Start Behavior

For new users with no progress:

```typescript
function getColdStartRecommendations(
  userLevel: 'beginner' | 'intermediate' | 'advanced'
): Module[] {
  // Return 3-5 starter modules:
  // 1. First module in beginner track (if beginner)
  // 2. Most popular module for their level
  // 3. Quick win module (< 10 minutes)
  // 4. Foundation module (no prerequisites)
  
  return [
    getFirstModuleInTrack('trading-fundamentals'),
    getMostPopularModule(userLevel),
    getQuickWinModule(userLevel),
    getFoundationModule(userLevel)
  ];
}
```

---

## 5. Assessment Design

### Pass Thresholds by Level

```typescript
const PASS_THRESHOLDS = {
  beginner: 60,      // 2 out of 3 questions correct
  intermediate: 70,  // ~2.1 out of 3 questions correct
  advanced: 80       // ~2.4 out of 3 questions correct
};
```

### Quiz Scoring Logic

```typescript
function calculateQuizScore(
  attempts: QuizAttempt[],
  questions: QuizQuestion[],
  userLevel: string
): {
  score: number;
  passed: boolean;
  threshold: number;
} {
  const correctAnswers = attempts.filter(a => a.is_correct).length;
  const totalQuestions = questions.length;
  const score = (correctAnswers / totalQuestions) * 100;
  const threshold = PASS_THRESHOLDS[userLevel];
  
  return {
    score: Math.round(score),
    passed: score >= threshold,
    threshold
  };
}
```

### Fail Remediation Flow

```typescript
interface RemediationFlow {
  onFail: {
    showExplanation: boolean;           // Show correct answers with explanations
    allowRetake: boolean;               // Can retake immediately
    retakeDelayHours: number;           // Hours before retake allowed
    maxAttempts: number;                // Maximum attempts before lockout
    suggestReview: string[];            // Module codes to review
  };
}

const REMEDIATION_CONFIG: Record<string, RemediationFlow> = {
  beginner: {
    onFail: {
      showExplanation: true,
      allowRetake: true,
      retakeDelayHours: 0,              // Can retake immediately
      maxAttempts: 5,
      suggestReview: []                  // No forced review
    }
  },
  intermediate: {
    onFail: {
      showExplanation: true,
      allowRetake: true,
      retakeDelayHours: 1,               // Wait 1 hour
      maxAttempts: 3,
      suggestReview: ['prerequisite-modules'] // Suggest reviewing prerequisites
    }
  },
  advanced: {
    onFail: {
      showExplanation: true,
      allowRetake: true,
      retakeDelayHours: 24,              // Wait 24 hours
      maxAttempts: 2,
      suggestReview: ['prerequisite-modules', 'related-modules']
    }
  }
};
```

### Retest Cadence

- **First retake**: Immediate (beginner), 1 hour (intermediate), 24 hours (advanced)
- **Subsequent retakes**: Exponential backoff (2x previous delay)
- **After max attempts**: Lock module, require admin unlock or complete prerequisites

---

## 6. Seed Payload Examples

### Module Seed JSON

```json
{
  "modules": [
    {
      "module_code": "BEG-001",
      "track_code": "trading-fundamentals",
      "module_title": "What is a Stock?",
      "level": "beginner",
      "estimated_minutes": 8,
      "prerequisites": [],
      "now_you_can_outcome": "Explain what a stock represents and why companies issue them",
      "key_takeaways": [
        "A stock represents ownership in a company",
        "Companies issue stock to raise capital",
        "Stock prices fluctuate based on supply and demand"
      ],
      "display_order": 1
    },
    {
      "module_code": "BEG-002",
      "track_code": "trading-fundamentals",
      "module_title": "Understanding Stock Prices",
      "level": "beginner",
      "estimated_minutes": 12,
      "prerequisites": ["BEG-001"],
      "now_you_can_outcome": "Read a stock quote and understand what each number means",
      "key_takeaways": [
        "Stock prices show current market value",
        "Bid/ask spreads affect your entry price",
        "Volume indicates market interest"
      ],
      "display_order": 2
    }
  ]
}
```

### Quiz Questions Seed JSON

```json
{
  "quiz_questions": [
    {
      "module_code": "BEG-001",
      "question_text": "What does owning stock represent?",
      "options": [
        "A loan to the company",
        "Ownership in the company",
        "A promise to buy later",
        "A tax deduction"
      ],
      "correct_answer_index": 1,
      "explanation": "Stock represents partial ownership (equity) in a company. When you own stock, you're a shareholder.",
      "question_order": 1
    },
    {
      "module_code": "BEG-001",
      "question_text": "Why do companies issue stock?",
      "options": [
        "To pay employees",
        "To raise capital for growth",
        "To reduce taxes",
        "To increase debt"
      ],
      "correct_answer_index": 1,
      "explanation": "Companies issue stock primarily to raise capital without taking on debt.",
      "question_order": 2
    },
    {
      "module_code": "BEG-001",
      "question_text": "What happens to your ownership if a company issues more stock?",
      "options": [
        "Your ownership increases",
        "Your ownership percentage decreases",
        "Nothing changes",
        "You get paid dividends"
      ],
      "correct_answer_index": 1,
      "explanation": "Issuing more stock dilutes existing shareholders' ownership percentage, though the total value may increase.",
      "question_order": 3
    }
  ]
}
```

### SQL Upsert Statements

```sql
-- Insert track
INSERT INTO public.learning_tracks (track_code, track_name, level, description, estimated_hours, display_order)
VALUES (
  'trading-fundamentals',
  'Trading Fundamentals',
  'beginner',
  'Learn the basics of stock trading and market mechanics',
  4,
  1
)
ON CONFLICT (track_code) DO UPDATE SET
  track_name = EXCLUDED.track_name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Insert module
INSERT INTO public.learning_modules (
  module_code,
  track_id,
  module_title,
  level,
  estimated_minutes,
  now_you_can_outcome,
  key_takeaways,
  display_order
)
VALUES (
  'BEG-001',
  (SELECT id FROM public.learning_tracks WHERE track_code = 'trading-fundamentals'),
  'What is a Stock?',
  'beginner',
  8,
  'Explain what a stock represents and why companies issue them',
  ARRAY[
    'A stock represents ownership in a company',
    'Companies issue stock to raise capital',
    'Stock prices fluctuate based on supply and demand'
  ],
  1
)
ON CONFLICT (module_code) DO UPDATE SET
  module_title = EXCLUDED.module_title,
  now_you_can_outcome = EXCLUDED.now_you_can_outcome,
  key_takeaways = EXCLUDED.key_takeaways,
  updated_at = NOW();

-- Insert quiz questions
INSERT INTO public.quiz_questions (
  module_id,
  question_text,
  options,
  correct_answer_index,
  explanation,
  question_order
)
VALUES
  (
    (SELECT id FROM public.learning_modules WHERE module_code = 'BEG-001'),
    'What does owning stock represent?',
    ARRAY['A loan to the company', 'Ownership in the company', 'A promise to buy later', 'A tax deduction'],
    1,
    'Stock represents partial ownership (equity) in a company.',
    1
  ),
  (
    (SELECT id FROM public.learning_modules WHERE module_code = 'BEG-001'),
    'Why do companies issue stock?',
    ARRAY['To pay employees', 'To raise capital for growth', 'To reduce taxes', 'To increase debt'],
    1,
    'Companies issue stock primarily to raise capital without taking on debt.',
    2
  )
ON CONFLICT (module_id, question_order) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  options = EXCLUDED.options,
  correct_answer_index = EXCLUDED.correct_answer_index,
  explanation = EXCLUDED.explanation;
```

---

## 7. Testing Plan

### Unit Tests: Recommendation Scoring

```typescript
describe('Recommendation Engine', () => {
  it('should give highest score to level-matched modules', () => {
    const user = { experience_level: 'beginner' };
    const module = { level: 'beginner', prerequisites: [] };
    const score = calculateRecommendationScore(user, module, []);
    expect(score.breakdown.level_match).toBe(30);
  });
  
  it('should reduce score for missing prerequisites', () => {
    const userProgress = [];
    const module = { prerequisites: ['BEG-001', 'BEG-002'] };
    const score = calculatePrerequisiteReadiness(userProgress, module.prerequisites);
    expect(score).toBe(0);
  });
  
  it('should boost score for weak area reinforcement', () => {
    const weakProgress = [{ module_id: 'BEG-001', quiz_score: 50 }];
    const relatedModule = { id: 'BEG-002', concepts: ['stocks'] };
    const score = calculateWeakAreaReinforcement(weakProgress, relatedModule);
    expect(score).toBeGreaterThan(0);
  });
});
```

### Integration Tests: Supabase CRUD/RLS

```typescript
describe('Learning Module CRUD', () => {
  it('should allow authenticated users to read modules', async () => {
    const { data, error } = await supabase
      .from('learning_modules')
      .select('*')
      .eq('is_active', true);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
  
  it('should prevent non-admins from inserting modules', async () => {
    const { error } = await supabase
      .from('learning_modules')
      .insert({ module_code: 'TEST-001', module_title: 'Test' });
    expect(error).not.toBeNull();
  });
  
  it('should allow users to update own progress', async () => {
    const { error } = await supabase
      .from('user_module_progress')
      .upsert({
        user_id: testUserId,
        module_id: testModuleId,
        progress_percent: 50
      });
    expect(error).toBeNull();
  });
});
```

### E2E Tests

```typescript
describe('Learning Flow E2E', () => {
  it('should complete full learning flow', async () => {
    // 1. Browse modules
    await page.goto('/learning');
    await expect(page.getByText('Trading Fundamentals')).toBeVisible();
    
    // 2. Start module
    await page.getByText('What is a Stock?').click();
    await expect(page.getByText('Now You Can')).toBeVisible();
    
    // 3. Complete exercise
    await page.fill('[data-testid="exercise-input"]', '0.01');
    await page.click('[data-testid="submit-exercise"]');
    await expect(page.getByText('Correct!')).toBeVisible();
    
    // 4. Take quiz
    await page.click('[data-testid="start-quiz"]');
    await page.click('[data-testid="answer-1"]'); // Select correct answer
    await page.click('[data-testid="next-question"]');
    // ... complete all questions
    
    // 5. Verify progress update
    await expect(page.getByText('100% Complete')).toBeVisible();
    
    // 6. Check dashboard shows updated progress
    await page.goto('/dashboard');
    await expect(page.getByText('Learning Progress')).toBeVisible();
  });
});
```

### Data Quality Tests

```typescript
describe('Data Quality', () => {
  it('should reject duplicate module codes', async () => {
    const { error } = await supabase
      .from('learning_modules')
      .insert([
        { module_code: 'BEG-001', module_title: 'Test 1' },
        { module_code: 'BEG-001', module_title: 'Test 2' }
      ]);
    expect(error).not.toBeNull();
    expect(error.code).toBe('23505'); // Unique violation
  });
  
  it('should validate prerequisite chains', async () => {
    // Test circular dependencies
    const module1 = { module_code: 'TEST-001', prerequisites: ['TEST-002'] };
    const module2 = { module_code: 'TEST-002', prerequisites: ['TEST-001'] };
    // Should detect and prevent circular dependency
  });
  
  it('should validate level consistency', async () => {
    const track = { level: 'beginner' };
    const module = { level: 'advanced', track_id: track.id };
    // Module level should match or be compatible with track level
  });
});
```

---

## 8. Rollout Plan

### Phase 1: Foundation (Weeks 1-2)

**Deliverables:**
- Database schema migration
- Basic module CRUD API
- Seed data for 10-15 beginner modules
- Compatibility bridge with `learning_topics`
- Basic module viewer UI

**Risks:**
- Migration conflicts with existing data
- Performance issues with sync triggers
- UI/UX confusion during transition

**Definition of Done:**
- ✅ All tables created and indexed
- ✅ RLS policies tested
- ✅ Seed data loaded
- ✅ Existing dashboard still works
- ✅ Users can view and start modules

### Phase 2: Normalized Learning + Badges (Weeks 3-4)

**Deliverables:**
- Full module content blocks (content/exercise/quiz)
- Quiz system with scoring
- Badge system
- Progress tracking UI
- Recommendation engine (basic)

**Risks:**
- Quiz scoring accuracy
- Badge unlock logic bugs
- Recommendation performance

**Definition of Done:**
- ✅ Users can complete modules end-to-end
- ✅ Quizzes score correctly by level
- ✅ Badges unlock appropriately
- ✅ Recommendations show in UI
- ✅ Progress syncs bidirectionally with `learning_topics`

### Phase 3: Adaptive Recommendations + Experimentation (Weeks 5-6)

**Deliverables:**
- Advanced recommendation engine
- A/B testing framework
- Analytics dashboard
- Spaced repetition logic
- Performance optimizations

**Risks:**
- Recommendation algorithm accuracy
- Performance at scale
- Over-engineering

**Definition of Done:**
- ✅ Recommendations improve completion rates by 20%+
- ✅ System handles 1000+ concurrent users
- ✅ Analytics show learning path effectiveness
- ✅ Spaced repetition reduces forgetting

---

## Immediate Next Actions

1. **Run database migration** - Execute SQL schema in Supabase SQL Editor
2. **Create seed data script** - Convert curriculum JSON to SQL inserts
3. **Build module viewer component** - React component for displaying modules
4. **Implement progress sync** - Create trigger function for `learning_topics` compatibility
5. **Build quiz component** - Interactive quiz with scoring and explanations
6. **Create recommendation API** - Backend endpoint for module recommendations
7. **Add learning page route** - New `/learning` page in React Router

---

## SQL Bundle

```sql
-- ============================================================
-- LEARNING SYSTEM SCHEMA MIGRATION
-- ============================================================
-- Run this in Supabase SQL Editor
-- Backward compatible with existing learning_topics table

-- Learning Tracks
CREATE TABLE IF NOT EXISTS public.learning_tracks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    track_code TEXT NOT NULL UNIQUE,
    track_name TEXT NOT NULL,
    description TEXT,
    level experience_level_enum NOT NULL,
    icon TEXT,
    estimated_hours INTEGER,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_tracks_level ON public.learning_tracks(level);
CREATE INDEX idx_learning_tracks_active ON public.learning_tracks(is_active) WHERE is_active = TRUE;

-- Learning Modules
CREATE TABLE IF NOT EXISTS public.learning_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_code TEXT NOT NULL UNIQUE,
    track_id UUID NOT NULL REFERENCES public.learning_tracks(id) ON DELETE CASCADE,
    module_title TEXT NOT NULL,
    level experience_level_enum NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    now_you_can_outcome TEXT NOT NULL,
    key_takeaways TEXT[] NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_modules_track ON public.learning_modules(track_id);
CREATE INDEX idx_learning_modules_level ON public.learning_modules(level);
CREATE INDEX idx_learning_modules_code ON public.learning_modules(module_code);
CREATE INDEX idx_learning_modules_active ON public.learning_modules(is_active) WHERE is_active = TRUE;

-- Module Prerequisites
CREATE TABLE IF NOT EXISTS public.module_prerequisites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    prerequisite_module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, prerequisite_module_id),
    CHECK (module_id != prerequisite_module_id)
);

CREATE INDEX idx_module_prereqs_module ON public.module_prerequisites(module_id);
CREATE INDEX idx_module_prereqs_prereq ON public.module_prerequisites(prerequisite_module_id);

-- Module Blocks
CREATE TABLE IF NOT EXISTS public.module_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    block_type TEXT NOT NULL CHECK (block_type IN ('content', 'exercise', 'quiz')),
    block_order INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    exercise_prompt TEXT,
    exercise_type TEXT CHECK (exercise_type IN ('calculation', 'scenario', 'reflection', 'practice')),
    solution_hint TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, block_order)
);

CREATE INDEX idx_module_blocks_module ON public.module_blocks(module_id);
CREATE INDEX idx_module_blocks_type ON public.module_blocks(block_type);

-- User Module Progress
CREATE TABLE IF NOT EXISTS public.user_module_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    exercise_completed BOOLEAN DEFAULT FALSE,
    quiz_passed BOOLEAN DEFAULT FALSE,
    quiz_score INTEGER CHECK (quiz_score >= 0 AND quiz_score <= 100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, module_id)
);

CREATE INDEX idx_user_module_progress_user ON public.user_module_progress(user_id);
CREATE INDEX idx_user_module_progress_module ON public.user_module_progress(module_id);
CREATE INDEX idx_user_module_progress_completed ON public.user_module_progress(user_id, completed_at) WHERE completed_at IS NOT NULL;

-- Quiz Questions
CREATE TABLE IF NOT EXISTS public.quiz_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    options TEXT[] NOT NULL,
    correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index >= 0),
    explanation TEXT,
    question_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(module_id, question_order)
);

CREATE INDEX idx_quiz_questions_module ON public.quiz_questions(module_id);

-- Quiz Attempts
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
    selected_answer_index INTEGER NOT NULL,
    is_correct BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_attempts_user_module ON public.quiz_attempts(user_id, module_id);
CREATE INDEX idx_quiz_attempts_module ON public.quiz_attempts(module_id);

-- Learning Badges
CREATE TABLE IF NOT EXISTS public.learning_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    badge_code TEXT NOT NULL UNIQUE,
    badge_name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    unlock_condition JSONB NOT NULL,
    level experience_level_enum,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_badges_code ON public.learning_badges(badge_code);
CREATE INDEX idx_learning_badges_level ON public.learning_badges(level);

-- User Badges
CREATE TABLE IF NOT EXISTS public.user_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES public.learning_badges(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, badge_id)
);

CREATE INDEX idx_user_badges_user ON public.user_badges(user_id);
CREATE INDEX idx_user_badges_badge ON public.user_badges(badge_id);

-- Module Recommendations (cache)
CREATE TABLE IF NOT EXISTS public.module_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
    recommendation_score DECIMAL(5,2) NOT NULL,
    recommendation_reason TEXT,
    recommended_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, module_id)
);

CREATE INDEX idx_module_recommendations_user ON public.module_recommendations(user_id);
CREATE INDEX idx_module_recommendations_score ON public.module_recommendations(user_id, recommendation_score DESC);
CREATE INDEX idx_module_recommendations_expires ON public.module_recommendations(expires_at) WHERE expires_at < NOW();

-- RLS Policies
ALTER TABLE public.learning_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active tracks" ON public.learning_tracks FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage tracks" ON public.learning_tracks FOR ALL USING (public.is_current_user_admin());

ALTER TABLE public.learning_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active modules" ON public.learning_modules FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage modules" ON public.learning_modules FOR ALL USING (public.is_current_user_admin());

ALTER TABLE public.user_module_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own progress" ON public.user_module_progress FOR SELECT
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
CREATE POLICY "Users update own progress" ON public.user_module_progress FOR ALL
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own quiz attempts" ON public.quiz_attempts FOR ALL
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE public.module_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own recommendations" ON public.module_recommendations FOR SELECT
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own badges" ON public.user_badges FOR SELECT
    USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

-- Sync Function: user_module_progress → learning_topics
CREATE OR REPLACE FUNCTION sync_learning_topics()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.learning_topics (user_id, topic_name, progress, completed)
    VALUES (
        NEW.user_id,
        (SELECT module_code FROM public.learning_modules WHERE id = NEW.module_id),
        NEW.progress_percent,
        NEW.completed_at IS NOT NULL
    )
    ON CONFLICT (user_id, topic_name) 
    DO UPDATE SET
        progress = NEW.progress_percent,
        completed = NEW.completed_at IS NOT NULL,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-sync
DROP TRIGGER IF EXISTS sync_learning_topics_trigger ON public.user_module_progress;
CREATE TRIGGER sync_learning_topics_trigger
    AFTER INSERT OR UPDATE ON public.user_module_progress
    FOR EACH ROW
    EXECUTE FUNCTION sync_learning_topics();

-- Updated_at triggers
CREATE TRIGGER update_learning_tracks_updated_at
    BEFORE UPDATE ON public.learning_tracks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learning_modules_updated_at
    BEFORE UPDATE ON public.learning_modules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_module_progress_updated_at
    BEFORE UPDATE ON public.user_module_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

SELECT '✅ Learning system schema migration complete!' as status;
```

---

**Note**: This is the architecture template. When you paste your actual curriculum material, I'll generate the normalized modules, seed data, and complete the implementation.
