// TypeScript types matching the Supabase database schema

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          age: number | null;
          email: string | null;
          experience_level: 'beginner' | 'intermediate' | 'advanced';
          risk_level: 'low' | 'mid' | 'high' | 'very_high';
          is_verified: boolean;
          email_verified_at: string | null;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          first_name?: string | null;
          last_name?: string | null;
          age?: number | null;
          email?: string | null;
          experience_level?: 'beginner' | 'intermediate' | 'advanced';
          risk_level?: 'low' | 'mid' | 'high' | 'very_high';
          is_verified?: boolean;
          email_verified_at?: string | null;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          age?: number | null;
          email?: string | null;
          experience_level?: 'beginner' | 'intermediate' | 'advanced';
          risk_level?: 'low' | 'mid' | 'high' | 'very_high';
          is_verified?: boolean;
          email_verified_at?: string | null;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
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
    };
  };
}

// Convenience types for components
export type PortfolioHistory = Database['public']['Tables']['portfolio_history']['Row'];
export type OpenPosition = Database['public']['Tables']['open_positions']['Row'];
export type Trade = Database['public']['Tables']['trades']['Row'];
export type TradeJournalEntry = Database['public']['Tables']['trade_journal']['Row'];
export type Chat = Database['public']['Tables']['chats']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
export type LearningTopic = Database['public']['Tables']['learning_topics']['Row'];
export type Achievement = Database['public']['Tables']['achievements']['Row'];
export type MarketIndex = Database['public']['Tables']['market_indices']['Row'];
export type TrendingStock = Database['public']['Tables']['trending_stocks']['Row'];

// Extended types with relations
export interface ChatWithMessages extends Chat {
  messages: ChatMessage[];
  messageCount: number;
  lastMessage?: ChatMessage;
}
