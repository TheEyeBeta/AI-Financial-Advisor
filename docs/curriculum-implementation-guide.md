# Curriculum Implementation Guide

**Quick Start Guide** for implementing the financial education curriculum system.

---

## Immediate Next Actions (Top 7)

### 1. ✅ Run SQL Migration
```sql
-- In Supabase SQL Editor, run:
-- sql/curriculum_migration.sql
```
This creates all tables, functions, RLS policies, and indexes.

### 2. ✅ Seed Curriculum Data
```sql
-- In Supabase SQL Editor, run:
-- sql/curriculum_seed_data.sql
```
This populates all 86 modules (12 beginner + 24 intermediate + 50 advanced).

### 3. ✅ Generate Questions for All Modules
The seed file includes a template. Generate 3-5 questions per module:
- Mix of question types (multiple_choice, true_false, calculation, scenario)
- All questions need explanations
- Use the template in `curriculum_seed_data.sql`

### 4. ✅ Test RLS Policies
Verify users can only see content for their experience level:
```sql
-- Test as different user levels
SELECT * FROM get_personalized_learning_feed('user_id');
```

### 5. ✅ Implement Feed API Endpoint
Create backend endpoint:
```typescript
GET /api/learning-feed
// Uses: get_personalized_learning_feed(userId)
```

### 6. ✅ Build Lesson Viewer UI
Create React component to:
- Display lesson content
- Show questions
- Track progress
- Submit answers

### 7. ✅ Integrate with Existing UI
- Connect to `LearningProgress` component
- Sync completion to `learning_topics` table
- Update progress tracking

---

## File Structure

```
sql/
├── curriculum_migration.sql      # Complete schema + RLS + functions
├── curriculum_seed_data.sql      # All 86 modules + sample questions
└── fix_learning_topics_rls.sql   # RLS fix for existing table

docs/
├── curriculum-storage-design.md   # Full design document
└── curriculum-implementation-guide.md  # This file
```

---

## Key Functions

### `get_personalized_learning_feed(user_id)`
Returns personalized curriculum feed based on user's experience level.

### `start_lesson(user_id, module_code)`
Records when a user starts a lesson.

### `complete_lesson(user_id, module_code)`
Marks lesson as complete and syncs to `learning_topics`.

### `record_question_attempt(user_id, question_id, user_answer)`
Records a question attempt and returns if correct.

### `complete_assessment(user_id, module_code)`
Calculates assessment score and marks complete if passing.

---

## Pass Thresholds

- **Beginner**: 60%
- **Intermediate**: 70%
- **Advanced**: 80%

---

## Database Schema Summary

### Core Tables
- `education_bank` - All lesson modules (86 total)
- `education_questions` - Questions for each module
- `user_learning_progress` - User progress tracking
- `user_question_attempts` - Question attempt history
- `user_module_assessments` - Assessment results

### Key Features
- ✅ Level-based access control (RLS)
- ✅ Prerequisites support
- ✅ Progress tracking
- ✅ Assessment scoring
- ✅ Backward compatible with `learning_topics`

---

## Testing Checklist

- [ ] Migration runs without errors
- [ ] All 86 modules seeded
- [ ] RLS blocks cross-level access
- [ ] Feed function returns correct modules
- [ ] Progress tracking works
- [ ] Assessment scoring correct
- [ ] Sync to `learning_topics` works

---

## Next Steps After Implementation

1. Generate full question bank (3-5 questions per module = 258-430 questions)
2. Add lesson content (rich text, videos, examples)
3. Build lesson viewer UI
4. Implement assessment UI
5. Add progress visualization
6. Create admin interface for content management

---

## Support

See `docs/curriculum-storage-design.md` for complete documentation.
