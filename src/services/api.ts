import { supabase, getCurrentUserId } from '@/lib/supabase';
import type {
  PortfolioHistory,
  OpenPosition,
  Trade,
  TradeJournalEntry,
  Chat,
  ChatMessage,
  ChatWithMessages,
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
// Chats API - for managing chat sessions
export const chatsApi = {
  // Get all chats for a user with message counts
  async getAll(userId: string): Promise<ChatWithMessages[]> {
    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    
    if (chatsError) throw chatsError;
    if (!chats || chats.length === 0) return [];

    // Get message counts and last messages for each chat
    const chatIds = chats.map(c => c.id);
    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('*')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });
    
    if (messagesError) throw messagesError;

    // Group messages by chat_id
    const messagesByChat = (messages || []).reduce((acc, msg) => {
      if (!acc[msg.chat_id!]) acc[msg.chat_id!] = [];
      acc[msg.chat_id!].push(msg);
      return acc;
    }, {} as Record<string, ChatMessage[]>);

    return chats.map(chat => ({
      ...chat,
      messages: (messagesByChat[chat.id] || []).reverse(),
      messageCount: (messagesByChat[chat.id] || []).length,
      lastMessage: messagesByChat[chat.id]?.[0],
    }));
  },

  // Create a new chat
  async create(userId: string, title?: string): Promise<Chat> {
    const { data, error } = await supabase
      .from('chats')
      .insert({ user_id: userId, title: title || 'New Chat' })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update chat title
  async updateTitle(chatId: string, title: string): Promise<Chat> {
    const { data, error } = await supabase
      .from('chats')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete a chat (cascade deletes messages)
  async delete(chatId: string): Promise<void> {
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);
    
    if (error) throw error;
  },

  // Get single chat with messages
  async getWithMessages(chatId: string): Promise<ChatWithMessages | null> {
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .single();
    
    if (chatError) throw chatError;
    if (!chat) return null;

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    
    if (messagesError) throw messagesError;

    return {
      ...chat,
      messages: messages || [],
      messageCount: (messages || []).length,
      lastMessage: messages?.[messages.length - 1],
    };
  },
};

export const chatApi = {
  // Get messages for a specific chat
  async getMessages(chatId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  // Legacy: Get all messages for a user (for backward compatibility)
  async getAllUserMessages(userId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async addMessage(userId: string, chatId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ user_id: userId, chat_id: chatId, role, content })
      .select()
      .single();
    
    if (error) throw error;

    // Update chat's updated_at timestamp
    await supabase
      .from('chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId);
    
    return data;
  },

  async clearMessages(chatId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('chat_id', chatId);
    
    if (error) throw error;
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

// Experience level type
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | null;

// Generate system prompt based on user's experience level
function getSystemPrompt(experienceLevel: ExperienceLevel): string {
  const baseRules = `
IMPORTANT RULES:
1. You are ONLY allowed to discuss topics related to finance, investing, trading, economics, personal finance, and money management.
2. If the user asks about anything unrelated to finance (e.g., cooking, sports, entertainment, general knowledge, coding, etc.), politely decline and redirect them to ask a finance-related question instead.
3. Always remind users that this is educational content and they should consult with licensed financial advisors for specific investment decisions.
4. Never provide specific buy/sell recommendations for individual securities.
`;

  switch (experienceLevel) {
    case 'beginner':
      return `You are a patient and encouraging Financial Teacher for beginners. Your role is to:
- Explain financial concepts in simple, everyday language
- Use relatable analogies and real-world examples
- Break down complex topics into digestible pieces
- Avoid jargon, or explain it clearly when necessary
- Encourage questions and celebrate learning progress
- Start with foundational concepts before building to more complex ideas
- Use a warm, supportive tone like a friendly mentor
${baseRules}`;

    case 'intermediate':
      return `You are a knowledgeable Financial Advisor for intermediate-level investors. Your role is to:
- Assume familiarity with basic concepts (stocks, bonds, ETFs, diversification)
- Discuss more nuanced strategies and market dynamics
- Introduce intermediate concepts like options basics, sector analysis, and portfolio rebalancing
- Provide balanced perspectives on different investment approaches
- Use some technical terminology while still being clear
- Encourage deeper exploration of topics they're interested in
${baseRules}`;

    case 'advanced':
      return `You are an expert-level Financial Advisor for sophisticated investors. Your role is to:
- Engage in technical discussions about complex financial instruments
- Discuss advanced strategies: derivatives, hedging, arbitrage, quantitative analysis
- Reference academic research and market microstructure when relevant
- Assume strong familiarity with financial metrics, ratios, and analysis methods
- Discuss macroeconomic factors and their market implications
- Provide nuanced analysis without oversimplifying
${baseRules}`;

    default:
      return `You are a helpful and knowledgeable AI Financial Advisor. Adapt your explanations to the user's apparent level of understanding. Be clear, educational, and provide practical advice.
${baseRules}`;
  }
}

// Python Backend API endpoint helpers
// These can be configured to call your Python backend for AI responses, live market data, etc.
export const pythonApi = {
  // Call OpenAI directly for AI chat response
  // Using gpt-4o-mini - best cost/performance model (cheapest while still being very capable)
  async getChatResponse(message: string, userId: string, experienceLevel?: ExperienceLevel): Promise<string> {
    const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
    
    const systemPrompt = getSystemPrompt(experienceLevel ?? null);
    
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
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: systemPrompt
              },
              {
                role: 'user',
                content: message
              }
            ],
            temperature: 0.7,
            max_tokens: 400, // Reduced for shorter, more focused responses
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `OpenAI API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.choices[0]?.message?.content || 'I apologize, but I encountered an error processing your request.';
      } catch (error: unknown) {
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

  // Generate a short title for a chat based on the first user message
  async generateChatTitle(firstMessage: string): Promise<string> {
    const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
    
    if (!openaiApiKey) {
      // Fallback: use first 30 chars of message
      return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Generate a short, concise title (3-6 words max) for this chat conversation about finance. Only return the title, nothing else.'
            },
            {
              role: 'user',
              content: `First message: "${firstMessage}"`
            }
          ],
          temperature: 0.5,
          max_tokens: 20,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate title');
      }

      const data = await response.json();
      const title = data.choices[0]?.message?.content?.trim();
      return title || firstMessage.substring(0, 30);
    } catch (error) {
      console.error('Error generating chat title:', error);
      return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
    }
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
