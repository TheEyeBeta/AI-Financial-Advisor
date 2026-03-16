// TypeScript types matching the Supabase multi-schema database structure
//
// Schema map:
//   core    — users, user_profiles, achievements, learning_topics
//   trading — portfolio_history, open_positions, trades, trade_journal, eye_snapshots
//   ai      — chats, chat_messages, iris_context_cache
//   market  — stock_snapshots, market_indices, trending_stocks, news, news_articles
//   academy — (see academy-api.ts)

export interface Database {
  public: {
    Tables: Record<string, never>;
  };
  core: {
    Tables: {
      users: {
        Row: {
          id: string;
          auth_id: string;
          first_name: string | null;
          last_name: string | null;
          age: number | null;
          email: string | null;
          experience_level: 'beginner' | 'intermediate' | 'advanced' | null;
          risk_level: 'low' | 'mid' | 'high' | 'very_high' | null;
          is_verified: boolean | null;
          email_verified_at: string | null;
          userType: 'User' | 'Admin';
          onboarding_complete: boolean | null;
          marital_status: 'single' | 'married' | 'divorced' | 'widowed' | null;
          investment_goal: 'retirement' | 'wealth_building' | 'education' | 'house_purchase' | 'other' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_id: string;
          first_name?: string | null;
          last_name?: string | null;
          age?: number | null;
          email?: string | null;
          experience_level?: 'beginner' | 'intermediate' | 'advanced' | null;
          risk_level?: 'low' | 'mid' | 'high' | 'very_high' | null;
          is_verified?: boolean | null;
          email_verified_at?: string | null;
          userType?: 'User' | 'Admin';
          onboarding_complete?: boolean | null;
          marital_status?: 'single' | 'married' | 'divorced' | 'widowed' | null;
          investment_goal?: 'retirement' | 'wealth_building' | 'education' | 'house_purchase' | 'other' | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_id?: string;
          first_name?: string | null;
          last_name?: string | null;
          age?: number | null;
          email?: string | null;
          experience_level?: 'beginner' | 'intermediate' | 'advanced' | null;
          risk_level?: 'low' | 'mid' | 'high' | 'very_high' | null;
          is_verified?: boolean | null;
          email_verified_at?: string | null;
          userType?: 'User' | 'Admin';
          onboarding_complete?: boolean | null;
          marital_status?: 'single' | 'married' | 'divorced' | 'widowed' | null;
          investment_goal?: 'retirement' | 'wealth_building' | 'education' | 'house_purchase' | 'other' | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      achievements: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string | null;
          unlocked_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          icon?: string | null;
          unlocked_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          icon?: string | null;
          unlocked_at?: string;
        };
      };
      learning_topics: {
        Row: {
          id: string;
          user_id: string;
          topic_name: string;
          progress: number;
          completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic_name: string;
          progress?: number;
          completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          topic_name?: string;
          progress?: number;
          completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
  trading: {
    Tables: {
      portfolio_history: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          value: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          value: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          value?: number;
          created_at?: string;
        };
      };
      open_positions: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          name: string | null;
          quantity: number;
          entry_price: number;
          current_price: number | null;
          type: 'LONG' | 'SHORT';
          entry_date: string;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          name?: string | null;
          quantity: number;
          entry_price: number;
          current_price?: number | null;
          type: 'LONG' | 'SHORT';
          entry_date?: string;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          name?: string | null;
          quantity?: number;
          entry_price?: number;
          current_price?: number | null;
          type?: 'LONG' | 'SHORT';
          entry_date?: string;
          updated_at?: string;
          created_at?: string;
        };
      };
      trades: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          type: 'LONG' | 'SHORT';
          action: 'OPENED' | 'CLOSED';
          quantity: number;
          entry_price: number;
          exit_price: number | null;
          entry_date: string;
          exit_date: string | null;
          pnl: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          type: 'LONG' | 'SHORT';
          action: 'OPENED' | 'CLOSED';
          quantity: number;
          entry_price: number;
          exit_price?: number | null;
          entry_date: string;
          exit_date?: string | null;
          pnl?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          type?: 'LONG' | 'SHORT';
          action?: 'OPENED' | 'CLOSED';
          quantity?: number;
          entry_price?: number;
          exit_price?: number | null;
          entry_date?: string;
          exit_date?: string | null;
          pnl?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      trade_journal: {
        Row: {
          id: string;
          user_id: string;
          trade_id: string | null;
          symbol: string;
          type: 'BUY' | 'SELL';
          date: string;
          quantity: number;
          price: number;
          strategy: string | null;
          notes: string | null;
          tags: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trade_id?: string | null;
          symbol: string;
          type: 'BUY' | 'SELL';
          date: string;
          quantity: number;
          price: number;
          strategy?: string | null;
          notes?: string | null;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          trade_id?: string | null;
          symbol?: string;
          type?: 'BUY' | 'SELL';
          date?: string;
          quantity?: number;
          price?: number;
          strategy?: string | null;
          notes?: string | null;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      eye_snapshots: {
        Row: {
          id: string;
          user_id: string;
          snapshot_name: string | null;
          snapshot_date: string;
          portfolio_value: number | null;
          total_positions: number | null;
          total_trades: number | null;
          win_rate: number | null;
          total_pnl: number | null;
          realized_pnl: number | null;
          unrealized_pnl: number | null;
          profit_factor: number | null;
          avg_profit: number | null;
          avg_loss: number | null;
          is_latest: boolean;
          is_active: boolean;
          raw_data: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          snapshot_name?: string | null;
          snapshot_date?: string;
          portfolio_value?: number | null;
          total_positions?: number | null;
          total_trades?: number | null;
          win_rate?: number | null;
          total_pnl?: number | null;
          realized_pnl?: number | null;
          unrealized_pnl?: number | null;
          profit_factor?: number | null;
          avg_profit?: number | null;
          avg_loss?: number | null;
          is_latest?: boolean;
          is_active?: boolean;
          raw_data?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          snapshot_name?: string | null;
          snapshot_date?: string;
          portfolio_value?: number | null;
          total_positions?: number | null;
          total_trades?: number | null;
          win_rate?: number | null;
          total_pnl?: number | null;
          realized_pnl?: number | null;
          unrealized_pnl?: number | null;
          profit_factor?: number | null;
          avg_profit?: number | null;
          avg_loss?: number | null;
          is_latest?: boolean;
          is_active?: boolean;
          raw_data?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
  ai: {
    Tables: {
      chats: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          user_id: string;
          chat_id: string | null;
          role: 'user' | 'assistant';
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          chat_id?: string | null;
          role: 'user' | 'assistant';
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          chat_id?: string | null;
          role?: 'user' | 'assistant';
          content?: string;
          created_at?: string;
        };
      };
    };
  };
  market: {
    Tables: {
      market_indices: {
        Row: {
          id: string;
          symbol: string;
          name: string;
          value: number;
          change_percent: number;
          is_positive: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          name: string;
          value: number;
          change_percent: number;
          is_positive: boolean;
          updated_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          name?: string;
          value?: number;
          change_percent?: number;
          is_positive?: boolean;
          updated_at?: string;
        };
      };
      trending_stocks: {
        Row: {
          id: string;
          symbol: string;
          name: string;
          change_percent: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          name: string;
          change_percent: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          name?: string;
          change_percent?: number;
          updated_at?: string;
        };
      };
      news: {
        Row: {
          id: string;
          title: string;
          summary: string;
          link: string;
          provider: string | null;
          published_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          summary: string;
          link: string;
          provider?: string | null;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          summary?: string;
          link?: string;
          provider?: string | null;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      news_articles: {
        Row: {
          id: string;
          title: string;
          summary: string;
          link: string;
          source: string | null;
          published_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          summary: string;
          link: string;
          source?: string | null;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          summary?: string;
          link?: string;
          source?: string | null;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      stock_snapshots: {
        Row: {
          ticker_id: number;
          ticker: string;
          company_name: string | null;
          last_price: number | null;
          last_price_ts: string | null;
          price_change_pct: number | null;
          price_change_abs: number | null;
          high_52w: number | null;
          low_52w: number | null;
          updated_at: string | null;
          volume: number | null;
          avg_volume_10d: number | null;
          avg_volume_30d: number | null;
          volume_ratio: number | null;
          sma_10: number | null;
          sma_20: number | null;
          sma_50: number | null;
          sma_100: number | null;
          sma_200: number | null;
          ema_10: number | null;
          ema_20: number | null;
          ema_50: number | null;
          ema_200: number | null;
          rsi_14: number | null;
          rsi_9: number | null;
          stochastic_k: number | null;
          stochastic_d: number | null;
          williams_r: number | null;
          cci: number | null;
          macd: number | null;
          macd_signal: number | null;
          macd_histogram: number | null;
          adx: number | null;
          bollinger_upper: number | null;
          bollinger_middle: number | null;
          bollinger_lower: number | null;
          pe_ratio: number | null;
          forward_pe: number | null;
          peg_ratio: number | null;
          price_to_book: number | null;
          price_to_sales: number | null;
          dividend_yield: number | null;
          market_cap: number | null;
          eps: number | null;
          eps_growth: number | null;
          revenue_growth: number | null;
          price_vs_sma_50: number | null;
          price_vs_sma_200: number | null;
          price_vs_ema_50: number | null;
          price_vs_ema_200: number | null;
          price_vs_bollinger_middle: number | null;
          is_bullish: boolean | null;
          is_oversold: boolean | null;
          is_overbought: boolean | null;
          latest_signal: string | null;
          signal_strategy: string | null;
          signal_confidence: number | null;
          signal_timestamp: string | null;
          last_news_ts: string | null;
          news_count_24h: number | null;
          synced_at: string;
        };
        Insert: {
          ticker_id: number;
          ticker: string;
          company_name?: string | null;
          last_price?: number | null;
          last_price_ts?: string | null;
          price_change_pct?: number | null;
          price_change_abs?: number | null;
          high_52w?: number | null;
          low_52w?: number | null;
          updated_at?: string | null;
          volume?: number | null;
          avg_volume_10d?: number | null;
          avg_volume_30d?: number | null;
          volume_ratio?: number | null;
          sma_10?: number | null;
          sma_20?: number | null;
          sma_50?: number | null;
          sma_100?: number | null;
          sma_200?: number | null;
          ema_10?: number | null;
          ema_20?: number | null;
          ema_50?: number | null;
          ema_200?: number | null;
          rsi_14?: number | null;
          rsi_9?: number | null;
          stochastic_k?: number | null;
          stochastic_d?: number | null;
          williams_r?: number | null;
          cci?: number | null;
          macd?: number | null;
          macd_signal?: number | null;
          macd_histogram?: number | null;
          adx?: number | null;
          bollinger_upper?: number | null;
          bollinger_middle?: number | null;
          bollinger_lower?: number | null;
          pe_ratio?: number | null;
          forward_pe?: number | null;
          peg_ratio?: number | null;
          price_to_book?: number | null;
          price_to_sales?: number | null;
          dividend_yield?: number | null;
          market_cap?: number | null;
          eps?: number | null;
          eps_growth?: number | null;
          revenue_growth?: number | null;
          price_vs_sma_50?: number | null;
          price_vs_sma_200?: number | null;
          price_vs_ema_50?: number | null;
          price_vs_ema_200?: number | null;
          price_vs_bollinger_middle?: number | null;
          is_bullish?: boolean | null;
          is_oversold?: boolean | null;
          is_overbought?: boolean | null;
          latest_signal?: string | null;
          signal_strategy?: string | null;
          signal_confidence?: number | null;
          signal_timestamp?: string | null;
          last_news_ts?: string | null;
          news_count_24h?: number | null;
          synced_at?: string;
        };
        Update: {
          ticker_id?: number;
          ticker?: string;
          company_name?: string | null;
          last_price?: number | null;
          last_price_ts?: string | null;
          price_change_pct?: number | null;
          price_change_abs?: number | null;
          high_52w?: number | null;
          low_52w?: number | null;
          updated_at?: string | null;
          volume?: number | null;
          avg_volume_10d?: number | null;
          avg_volume_30d?: number | null;
          volume_ratio?: number | null;
          sma_10?: number | null;
          sma_20?: number | null;
          sma_50?: number | null;
          sma_100?: number | null;
          sma_200?: number | null;
          ema_10?: number | null;
          ema_20?: number | null;
          ema_50?: number | null;
          ema_200?: number | null;
          rsi_14?: number | null;
          rsi_9?: number | null;
          stochastic_k?: number | null;
          stochastic_d?: number | null;
          williams_r?: number | null;
          cci?: number | null;
          macd?: number | null;
          macd_signal?: number | null;
          macd_histogram?: number | null;
          adx?: number | null;
          bollinger_upper?: number | null;
          bollinger_middle?: number | null;
          bollinger_lower?: number | null;
          pe_ratio?: number | null;
          forward_pe?: number | null;
          peg_ratio?: number | null;
          price_to_book?: number | null;
          price_to_sales?: number | null;
          dividend_yield?: number | null;
          market_cap?: number | null;
          eps?: number | null;
          eps_growth?: number | null;
          revenue_growth?: number | null;
          price_vs_sma_50?: number | null;
          price_vs_sma_200?: number | null;
          price_vs_ema_50?: number | null;
          price_vs_ema_200?: number | null;
          price_vs_bollinger_middle?: number | null;
          is_bullish?: boolean | null;
          is_oversold?: boolean | null;
          is_overbought?: boolean | null;
          latest_signal?: string | null;
          signal_strategy?: string | null;
          signal_confidence?: number | null;
          signal_timestamp?: string | null;
          last_news_ts?: string | null;
          news_count_24h?: number | null;
          synced_at?: string;
        };
      };
    };
  };
}

// Convenience types for components
export type UserProfile = Database['core']['Tables']['users']['Row'];
export type PortfolioHistory = Database['trading']['Tables']['portfolio_history']['Row'];
export type OpenPosition = Database['trading']['Tables']['open_positions']['Row'];
export type Trade = Database['trading']['Tables']['trades']['Row'];
export type TradeJournalEntry = Database['trading']['Tables']['trade_journal']['Row'];
export type EyeSnapshot = Database['trading']['Tables']['eye_snapshots']['Row'];
export type Chat = Database['ai']['Tables']['chats']['Row'];
export type ChatMessage = Database['ai']['Tables']['chat_messages']['Row'];
export type Achievement = Database['core']['Tables']['achievements']['Row'];
export type LearningTopic = Database['core']['Tables']['learning_topics']['Row'];
export type MarketIndex = Database['market']['Tables']['market_indices']['Row'];
export type TrendingStock = Database['market']['Tables']['trending_stocks']['Row'];
export type NewsArticle = Database['market']['Tables']['news']['Row'];
export type LegacyNewsArticle = Database['market']['Tables']['news_articles']['Row'];
export type StockSnapshot = Database['market']['Tables']['stock_snapshots']['Row'];

// Extended types with relations
export interface ChatWithMessages extends Chat {
  messages: ChatMessage[];
  messageCount: number;
  lastMessage?: ChatMessage;
}
