import { supabase } from '@/lib/supabase';

const academy = () => supabase.schema('academy');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Tier {
  id: string;
  name: string;
  slug: string;
  description: string;
  order_index: number;
}

export interface Lesson {
  id: string;
  tier_id: string;
  slug: string;
  title: string;
  short_summary: string;
  order_index: number;
  estimated_minutes: number;
}

export interface LessonBlock {
  id: string;
  lesson_id: string;
  section_id: string | null;
  block_type: 'heading' | 'paragraph' | 'code' | 'example' | 'callout' | 'formula' | 'image' | 'exercise';
  content_md: string;
  data: Record<string, unknown> | null;
  order_index: number;
}

export interface Quiz {
  id: string;
  lesson_id: string;
  title: string;
  pass_score: number;
  shuffle_questions: boolean;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_type: 'mc_single' | 'true_false' | 'short_answer';
  prompt_md: string;
  order_index: number;
  points: number;
}

export interface QuizOption {
  id: string;
  question_id: string;
  label: string;
  is_correct: boolean;
  feedback_md: string;
  order_index: number;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  user_id: string;
  score: number;
  passed: boolean;
  completed_at: string;
  ai_feedback_md: string | null;
}

export interface QuizAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_ids: string[] | null;
  free_text_answer: string | null;
  is_correct: boolean;
  score_awarded: number;
  ai_rationale_md: string | null;
}

export interface UserLessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  status: 'not_started' | 'in_progress' | 'completed';
  best_quiz_score: number | null;
  completed_at: string | null;
}

export interface UserTierEnrollment {
  id: string;
  user_id: string;
  tier_id: string;
  enrolled_at: string;
  unlocked_via: string | null;
}

export interface PromptTemplate {
  id: string;
  key: string;
  template_text: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  lesson_id: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender: string;
  role: string;
  content_md: string;
  created_at: string;
}

// ─── Stable Tier IDs ─────────────────────────────────────────────────────────

export const TIER_IDS = {
  BEGINNER: '00000000-0000-0000-0000-000000000001',
  INTERMEDIATE: '00000000-0000-0000-0000-000000000002',
  ADVANCED: '00000000-0000-0000-0000-000000000003',
} as const;

export const UNLOCK_THRESHOLDS = {
  INTERMEDIATE: 8,
  ADVANCED: 8,
};

// ─── Template variable injection ─────────────────────────────────────────────

export function injectTemplateVars(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v).replaceAll(`{${k}}`, v),
    template,
  );
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const academyApi = {
  // ─── Tiers ───────────────────────────────────────────────────────────────

  async getTiers(): Promise<Tier[]> {
    const { data, error } = await academy().from('tiers').select('*').order('order_index');
    if (error) throw error;
    return data || [];
  },

  // ─── Lessons ─────────────────────────────────────────────────────────────

  async getLessonsByTier(tier_id: string): Promise<Lesson[]> {
    const { data, error } = await academy()
      .from('lessons')
      .select('*')
      .eq('tier_id', tier_id)
      .order('order_index');
    if (error) throw error;
    return data || [];
  },

  async getAllLessons(): Promise<Lesson[]> {
    const { data, error } = await academy().from('lessons').select('*').order('order_index');
    if (error) throw error;
    return data || [];
  },

  async getLessonBySlug(slug: string): Promise<Lesson | null> {
    const { data, error } = await academy()
      .from('lessons')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  // ─── Lesson Blocks ────────────────────────────────────────────────────────

  async getLessonBlocks(lesson_id: string): Promise<LessonBlock[]> {
    const { data, error } = await academy()
      .from('lesson_blocks')
      .select('*')
      .eq('lesson_id', lesson_id)
      .order('order_index');
    if (error) throw error;
    return data || [];
  },

  // ─── Quiz ─────────────────────────────────────────────────────────────────

  async getQuizByLesson(lesson_id: string): Promise<Quiz | null> {
    const { data, error } = await academy()
      .from('quizzes')
      .select('*')
      .eq('lesson_id', lesson_id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getQuizQuestions(quiz_id: string): Promise<QuizQuestion[]> {
    const { data, error } = await academy()
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quiz_id)
      .order('order_index');
    if (error) throw error;
    return data || [];
  },

  async getQuizOptions(question_ids: string[]): Promise<QuizOption[]> {
    if (question_ids.length === 0) return [];
    const { data, error } = await academy()
      .from('quiz_options')
      .select('*')
      .in('question_id', question_ids)
      .order('order_index');
    if (error) throw error;
    return data || [];
  },

  async getBestQuizAttempt(quiz_id: string, user_id: string): Promise<QuizAttempt | null> {
    const { data, error } = await academy()
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', quiz_id)
      .eq('user_id', user_id)
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async createQuizAttempt(
    attempt: Omit<QuizAttempt, 'id' | 'completed_at'>,
  ): Promise<QuizAttempt> {
    const { data, error } = await academy()
      .from('quiz_attempts')
      .insert({ ...attempt, completed_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async createQuizAnswers(answers: Omit<QuizAnswer, 'id'>[]): Promise<void> {
    if (answers.length === 0) return;
    const { error } = await academy().from('quiz_answers').insert(answers);
    if (error) throw error;
  },

  // ─── Progress ─────────────────────────────────────────────────────────────

  async getUserLessonProgress(user_id: string): Promise<UserLessonProgress[]> {
    const { data, error } = await academy()
      .from('user_lesson_progress')
      .select('*')
      .eq('user_id', user_id);
    if (error) throw error;
    return data || [];
  },

  async getLessonProgress(user_id: string, lesson_id: string): Promise<UserLessonProgress | null> {
    const { data, error } = await academy()
      .from('user_lesson_progress')
      .select('*')
      .eq('user_id', user_id)
      .eq('lesson_id', lesson_id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async upsertLessonProgress(
    user_id: string,
    lesson_id: string,
    status: 'not_started' | 'in_progress' | 'completed',
    best_quiz_score?: number,
  ): Promise<void> {
    const upsertData: Record<string, unknown> = { user_id, lesson_id, status };
    if (status === 'completed') {
      upsertData.completed_at = new Date().toISOString();
      if (best_quiz_score !== undefined) {
        upsertData.best_quiz_score = best_quiz_score;
      }
    }
    const { error } = await academy()
      .from('user_lesson_progress')
      .upsert(upsertData, { onConflict: 'user_id,lesson_id' });
    if (error) throw error;
  },

  async updateProgressOnPass(user_id: string, lesson_id: string, score: number): Promise<void> {
    const current = await this.getLessonProgress(user_id, lesson_id);
    const currentBest = current?.best_quiz_score ?? 0;
    const newBest = Math.max(currentBest, score);
    await this.upsertLessonProgress(user_id, lesson_id, 'completed', newBest);
  },

  // ─── Tier Enrollments ─────────────────────────────────────────────────────

  async getTierEnrollments(user_id: string): Promise<UserTierEnrollment[]> {
    const { data, error } = await academy()
      .from('user_tier_enrollments')
      .select('*')
      .eq('user_id', user_id);
    if (error) throw error;
    return data || [];
  },

  async enrollInTier(
    user_id: string,
    tier_id: string,
    unlocked_via?: string,
  ): Promise<void> {
    const { error } = await academy()
      .from('user_tier_enrollments')
      .upsert(
        {
          user_id,
          tier_id,
          unlocked_via: unlocked_via || null,
          enrolled_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,tier_id' },
      );
    if (error) throw error;
  },

  // ─── Profiles ─────────────────────────────────────────────────────────────

  async upsertProfile(user_id: string, display_name?: string): Promise<void> {
    const { error } = await academy()
      .from('profiles')
      .upsert({ id: user_id, display_name: display_name || null }, { onConflict: 'id' });
    if (error) throw error;
  },

  // ─── Prompt Templates ─────────────────────────────────────────────────────

  async getPromptTemplate(key: string): Promise<PromptTemplate | null> {
    const { data, error } = await academy()
      .from('prompt_templates')
      .select('*')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  // ─── Chat ─────────────────────────────────────────────────────────────────

  async getChatSession(user_id: string, lesson_id: string): Promise<ChatSession> {
    const { data: existing, error: fetchErr } = await academy()
      .from('chat_sessions')
      .select('*')
      .eq('user_id', user_id)
      .eq('lesson_id', lesson_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing) return existing as ChatSession;

    const { data, error } = await academy()
      .from('chat_sessions')
      .insert({ user_id, lesson_id })
      .select()
      .single();
    if (error) throw error;
    return data as ChatSession;
  },

  async getChatMessages(session_id: string): Promise<ChatMessage[]> {
    const { data, error } = await academy()
      .from('chat_messages')
      .select('*')
      .eq('session_id', session_id)
      .order('created_at');
    if (error) throw error;
    return (data || []) as ChatMessage[];
  },

  async saveChatMessage(
    session_id: string,
    sender: string,
    role: string,
    content_md: string,
  ): Promise<ChatMessage> {
    const { data, error } = await academy()
      .from('chat_messages')
      .insert({ session_id, sender, role, content_md })
      .select()
      .single();
    if (error) throw error;
    return data as ChatMessage;
  },
};
