import { supabase } from '@/lib/supabase';
import type {
  Achievement,
  LearningTopic,
  MarketIndex,
  TrendingStock,
} from '@/types/database';

export const learningApi = {
  async getTopics(userId: string): Promise<LearningTopic[]> {
    const [{ data: lessons, error: lessonsError }, { data: progressRows, error: progressError }] = await Promise.all([
      supabase
        .schema('academy')
        .from('lessons')
        .select('id, tier_id, title, order_index, created_at, updated_at')
        .eq('is_published', true)
        .order('order_index', { ascending: true }),
      supabase
        .schema('academy')
        .from('user_lesson_progress')
        .select('lesson_id, status, best_quiz_score, last_opened_at, completed_at')
        .eq('user_id', userId),
    ]);

    if (lessonsError) throw lessonsError;
    if (progressError) throw progressError;

    const progressByLesson = new Map((progressRows || []).map((row) => [row.lesson_id, row]));

    return (lessons || []).map((lesson) => {
      const progress = progressByLesson.get(lesson.id);
      const completed = progress?.status === 'completed';
      const derivedProgress = completed
        ? 100
        : progress?.status === 'in_progress'
          ? Math.max(5, Math.min(95, Math.round(Number(progress?.best_quiz_score ?? 0))))
          : 0;

      return {
        id: lesson.id,
        user_id: userId,
        topic_name: lesson.title,
        progress: derivedProgress,
        completed,
        created_at: lesson.created_at ?? null,
        updated_at: lesson.updated_at ?? progress?.last_opened_at ?? progress?.completed_at ?? null,
        lesson_id: lesson.id,
        tier_id: lesson.tier_id ?? null,
      };
    });
  },

  async updateProgress(userId: string, topicName: string, progress: number, completed?: boolean): Promise<LearningTopic> {
    const { data: lesson, error: lessonError } = await supabase
      .schema('academy')
      .from('lessons')
      .select('id, tier_id, title, created_at, updated_at')
      .eq('title', topicName)
      .maybeSingle();

    if (lessonError) throw lessonError;
    if (!lesson) throw new Error(`No academy lesson found for topic "${topicName}".`);

    const { data: existingProgress, error: existingProgressError } = await supabase
      .schema('academy')
      .from('user_lesson_progress')
      .select('id, best_quiz_score, completed_at')
      .eq('user_id', userId)
      .eq('lesson_id', lesson.id)
      .maybeSingle();

    if (existingProgressError) throw existingProgressError;

    const normalizedProgress = Math.max(0, Math.min(100, progress));
    const status =
      completed ?? normalizedProgress >= 100
        ? 'completed'
        : normalizedProgress > 0
          ? 'in_progress'
          : 'not_started';
    const timestamp = new Date().toISOString();

    const { error: upsertError } = await supabase
      .schema('academy')
      .from('user_lesson_progress')
      .upsert(
        {
          user_id: userId,
          lesson_id: lesson.id,
          status,
          best_quiz_score: existingProgress?.best_quiz_score ?? null,
          last_opened_at: timestamp,
          completed_at: status === 'completed' ? existingProgress?.completed_at ?? timestamp : null,
        },
        { onConflict: 'user_id,lesson_id' },
      );

    if (upsertError) throw upsertError;

    return {
      id: lesson.id,
      user_id: userId,
      topic_name: lesson.title,
      progress: status === 'completed' ? 100 : normalizedProgress,
      completed: status === 'completed',
      created_at: lesson.created_at ?? null,
      updated_at: timestamp,
      lesson_id: lesson.id,
      tier_id: lesson.tier_id ?? null,
    };
  },

  async initializeTopics(
    userId: string,
    _experienceLevel?: 'beginner' | 'intermediate' | 'advanced',
  ): Promise<LearningTopic[]> {
    return this.getTopics(userId);
  },
};

export const achievementsApi = {
  async getAll(userId: string): Promise<Achievement[]> {
    const { data, error } = await supabase
      .schema('core')
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async unlock(userId: string, name: string, icon?: string): Promise<Achievement> {
    const { data, error } = await supabase
      .schema('core')
      .from('achievements')
      .insert({ user_id: userId, name, icon })
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};

export const marketApi = {
  async getIndices(): Promise<MarketIndex[]> {
    const { data, error } = await supabase
      .schema('market')
      .from('market_indices')
      .select('*')
      .order('symbol', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getTrendingStocks(): Promise<TrendingStock[]> {
    const { data, error } = await supabase
      .schema('market')
      .from('trending_stocks')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  },
};
