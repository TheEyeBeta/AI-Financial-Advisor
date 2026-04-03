// TypeScript types matching the Supabase multi-schema database structure.
// Updated to reflect the current database design across academy, ai, core,
// market, meridian, and trading schemas.

export interface Database {
  public: {
    Tables: Record<string, never>;
  };
  academy: {
    Tables: {
      chat_messages: {
        Row: { id: string; session_id: string | null; sender: string | null; role: string | null; content_md: string | null; created_at: string | null };
        Insert: { id?: string; session_id?: string | null; sender?: string | null; role?: string | null; content_md?: string | null; created_at?: string | null };
        Update: { id?: string; session_id?: string | null; sender?: string | null; role?: string | null; content_md?: string | null; created_at?: string | null };
      };
      chat_sessions: {
        Row: { id: string; user_id: string | null; lesson_id: string | null; created_at: string | null; closed_at: string | null };
        Insert: { id?: string; user_id?: string | null; lesson_id?: string | null; created_at?: string | null; closed_at?: string | null };
        Update: { id?: string; user_id?: string | null; lesson_id?: string | null; created_at?: string | null; closed_at?: string | null };
      };
      lesson_blocks: {
        Row: { id: string; lesson_id: string | null; section_id: string | null; block_type: string | null; content_md: string | null; data: Record<string, unknown> | null; order_index: number; created_at: string | null };
        Insert: { id?: string; lesson_id?: string | null; section_id?: string | null; block_type?: string | null; content_md?: string | null; data?: Record<string, unknown> | null; order_index: number; created_at?: string | null };
        Update: { id?: string; lesson_id?: string | null; section_id?: string | null; block_type?: string | null; content_md?: string | null; data?: Record<string, unknown> | null; order_index?: number; created_at?: string | null };
      };
      lesson_prompt_links: {
        Row: { id: string; lesson_id: string | null; prompt_template_id: string | null; use_case: string | null; config: Record<string, unknown> | null };
        Insert: { id?: string; lesson_id?: string | null; prompt_template_id?: string | null; use_case?: string | null; config?: Record<string, unknown> | null };
        Update: { id?: string; lesson_id?: string | null; prompt_template_id?: string | null; use_case?: string | null; config?: Record<string, unknown> | null };
      };
      lesson_sections: {
        Row: { id: string; lesson_id: string | null; title: string | null; order_index: number; anchor: string | null; created_at: string | null };
        Insert: { id?: string; lesson_id?: string | null; title?: string | null; order_index: number; anchor?: string | null; created_at?: string | null };
        Update: { id?: string; lesson_id?: string | null; title?: string | null; order_index?: number; anchor?: string | null; created_at?: string | null };
      };
      lessons: {
        Row: { id: string; tier_id: string | null; slug: string; title: string; short_summary: string | null; order_index: number; estimated_minutes: number | null; prerequisite_ids: string[] | null; is_published: boolean | null; seo_description: string | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; tier_id?: string | null; slug: string; title: string; short_summary?: string | null; order_index: number; estimated_minutes?: number | null; prerequisite_ids?: string[] | null; is_published?: boolean | null; seo_description?: string | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; tier_id?: string | null; slug?: string; title?: string; short_summary?: string | null; order_index?: number; estimated_minutes?: number | null; prerequisite_ids?: string[] | null; is_published?: boolean | null; seo_description?: string | null; created_at?: string | null; updated_at?: string | null };
      };
      profiles: {
        Row: { id: string; display_name: string | null; role: string | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; display_name?: string | null; role?: string | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; display_name?: string | null; role?: string | null; created_at?: string | null; updated_at?: string | null };
      };
      prompt_templates: {
        Row: { id: string; key: string; role: string | null; template_text: string; description: string | null; output_format: Record<string, unknown> | null; created_at: string | null };
        Insert: { id?: string; key: string; role?: string | null; template_text: string; description?: string | null; output_format?: Record<string, unknown> | null; created_at?: string | null };
        Update: { id?: string; key?: string; role?: string | null; template_text?: string; description?: string | null; output_format?: Record<string, unknown> | null; created_at?: string | null };
      };
      quiz_answers: {
        Row: { id: string; attempt_id: string | null; question_id: string | null; selected_option_ids: string[] | null; free_text_answer: string | null; is_correct: boolean | null; score_awarded: number | null; ai_rationale_md: string | null };
        Insert: { id?: string; attempt_id?: string | null; question_id?: string | null; selected_option_ids?: string[] | null; free_text_answer?: string | null; is_correct?: boolean | null; score_awarded?: number | null; ai_rationale_md?: string | null };
        Update: { id?: string; attempt_id?: string | null; question_id?: string | null; selected_option_ids?: string[] | null; free_text_answer?: string | null; is_correct?: boolean | null; score_awarded?: number | null; ai_rationale_md?: string | null };
      };
      quiz_attempts: {
        Row: { id: string; quiz_id: string | null; user_id: string | null; started_at: string | null; completed_at: string | null; score: number | null; passed: boolean | null; attempt_number: number | null; ai_feedback_md: string | null; raw_result: Record<string, unknown> | null };
        Insert: { id?: string; quiz_id?: string | null; user_id?: string | null; started_at?: string | null; completed_at?: string | null; score?: number | null; passed?: boolean | null; attempt_number?: number | null; ai_feedback_md?: string | null; raw_result?: Record<string, unknown> | null };
        Update: { id?: string; quiz_id?: string | null; user_id?: string | null; started_at?: string | null; completed_at?: string | null; score?: number | null; passed?: boolean | null; attempt_number?: number | null; ai_feedback_md?: string | null; raw_result?: Record<string, unknown> | null };
      };
      quiz_options: {
        Row: { id: string; question_id: string | null; label: string; is_correct: boolean | null; feedback_md: string | null; order_index: number };
        Insert: { id?: string; question_id?: string | null; label: string; is_correct?: boolean | null; feedback_md?: string | null; order_index: number };
        Update: { id?: string; question_id?: string | null; label?: string; is_correct?: boolean | null; feedback_md?: string | null; order_index?: number };
      };
      quiz_questions: {
        Row: { id: string; quiz_id: string | null; question_type: string | null; prompt_md: string; order_index: number; points: number | null; metadata: Record<string, unknown> | null; created_at: string | null };
        Insert: { id?: string; quiz_id?: string | null; question_type?: string | null; prompt_md: string; order_index: number; points?: number | null; metadata?: Record<string, unknown> | null; created_at?: string | null };
        Update: { id?: string; quiz_id?: string | null; question_type?: string | null; prompt_md?: string; order_index?: number; points?: number | null; metadata?: Record<string, unknown> | null; created_at?: string | null };
      };
      quizzes: {
        Row: { id: string; lesson_id: string | null; title: string | null; description: string | null; is_active: boolean | null; pass_score: number | null; max_attempts: number | null; shuffle_questions: boolean | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; lesson_id?: string | null; title?: string | null; description?: string | null; is_active?: boolean | null; pass_score?: number | null; max_attempts?: number | null; shuffle_questions?: boolean | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; lesson_id?: string | null; title?: string | null; description?: string | null; is_active?: boolean | null; pass_score?: number | null; max_attempts?: number | null; shuffle_questions?: boolean | null; created_at?: string | null; updated_at?: string | null };
      };
      tiers: {
        Row: { id: string; name: string; slug: string; description: string | null; order_index: number; created_at: string | null };
        Insert: { id?: string; name: string; slug: string; description?: string | null; order_index: number; created_at?: string | null };
        Update: { id?: string; name?: string; slug?: string; description?: string | null; order_index?: number; created_at?: string | null };
      };
      user_lesson_progress: {
        Row: { id: string; user_id: string | null; lesson_id: string | null; status: string | null; last_opened_at: string | null; completed_at: string | null; best_quiz_score: number | null; last_quiz_attempt_id: string | null };
        Insert: { id?: string; user_id?: string | null; lesson_id?: string | null; status?: string | null; last_opened_at?: string | null; completed_at?: string | null; best_quiz_score?: number | null; last_quiz_attempt_id?: string | null };
        Update: { id?: string; user_id?: string | null; lesson_id?: string | null; status?: string | null; last_opened_at?: string | null; completed_at?: string | null; best_quiz_score?: number | null; last_quiz_attempt_id?: string | null };
      };
      user_tier_enrollments: {
        Row: { id: string; user_id: string | null; tier_id: string | null; enrolled_at: string | null; unlocked_via: string | null };
        Insert: { id?: string; user_id?: string | null; tier_id?: string | null; enrolled_at?: string | null; unlocked_via?: string | null };
        Update: { id?: string; user_id?: string | null; tier_id?: string | null; enrolled_at?: string | null; unlocked_via?: string | null };
      };
    };
  };
  ai: {
    Tables: {
      chat_messages: {
        Row: { id: string; user_id: string; role: string; content: string; created_at: string | null; chat_id: string | null };
        Insert: { id?: string; user_id: string; role: string; content: string; created_at?: string | null; chat_id?: string | null };
        Update: { id?: string; user_id?: string; role?: string; content?: string; created_at?: string | null; chat_id?: string | null };
      };
      chats: {
        Row: { id: string; user_id: string; title: string | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; user_id: string; title?: string | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; user_id?: string; title?: string | null; created_at?: string | null; updated_at?: string | null };
      };
      iris_context_cache: {
        Row: { user_id: string; updated_at: string | null; profile_summary: Record<string, unknown> | null; active_goals: Record<string, unknown> | null; active_alerts: Record<string, unknown> | null; plan_status: Record<string, unknown> | null; knowledge_tier: number | null };
        Insert: { user_id: string; updated_at?: string | null; profile_summary?: Record<string, unknown> | null; active_goals?: Record<string, unknown> | null; active_alerts?: Record<string, unknown> | null; plan_status?: Record<string, unknown> | null; knowledge_tier?: number | null };
        Update: { user_id?: string; updated_at?: string | null; profile_summary?: Record<string, unknown> | null; active_goals?: Record<string, unknown> | null; active_alerts?: Record<string, unknown> | null; plan_status?: Record<string, unknown> | null; knowledge_tier?: number | null };
      };
    };
  };
  core: {
    Tables: {
      achievements: {
        Row: { id: string; user_id: string; name: string; icon: string | null; unlocked_at: string | null };
        Insert: { id?: string; user_id: string; name: string; icon?: string | null; unlocked_at?: string | null };
        Update: { id?: string; user_id?: string; name?: string; icon?: string | null; unlocked_at?: string | null };
      };
      user_profiles: {
        Row: { id: string; user_id: string; created_at: string | null; updated_at: string | null; age_range: string | null; income_range: string | null; monthly_expenses: number | null; total_debt: number | null; dependants: number | null; risk_profile: string | null; knowledge_tier: number | null; investment_horizon: string | null; emergency_fund_months: number | null; monthly_investable: number | null };
        Insert: { id?: string; user_id: string; created_at?: string | null; updated_at?: string | null; age_range?: string | null; income_range?: string | null; monthly_expenses?: number | null; total_debt?: number | null; dependants?: number | null; risk_profile?: string | null; knowledge_tier?: number | null; investment_horizon?: string | null; emergency_fund_months?: number | null; monthly_investable?: number | null };
        Update: { id?: string; user_id?: string; created_at?: string | null; updated_at?: string | null; age_range?: string | null; income_range?: string | null; monthly_expenses?: number | null; total_debt?: number | null; dependants?: number | null; risk_profile?: string | null; knowledge_tier?: number | null; investment_horizon?: string | null; emergency_fund_months?: number | null; monthly_investable?: number | null };
      };
      users: {
        Row: { id: string; auth_id: string; first_name: string | null; last_name: string | null; age: number | null; email: string | null; experience_level: string | null; risk_level: string | null; is_verified: boolean | null; email_verified_at: string | null; created_at: string | null; updated_at: string | null; userType: string; onboarding_complete: boolean | null; marital_status: string | null; investment_goal: string | null };
        Insert: { id?: string; auth_id: string; first_name?: string | null; last_name?: string | null; age?: number | null; email?: string | null; experience_level?: string | null; risk_level?: string | null; is_verified?: boolean | null; email_verified_at?: string | null; created_at?: string | null; updated_at?: string | null; userType: string; onboarding_complete?: boolean | null; marital_status?: string | null; investment_goal?: string | null };
        Update: { id?: string; auth_id?: string; first_name?: string | null; last_name?: string | null; age?: number | null; email?: string | null; experience_level?: string | null; risk_level?: string | null; is_verified?: boolean | null; email_verified_at?: string | null; created_at?: string | null; updated_at?: string | null; userType?: string; onboarding_complete?: boolean | null; marital_status?: string | null; investment_goal?: string | null };
      };
    };
  };
  market: {
    Tables: {
      market_indices: {
        Row: { id: string; symbol: string; name: string; value: number; change_percent: number; is_positive: boolean; updated_at: string | null };
        Insert: { id?: string; symbol: string; name: string; value: number; change_percent: number; is_positive: boolean; updated_at?: string | null };
        Update: { id?: string; symbol?: string; name?: string; value?: number; change_percent?: number; is_positive?: boolean; updated_at?: string | null };
      };
      news: {
        Row: { id: string; title: string; summary: string; link: string; provider: string | null; published_at: string | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; title: string; summary: string; link: string; provider?: string | null; published_at?: string | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; title?: string; summary?: string; link?: string; provider?: string | null; published_at?: string | null; created_at?: string | null; updated_at?: string | null };
      };
      stock_snapshots: {
        Row: { ticker_id: number; ticker: string; company_name: string | null; last_price: number | null; last_price_ts: string | null; price_change_pct: number | null; price_change_abs: number | null; high_52w: number | null; low_52w: number | null; updated_at: string | null; volume: number | null; avg_volume_10d: number | null; avg_volume_30d: number | null; volume_ratio: number | null; sma_10: number | null; sma_20: number | null; sma_50: number | null; sma_100: number | null; sma_200: number | null; ema_10: number | null; ema_20: number | null; ema_50: number | null; ema_200: number | null; rsi_14: number | null; rsi_9: number | null; stochastic_k: number | null; stochastic_d: number | null; williams_r: number | null; cci: number | null; macd: number | null; macd_signal: number | null; macd_histogram: number | null; adx: number | null; bollinger_upper: number | null; bollinger_middle: number | null; bollinger_lower: number | null; pe_ratio: number | null; forward_pe: number | null; peg_ratio: number | null; price_to_book: number | null; price_to_sales: number | null; dividend_yield: number | null; market_cap: number | null; eps: number | null; eps_growth: number | null; revenue_growth: number | null; price_vs_sma_50: number | null; price_vs_sma_200: number | null; price_vs_ema_50: number | null; price_vs_ema_200: number | null; price_vs_bollinger_middle: number | null; is_bullish: boolean | null; is_oversold: boolean | null; is_overbought: boolean | null; latest_signal: string | null; signal_strategy: string | null; signal_confidence: number | null; signal_timestamp: string | null; last_news_ts: string | null; news_count_24h: number | null; synced_at: string };
        Insert: { ticker_id: number; ticker: string; company_name?: string | null; last_price?: number | null; last_price_ts?: string | null; price_change_pct?: number | null; price_change_abs?: number | null; high_52w?: number | null; low_52w?: number | null; updated_at?: string | null; volume?: number | null; avg_volume_10d?: number | null; avg_volume_30d?: number | null; volume_ratio?: number | null; sma_10?: number | null; sma_20?: number | null; sma_50?: number | null; sma_100?: number | null; sma_200?: number | null; ema_10?: number | null; ema_20?: number | null; ema_50?: number | null; ema_200?: number | null; rsi_14?: number | null; rsi_9?: number | null; stochastic_k?: number | null; stochastic_d?: number | null; williams_r?: number | null; cci?: number | null; macd?: number | null; macd_signal?: number | null; macd_histogram?: number | null; adx?: number | null; bollinger_upper?: number | null; bollinger_middle?: number | null; bollinger_lower?: number | null; pe_ratio?: number | null; forward_pe?: number | null; peg_ratio?: number | null; price_to_book?: number | null; price_to_sales?: number | null; dividend_yield?: number | null; market_cap?: number | null; eps?: number | null; eps_growth?: number | null; revenue_growth?: number | null; price_vs_sma_50?: number | null; price_vs_sma_200?: number | null; price_vs_ema_50?: number | null; price_vs_ema_200?: number | null; price_vs_bollinger_middle?: number | null; is_bullish?: boolean | null; is_oversold?: boolean | null; is_overbought?: boolean | null; latest_signal?: string | null; signal_strategy?: string | null; signal_confidence?: number | null; signal_timestamp?: string | null; last_news_ts?: string | null; news_count_24h?: number | null; synced_at: string };
        Update: { ticker_id?: number; ticker?: string; company_name?: string | null; last_price?: number | null; last_price_ts?: string | null; price_change_pct?: number | null; price_change_abs?: number | null; high_52w?: number | null; low_52w?: number | null; updated_at?: string | null; volume?: number | null; avg_volume_10d?: number | null; avg_volume_30d?: number | null; volume_ratio?: number | null; sma_10?: number | null; sma_20?: number | null; sma_50?: number | null; sma_100?: number | null; sma_200?: number | null; ema_10?: number | null; ema_20?: number | null; ema_50?: number | null; ema_200?: number | null; rsi_14?: number | null; rsi_9?: number | null; stochastic_k?: number | null; stochastic_d?: number | null; williams_r?: number | null; cci?: number | null; macd?: number | null; macd_signal?: number | null; macd_histogram?: number | null; adx?: number | null; bollinger_upper?: number | null; bollinger_middle?: number | null; bollinger_lower?: number | null; pe_ratio?: number | null; forward_pe?: number | null; peg_ratio?: number | null; price_to_book?: number | null; price_to_sales?: number | null; dividend_yield?: number | null; market_cap?: number | null; eps?: number | null; eps_growth?: number | null; revenue_growth?: number | null; price_vs_sma_50?: number | null; price_vs_sma_200?: number | null; price_vs_ema_50?: number | null; price_vs_ema_200?: number | null; price_vs_bollinger_middle?: number | null; is_bullish?: boolean | null; is_oversold?: boolean | null; is_overbought?: boolean | null; latest_signal?: string | null; signal_strategy?: string | null; signal_confidence?: number | null; signal_timestamp?: string | null; last_news_ts?: string | null; news_count_24h?: number | null; synced_at?: string };
      };
      trending_stocks: {
        Row: {
          id: string;
          symbol: string;
          name: string;
          change_percent: number;
          updated_at: string | null;
          ticker: string | null;
          composite_score: number | null;
          momentum_score: number | null;
          technical_score: number | null;
          fundamental_score: number | null;
          consistency_score: number | null;
          signal_score: number | null;
          momentum_1m: number | null;
          momentum_3m: number | null;
          momentum_6m: number | null;
          momentum_12m: number | null;
          fundamental_trend: string | null;
          rank_tier: string | null;
          conviction: string | null;
          ranked_at: string | null;
        };
        Insert: {
          id?: string;
          symbol: string;
          name: string;
          change_percent: number;
          updated_at?: string | null;
          ticker?: string | null;
          composite_score?: number | null;
          momentum_score?: number | null;
          technical_score?: number | null;
          fundamental_score?: number | null;
          consistency_score?: number | null;
          signal_score?: number | null;
          momentum_1m?: number | null;
          momentum_3m?: number | null;
          momentum_6m?: number | null;
          momentum_12m?: number | null;
          fundamental_trend?: string | null;
          rank_tier?: string | null;
          conviction?: string | null;
          ranked_at?: string | null;
        };
        Update: {
          id?: string;
          symbol?: string;
          name?: string;
          change_percent?: number;
          updated_at?: string | null;
          ticker?: string | null;
          composite_score?: number | null;
          momentum_score?: number | null;
          technical_score?: number | null;
          fundamental_score?: number | null;
          consistency_score?: number | null;
          signal_score?: number | null;
          momentum_1m?: number | null;
          momentum_3m?: number | null;
          momentum_6m?: number | null;
          momentum_12m?: number | null;
          fundamental_trend?: string | null;
          rank_tier?: string | null;
          conviction?: string | null;
          ranked_at?: string | null;
        };
      };
    };
  };
  meridian: {
    Tables: {
      financial_plans: {
        Row: { id: string; user_id: string; created_at: string | null; plan_data: Record<string, unknown>; trigger: string | null; is_current: boolean | null };
        Insert: { id?: string; user_id: string; created_at?: string | null; plan_data: Record<string, unknown>; trigger?: string | null; is_current?: boolean | null };
        Update: { id?: string; user_id?: string; created_at?: string | null; plan_data?: Record<string, unknown>; trigger?: string | null; is_current?: boolean | null };
      };
      goal_progress: {
        Row: { id: string; goal_id: string; snapshot_date: string; actual_amount: number | null; plan_amount: number | null; variance_pct: number | null; on_track: boolean | null };
        Insert: { id?: string; goal_id: string; snapshot_date: string; actual_amount?: number | null; plan_amount?: number | null; variance_pct?: number | null; on_track?: boolean | null };
        Update: { id?: string; goal_id?: string; snapshot_date?: string; actual_amount?: number | null; plan_amount?: number | null; variance_pct?: number | null; on_track?: boolean | null };
      };
      intelligence_digests: {
        Row: { id: string; user_id: string; created_at: string | null; digest_type: string | null; headline: string | null; body: string | null; content: Record<string, unknown> | null; is_read: boolean | null; delivered: boolean | null; delivered_at: string | null };
        Insert: { id?: string; user_id: string; created_at?: string | null; digest_type?: string | null; headline?: string | null; body?: string | null; content?: Record<string, unknown> | null; is_read?: boolean | null; delivered?: boolean | null; delivered_at?: string | null };
        Update: { id?: string; user_id?: string; created_at?: string | null; digest_type?: string | null; headline?: string | null; body?: string | null; content?: Record<string, unknown> | null; is_read?: boolean | null; delivered?: boolean | null; delivered_at?: string | null };
      };
      life_events: {
        Row: { id: string; user_id: string; event_type: string | null; event_date: string | null; notes: string | null; plan_recalculated: boolean | null; created_at: string | null };
        Insert: { id?: string; user_id: string; event_type?: string | null; event_date?: string | null; notes?: string | null; plan_recalculated?: boolean | null; created_at?: string | null };
        Update: { id?: string; user_id?: string; event_type?: string | null; event_date?: string | null; notes?: string | null; plan_recalculated?: boolean | null; created_at?: string | null };
      };
      meridian_events: {
        Row: { id: string; user_id: string; occurred_at: string | null; event_type: string | null; event_data: Record<string, unknown> | null; source: string | null };
        Insert: { id?: string; user_id: string; occurred_at?: string | null; event_type?: string | null; event_data?: Record<string, unknown> | null; source?: string | null };
        Update: { id?: string; user_id?: string; occurred_at?: string | null; event_type?: string | null; event_data?: Record<string, unknown> | null; source?: string | null };
      };
      risk_alerts: {
        Row: { id: string; user_id: string; created_at: string | null; alert_type: string | null; severity: string | null; message: string | null; resolved: boolean | null; resolved_at: string | null };
        Insert: { id?: string; user_id: string; created_at?: string | null; alert_type?: string | null; severity?: string | null; message?: string | null; resolved?: boolean | null; resolved_at?: string | null };
        Update: { id?: string; user_id?: string; created_at?: string | null; alert_type?: string | null; severity?: string | null; message?: string | null; resolved?: boolean | null; resolved_at?: string | null };
      };
      user_goals: {
        Row: { id: string; user_id: string; goal_name: string; target_amount: number; current_amount: number | null; target_date: string | null; monthly_contribution: number | null; required_return_pct: number | null; status: string | null; created_at: string | null };
        Insert: { id?: string; user_id: string; goal_name: string; target_amount: number; current_amount?: number | null; target_date?: string | null; monthly_contribution?: number | null; required_return_pct?: number | null; status?: string | null; created_at?: string | null };
        Update: { id?: string; user_id?: string; goal_name?: string; target_amount?: number; current_amount?: number | null; target_date?: string | null; monthly_contribution?: number | null; required_return_pct?: number | null; status?: string | null; created_at?: string | null };
      };
      user_positions: {
        Row: { id: string; user_id: string; ticker: string; quantity: number | null; avg_cost: number | null; current_value: number | null; pct_of_portfolio: number | null; last_updated: string | null };
        Insert: { id?: string; user_id: string; ticker: string; quantity?: number | null; avg_cost?: number | null; current_value?: number | null; pct_of_portfolio?: number | null; last_updated?: string | null };
        Update: { id?: string; user_id?: string; ticker?: string; quantity?: number | null; avg_cost?: number | null; current_value?: number | null; pct_of_portfolio?: number | null; last_updated?: string | null };
      };
    };
  };
  trading: {
    Tables: {
      open_positions: {
        Row: { id: string; user_id: string; symbol: string; name: string | null; quantity: number; entry_price: number; current_price: number | null; type: string; entry_date: string; updated_at: string | null; created_at: string | null };
        Insert: { id?: string; user_id: string; symbol: string; name?: string | null; quantity: number; entry_price: number; current_price?: number | null; type: string; entry_date: string; updated_at?: string | null; created_at?: string | null };
        Update: { id?: string; user_id?: string; symbol?: string; name?: string | null; quantity?: number; entry_price?: number; current_price?: number | null; type?: string; entry_date?: string; updated_at?: string | null; created_at?: string | null };
      };
      paper_trade_closes: {
        Row: { id: string; user_id: string; buy_trade_id: string; close_time: string; close_quantity: number; close_price: number; reason: string | null; tags: string[] | null; created_at: string | null };
        Insert: { id?: string; user_id: string; buy_trade_id: string; close_time: string; close_quantity: number; close_price: number; reason?: string | null; tags?: string[] | null; created_at?: string | null };
        Update: { id?: string; user_id?: string; buy_trade_id?: string; close_time?: string; close_quantity?: number; close_price?: number; reason?: string | null; tags?: string[] | null; created_at?: string | null };
      };
      paper_trades: {
        Row: { id: string; user_id: string; symbol: string; buy_time: string; buy_quantity: number; buy_price: number; status: string; tags: string[] | null; notes: string | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; user_id: string; symbol: string; buy_time: string; buy_quantity: number; buy_price: number; status: string; tags?: string[] | null; notes?: string | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; user_id?: string; symbol?: string; buy_time?: string; buy_quantity?: number; buy_price?: number; status?: string; tags?: string[] | null; notes?: string | null; created_at?: string | null; updated_at?: string | null };
      };
      portfolio_history: {
        Row: { id: string; user_id: string; date: string; value: number; created_at: string | null };
        Insert: { id?: string; user_id: string; date: string; value: number; created_at?: string | null };
        Update: { id?: string; user_id?: string; date?: string; value?: number; created_at?: string | null };
      };
      trade_journal: {
        Row: { id: string; user_id: string; trade_id: string | null; symbol: string; type: string; date: string; quantity: number; price: number; strategy: string | null; notes: string | null; tags: string[] | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; user_id: string; trade_id?: string | null; symbol: string; type: string; date: string; quantity: number; price: number; strategy?: string | null; notes?: string | null; tags?: string[] | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; user_id?: string; trade_id?: string | null; symbol?: string; type?: string; date?: string; quantity?: number; price?: number; strategy?: string | null; notes?: string | null; tags?: string[] | null; created_at?: string | null; updated_at?: string | null };
      };
      trades: {
        Row: { id: string; user_id: string; symbol: string; type: string; action: string; quantity: number; entry_price: number; exit_price: number | null; entry_date: string; exit_date: string | null; pnl: number | null; created_at: string | null; updated_at: string | null };
        Insert: { id?: string; user_id: string; symbol: string; type: string; action: string; quantity: number; entry_price: number; exit_price?: number | null; entry_date: string; exit_date?: string | null; pnl?: number | null; created_at?: string | null; updated_at?: string | null };
        Update: { id?: string; user_id?: string; symbol?: string; type?: string; action?: string; quantity?: number; entry_price?: number; exit_price?: number | null; entry_date?: string; exit_date?: string | null; pnl?: number | null; created_at?: string | null; updated_at?: string | null };
      };
    };
  };
}

export type UserProfile = Database['core']['Tables']['users']['Row'];
export type PortfolioHistory = Database['trading']['Tables']['portfolio_history']['Row'];
export type OpenPosition = Database['trading']['Tables']['open_positions']['Row'];
export type Trade = Database['trading']['Tables']['trades']['Row'];
export type TradeJournalEntry = Database['trading']['Tables']['trade_journal']['Row'];
export type Chat = Database['ai']['Tables']['chats']['Row'];
export type ChatMessage = Database['ai']['Tables']['chat_messages']['Row'];
export type Achievement = Database['core']['Tables']['achievements']['Row'];
export type LearningTopic = {
  id: string;
  user_id: string;
  topic_name: string;
  progress: number;
  completed: boolean;
  created_at: string | null;
  updated_at: string | null;
  lesson_id?: string | null;
  tier_id?: string | null;
};
export type MarketIndex = Database['market']['Tables']['market_indices']['Row'];
export type TrendingStock = Database['market']['Tables']['trending_stocks']['Row'];
export type NewsArticle = Database['market']['Tables']['news']['Row'];
export type StockSnapshot = Database['market']['Tables']['stock_snapshots']['Row'];
export type IntelligenceDigest = Database['meridian']['Tables']['intelligence_digests']['Row'];

export interface ChatWithMessages extends Chat {
  messages: ChatMessage[];
  messageCount: number;
  lastMessage?: ChatMessage;
}

// ── Stock Ranking (market.trending_stocks via GET /api/stocks/ranking) ────────

export interface StockScore {
  ticker: string;
  symbol: string;
  name: string;
  change_percent: number | null;
  composite_score: number;
  momentum_score: number | null;
  technical_score: number | null;
  fundamental_score: number | null;
  consistency_score: number | null;
  signal_score: number | null;
  momentum_1m: number | null;
  momentum_3m: number | null;
  momentum_6m: number | null;
  momentum_12m: number | null;
  fundamental_trend: string | null;
  rank_tier: string | null;
  conviction: string | null;
  ranked_at: string | null;
  updated_at?: string | null;
}

export interface TopStocksResult {
  stocks: StockScore[];
  totalScored: number;
  lastRankedAt: string | null;
  dataAgeHours: number | null;
}

// ── Stock Detail (GET /api/stocks/detail/{ticker}) ────────────────────────────

export interface StockDetailTechnicals {
  rsi_14: number | null;
  rsi_9: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  macd_above_signal: boolean | null;
  adx: number | null;
  stochastic_k: number | null;
  stochastic_d: number | null;
  williams_r: number | null;
  cci: number | null;
  bollinger_upper: number | null;
  bollinger_lower: number | null;
  bollinger_position: number | null;
  golden_cross: boolean | null;
}

export interface StockDetailFundamentals {
  pe_ratio: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  eps: number | null;
  eps_growth: number | null;
  revenue_growth: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
}

export interface StockDetailSignals {
  is_bullish: boolean | null;
  is_oversold: boolean | null;
  is_overbought: boolean | null;
  latest_signal: string | null;
  signal_strategy: string | null;
  signal_confidence: number | null;
}

export interface StockDetailRanking {
  composite_score: number | null;
  smoothed_score: number | null;
  rank_tier: string | null;
  conviction: string | null;
  dimension_scores: Record<string, unknown>;
}

export interface StockDetail {
  ticker: string;
  company_name: string | null;
  last_price: number | null;
  price_change_pct: number | null;
  high_52w: number | null;
  low_52w: number | null;
  volume: number | null;
  avg_volume_10d: number | null;
  volume_ratio: number | null;
  price_vs_sma_50: number | null;
  price_vs_sma_200: number | null;
  high_52w_position: number | null;
  technicals: StockDetailTechnicals;
  fundamentals: StockDetailFundamentals;
  signals: StockDetailSignals;
  ranking: StockDetailRanking | null;
}
