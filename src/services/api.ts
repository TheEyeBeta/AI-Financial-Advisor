import { supabase, getCurrentUserId } from '@/lib/supabase';
import type {
  PortfolioHistory,
  OpenPosition,
  Trade,
  TradeJournalEntry,
  ChatMessage,
  LearningTopic,
  Achievement,
  MarketIndex,
  TrendingStock,
} from '@/types/database';

// Portfolio API
export const portfolioApi = {
  async getHistory(userId: string): Promise<PortfolioHistory[]> {
    const { data, error } = await supabase
      .from('portfolio_history')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async addHistoryEntry(userId: string, date: string, value: number): Promise<PortfolioHistory> {
    const { data, error } = await supabase
      .from('portfolio_history')
      .insert({ user_id: userId, date, value })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};

// Open Positions API
export const positionsApi = {
  async getAll(userId: string): Promise<OpenPosition[]> {
    const { data, error } = await supabase
      .from('open_positions')
      .select('*')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(userId: string, position: Omit<OpenPosition, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<OpenPosition> {
    const { data, error } = await supabase
      .from('open_positions')
      .insert({ ...position, user_id: userId })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<OpenPosition>): Promise<OpenPosition> {
    const { data, error } = await supabase
      .from('open_positions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('open_positions')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },
};

// Trades API
export const tradesApi = {
  async getAll(userId: string): Promise<Trade[]> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('exit_date', { ascending: false, nullsFirst: false });
    
    if (error) throw error;
    return data || [];
  },

  async getClosed(userId: string): Promise<Trade[]> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .eq('action', 'CLOSED')
      .order('exit_date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(userId: string, trade: Omit<Trade, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Trade> {
    const { data, error } = await supabase
      .from('trades')
      .insert({ ...trade, user_id: userId })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getStatistics(userId: string) {
    const trades = await this.getClosed(userId);
    const winningTrades = trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = trades.filter(t => (t.pnl || 0) <= 0);
    
    const avgProfit = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
      : 0;
    
    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl || 0), 0) / losingTrades.length
      : 0;
    
    const profitFactor = avgLoss > 0 ? Math.abs(avgProfit) / avgLoss : 0;
    
    return {
      winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      avgProfit,
      avgLoss,
      profitFactor,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
    };
  },
};

// Trade Journal API
export const journalApi = {
  async getAll(userId: string): Promise<TradeJournalEntry[]> {
    const { data, error } = await supabase
      .from('trade_journal')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(userId: string, entry: Omit<TradeJournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'trade_id'>): Promise<TradeJournalEntry> {
    const { data, error } = await supabase
      .from('trade_journal')
      .insert({ ...entry, user_id: userId })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<TradeJournalEntry>): Promise<TradeJournalEntry> {
    const { data, error } = await supabase
      .from('trade_journal')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('trade_journal')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },
};

// Chat API
export const chatApi = {
  async getMessages(userId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async addMessage(userId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ user_id: userId, role, content })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};

// Learning API
export const learningApi = {
  async getTopics(userId: string): Promise<LearningTopic[]> {
    const { data, error } = await supabase
      .from('learning_topics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async updateProgress(userId: string, topicName: string, progress: number, completed?: boolean): Promise<LearningTopic> {
    const { data, error } = await supabase
      .from('learning_topics')
      .upsert({
        user_id: userId,
        topic_name: topicName,
        progress,
        completed: completed ?? progress === 100,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};

// Achievements API
export const achievementsApi = {
  async getAll(userId: string): Promise<Achievement[]> {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async unlock(userId: string, name: string, icon?: string): Promise<Achievement> {
    const { data, error } = await supabase
      .from('achievements')
      .insert({ user_id: userId, name, icon })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};

// Market Data API (can be updated by Python backend)
export const marketApi = {
  async getIndices(): Promise<MarketIndex[]> {
    const { data, error } = await supabase
      .from('market_indices')
      .select('*')
      .order('symbol', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async getTrendingStocks(): Promise<TrendingStock[]> {
    const { data, error } = await supabase
      .from('trending_stocks')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    return data || [];
  },
};

// Python Backend API endpoint helpers
// These can be configured to call your Python backend for AI responses, live market data, etc.
export const pythonApi = {
  // Call OpenAI directly for AI chat response
  // Using gpt-4o-mini - best cost/performance model (cheapest while still being very capable)
  async getChatResponse(message: string, userId: string): Promise<string> {
    const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
    
    // Option 1: Use OpenAI directly if API key is set
    if (openaiApiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini', // Best cost/performance model - cheapest while still very capable
            messages: [
              {
                role: 'system',
                content: 'You are a helpful and knowledgeable AI Financial Advisor. You help users learn about investing, trading strategies, market concepts, and personal finance. Be clear, educational, and provide practical advice while always reminding users to do their own research and consult with licensed financial advisors for specific investment advice.'
              },
              {
                role: 'user',
                content: message
              }
            ],
            temperature: 0.7,
            max_tokens: 500,
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `OpenAI API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.choices[0]?.message?.content || 'I apologize, but I encountered an error processing your request.';
      } catch (error: any) {
        console.error('Error calling OpenAI API:', error);
        // Fallback to Python backend if configured
        if (pythonBackendUrl) {
          return this.getChatResponseFromPython(message, userId);
        }
        return 'I apologize, but the AI service is currently unavailable. Please check your OpenAI API key configuration.';
      }
    }
    
    // Option 2: Use Python backend if configured (fallback)
    if (pythonBackendUrl) {
      return this.getChatResponseFromPython(message, userId);
    }
    
    // Option 3: Fallback response if neither is configured
    return 'I apologize, but the AI service is not configured. Please set VITE_OPENAI_API_KEY in your .env file or configure a Python backend.';
  },

  // Helper method for Python backend (if using that instead)
  async getChatResponseFromPython(message: string, userId: string): Promise<string> {
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          user_id: userId,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Python API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.response || 'I apologize, but I encountered an error processing your request.';
    } catch (error) {
      console.error('Error calling Python API:', error);
      return 'I apologize, but the AI service is currently unavailable. Please try again later.';
    }
  },

  // Example: Get live stock prices from Python backend
  async getStockPrice(symbol: string): Promise<number> {
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/stock-price/${symbol}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch price for ${symbol}`);
      }
      
      const data = await response.json();
      return data.price;
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
      throw error;
    }
  },
};
