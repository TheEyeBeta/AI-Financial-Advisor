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
  NewsArticle,
  EyeSnapshot,
} from '@/types/database';

// Constants for input validation and API configuration
const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;
const MAX_CHAT_HISTORY_MESSAGES = 20;
const OPENAI_MAX_TOKENS = 300; // Reduced to encourage concise responses
const DEEPSEEK_MAX_TOKENS = 500;
const SUPABASE_PROCESSING_DELAY_MS = 1000;
const AUTH_TIMEOUT_MS = 10000;

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

  async update(id: string, userId: string, updates: Partial<OpenPosition>): Promise<OpenPosition> {
    // First verify ownership
    const { data: position, error: fetchError } = await supabase
      .from('open_positions')
      .select('user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !position) {
      throw new Error('Position not found or access denied');
    }
    
    // Update with user_id check for defense-in-depth
    const { data, error } = await supabase
      .from('open_positions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id: string, userId: string): Promise<void> {
    // First verify ownership
    const { data: position, error: fetchError } = await supabase
      .from('open_positions')
      .select('user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !position) {
      throw new Error('Position not found or access denied');
    }
    
    // Delete with user_id check for defense-in-depth
    const { error } = await supabase
      .from('open_positions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    
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
    
    // Calculate profit factor: ratio of average profit to average loss
    // Edge case: If all trades are winners (avgLoss = 0), profit factor is undefined
    // In this case, we return 0 to indicate we can't calculate a meaningful ratio
    // This represents a perfect trading record with no losses
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

  async create(userId: string, entry: Omit<TradeJournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'trade_id'> & { trade_id?: string | null }): Promise<TradeJournalEntry> {
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
      // Explicit null check: ensure messages array exists and is not empty
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
    // Input validation
    if (!title || title.trim().length === 0) {
      throw new Error('Title cannot be empty');
    }
    if (title.length > MAX_TITLE_LENGTH) {
      throw new Error(`Title too long. Maximum length is ${MAX_TITLE_LENGTH} characters.`);
    }
    
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
    // Input validation
    if (!content || content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`);
    }
    
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ user_id: userId, chat_id: chatId, role, content })
      .select()
      .single();
    
    if (error) throw error;

    // Update chat's updated_at timestamp
    try {
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);
    } catch (error) {
      // Log error but don't fail the message creation
      console.error('Failed to update chat timestamp:', error);
    }
    
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

// News API - for financial news articles
export const newsApi = {
  async getLatest(limit: number = 5): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .from('news_articles')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  },

  async getAll(): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .from('news_articles')
      .select('*')
      .order('published_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },
};

// The Eye Trade Engine API - for storing and retrieving snapshots from The Eye
export const eyeApi = {
  // Get the latest active snapshot for a user
  async getLatestSnapshot(userId: string): Promise<EyeSnapshot | null> {
    const { data, error } = await supabase
      .from('eye_snapshots')
      .select('*')
      .eq('user_id', userId)
      .eq('is_latest', true)
      .eq('is_active', true)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error) throw error;
    return data;
  },

  // Get all snapshots for a user
  async getAllSnapshots(userId: string): Promise<EyeSnapshot[]> {
    const { data, error } = await supabase
      .from('eye_snapshots')
      .select('*')
      .eq('user_id', userId)
      .order('snapshot_date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  // Create a new snapshot from The Eye data
  async createSnapshot(
    userId: string,
    snapshot: Omit<EyeSnapshot, 'id' | 'user_id' | 'created_at' | 'updated_at'> & {
      snapshot_name?: string | null;
      is_latest?: boolean;
    }
  ): Promise<EyeSnapshot> {
    const { data, error } = await supabase
      .from('eye_snapshots')
      .insert({
        ...snapshot,
        user_id: userId,
        is_latest: snapshot.is_latest ?? true, // Default to latest
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update a snapshot
  async updateSnapshot(id: string, userId: string, updates: Partial<EyeSnapshot>): Promise<EyeSnapshot> {
    // First verify ownership
    const { data: snapshot, error: fetchError } = await supabase
      .from('eye_snapshots')
      .select('user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !snapshot) {
      throw new Error('Snapshot not found or access denied');
    }
    
    // Update with user_id check for defense-in-depth
    const { data, error } = await supabase
      .from('eye_snapshots')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete a snapshot
  async deleteSnapshot(id: string, userId: string): Promise<void> {
    // First verify ownership
    const { data: snapshot, error: fetchError } = await supabase
      .from('eye_snapshots')
      .select('user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !snapshot) {
      throw new Error('Snapshot not found or access denied');
    }
    
    // Delete with user_id check for defense-in-depth
    const { error } = await supabase
      .from('eye_snapshots')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    
    if (error) throw error;
  },

  // Deactivate all snapshots for a user (disconnect The Eye)
  async deactivateAll(userId: string): Promise<void> {
    const { error } = await supabase
      .from('eye_snapshots')
      .update({ is_active: false, is_latest: false })
      .eq('user_id', userId);
    
    if (error) throw error;
  },
};

// Experience level type
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | null;

// Helper: Sanitize Eye data to remove all PII (only keep pure numerical metrics)
function sanitizeEyeData(eyeSnapshot: EyeSnapshot): Record<string, number | undefined> {
  return {
    portfolio_value: eyeSnapshot.portfolio_value ?? undefined,
    total_positions: eyeSnapshot.total_positions ?? undefined,
    total_trades: eyeSnapshot.total_trades ?? undefined,
    win_rate: eyeSnapshot.win_rate ?? undefined,
    total_pnl: eyeSnapshot.total_pnl ?? undefined,
    realized_pnl: eyeSnapshot.realized_pnl ?? undefined,
    unrealized_pnl: eyeSnapshot.unrealized_pnl ?? undefined,
    profit_factor: eyeSnapshot.profit_factor ?? undefined,
    avg_profit: eyeSnapshot.avg_profit ?? undefined,
    avg_loss: eyeSnapshot.avg_loss ?? undefined,
    // Explicitly exclude: user_id, snapshot_name, snapshot_date, raw_data, id, created_at, updated_at
  };
}

// Helper: Determine if question needs Deepseek quantitative analysis
function needsDeepAnalysis(message: string, eyeSnapshot: EyeSnapshot | null): boolean {
  if (!eyeSnapshot) return false;
  
  const complexAnalysisKeywords = [
    'analyze', 'analysis', 'pattern', 'patterns', 'trend', 'trends', 
    'correlation', 'statistical', 'statistics', 'performance analysis',
    'risk assessment', 'efficiency', 'optimization', 'optimize',
    'compare', 'comparison', 'benchmark', 'evaluate', 'evaluation'
  ];
  
  const messageLower = message.toLowerCase();
  const hasComplexKeywords = complexAnalysisKeywords.some(kw => 
    messageLower.includes(kw)
  );
  
  // Only use Deepseek for complex quantitative questions with data available
  return hasComplexKeywords;
}

// Generate system prompt based on user's experience level
// Note: experienceLevel can be null, which defaults to intermediate level
function getSystemPrompt(experienceLevel: ExperienceLevel, hasEyeData: boolean = false): string {
  // Default to intermediate if null
  const level = experienceLevel ?? 'intermediate';
  
  const baseRules = `
RESPONSE FORMAT (STRICT):
1. Be BRIEF. Give short, direct answers. Only elaborate when the topic genuinely requires depth.
2. DO NOT use markdown headers (no #, ##, ###). Write in plain paragraphs.
3. DO NOT overuse bullet points. Use them sparingly for actual lists only.
4. Write conversationally, like a knowledgeable friend. Not like a textbook.
5. If a simple answer works, give a simple answer. Don't pad responses.

TOPIC RULES:
6. ONLY discuss finance, investing, trading, economics, personal finance, and money management.
7. If asked about unrelated topics, politely decline and redirect to finance.
8. This is educational content. Users should consult licensed advisors for specific decisions.
9. Never give specific buy/sell recommendations for individual securities.
`;

  // Add The Eye rules based on whether data is available
  const eyeRules = hasEyeData ? `
THE EYE TRADE ENGINE (CONNECTED):
10. You have LIVE access to The Eye trade engine. The data below this prompt is REAL and CURRENT.
11. When answering about stocks, signals, prices, or market data - USE the data provided. It's real.
12. Always attribute market data to The Eye: "According to The Eye..." or "The Eye shows..."
13. Be confident. You HAVE the data. NEVER say "I don't have access" - because you DO have access right now.
14. The Eye tracks stocks, generates trading signals (BUY/SELL/HOLD), and monitors market news.
` : `
THE EYE TRADE ENGINE (NOT CONNECTED):
10. The Eye trade engine is currently not connected or offline.
11. For questions about live prices, signals, or market data - tell the user The Eye isn't connected.
12. Suggest checking if The Eye trade engine is running, or checking the Trading section of the app.
`;

  const allRules = baseRules + eyeRules;

  switch (level) {
    case 'beginner':
      return `You are a warm, encouraging Financial Teacher for beginners. Think of yourself as a supportive friend who happens to know about money.
Greet them warmly. Celebrate their curiosity. Use everyday language and relatable analogies (like comparing budgeting to a pizza you're sharing). Never make them feel dumb for asking basic questions. If they seem unsure, reassure them that everyone starts somewhere. Keep explanations short and digestible. Only go deeper if they ask.
${allRules}`;

    case 'intermediate':
      return `You are a knowledgeable Financial Advisor for intermediate investors.
Be direct and practical. Assume familiarity with basics (stocks, bonds, ETFs). Use technical terms naturally. Skip basic explanations unless asked.
${allRules}`;

    case 'advanced':
      return `You are an expert Financial Advisor for sophisticated investors.
Be concise and technical. Skip fundamentals entirely. Engage at an advanced level without hand-holding. Reference concepts directly.
${allRules}`;

    default:
      return `You are a helpful AI Financial Advisor.
Be clear and concise. Match your depth to the question complexity. Simple questions get simple answers.
${allRules}`;
  }
}

// Python Backend API endpoint helpers
// These can be configured to call your Python backend for AI responses, live market data, etc.
export const pythonApi = {
  // Analyze quantitative data using Deepseek (compliance-safe: only sends numerical data, no PII)
  async analyzeQuantitativeData(quantitativeData: Record<string, number | undefined>): Promise<string> {
    const deepseekApiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
    
    if (!deepseekApiKey) {
      throw new Error('Deepseek API key not configured');
    }

    // Filter out undefined values
    const sanitizedData = Object.fromEntries(
      Object.entries(quantitativeData).filter(([_, value]) => value !== undefined)
    );

    // If no data to analyze, return empty
    if (Object.keys(sanitizedData).length === 0) {
      return '';
    }

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `You are a quantitative financial data analyst. Analyze the provided trading metrics and provide insights, patterns, and recommendations based purely on the numbers. 

Focus on:
- Performance analysis (win rate, profit factor, average profit/loss)
- Risk assessment (portfolio value, positions, P&L breakdown)
- Statistical patterns and trends
- Trading efficiency metrics
- Actionable recommendations for improvement

Do NOT reference any user information, personal data, or identifiers. Only analyze the numerical data provided.`
            },
            {
              role: 'user',
              content: `Analyze these trading metrics:\n${JSON.stringify(sanitizedData, null, 2)}`
            }
          ],
          temperature: 0.3, // Lower for more analytical responses
          max_tokens: DEEPSEEK_MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Deepseek API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || 'Unable to analyze data.';
    } catch (error) {
      console.error('Error calling Deepseek API:', error);
      throw error;
    }
  },

  // Call OpenAI directly for AI chat response
  // Using gpt-4o-mini - best cost/performance model (cheapest while still being very capable)
  async getChatResponse(
    message: string, 
    userId: string, 
    experienceLevel?: ExperienceLevel,
    chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    _eyeSnapshot?: EyeSnapshot | null,  // Deprecated - using live data instead
    tradeEngineContext?: TradeEngineAIContext | null
  ): Promise<string> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/35f772b5-a839-4b22-9045-0f9af9ec78dd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:getChatResponse:entry',message:'getChatResponse called',data:{hasTradeEngineContext:!!tradeEngineContext,engineRunning:tradeEngineContext?.engine_status?.is_running,tickerCount:tradeEngineContext?.tracked_tickers?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // Input validation
    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`);
    }
    if (chatHistory && chatHistory.length > 100) {
      throw new Error(`Chat history too long. Maximum ${100} messages allowed.`);
    }
    
    const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
    
    const hasTradeEngineData = !!tradeEngineContext;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/35f772b5-a839-4b22-9045-0f9af9ec78dd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:getChatResponse:hasData',message:'Trade engine data check',data:{hasTradeEngineData,experienceLevel},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    const systemPrompt = getSystemPrompt(experienceLevel ?? null, hasTradeEngineData);
    
    // Build The Eye data context from LIVE Trade Engine connection
    let eyeDataContext = '';
    
    if (hasTradeEngineData && tradeEngineContext) {
      // Improved ticker extraction - handles "NVDA", "nvda", "How about NVDA", etc.
      const messageUpper = message.toUpperCase();
      // Try multiple patterns: word boundaries, standalone words, or common phrases
      const tickerPatterns = [
        /\b([A-Z]{1,5})\b/,  // Word boundary (original)
        /(?:about|for|on|with|regarding)\s+([A-Z]{1,5})\b/i,  // "about NVDA"
        /^([A-Z]{1,5})\s*$/,  // Standalone ticker
      ];
      
      let requestedTicker: string | null = null;
      for (const pattern of tickerPatterns) {
        const match = messageUpper.match(pattern);
        if (match && match[1] && match[1].length >= 2 && match[1].length <= 5) {
          requestedTicker = match[1];
          break;
        }
      }
      
      // Fallback: check if any word in message is a valid ticker format
      if (!requestedTicker) {
        const words = messageUpper.split(/\s+/);
        requestedTicker = words.find(word => 
          /^[A-Z]{2,5}$/.test(word) && 
          word.length >= 2 && 
          word.length <= 5
        ) || null;
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/35f772b5-a839-4b22-9045-0f9af9ec78dd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:buildContext',message:'Building context with ticker check',data:{requestedTicker,messagePreview:message.slice(0,50),totalSnapshots:tradeEngineContext.ticker_snapshots.length,trackedTickers:tradeEngineContext.tracked_tickers.length,hasNVDA:tradeEngineContext.tracked_tickers.includes('NVDA'),hasAAPL:tradeEngineContext.tracked_tickers.includes('AAPL')},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      // Find requested ticker in snapshots if mentioned
      let requestedTickerSnapshot = null;
      let requestedTickerSignal = null;
      let isTickerTracked = false;
      
      if (requestedTicker) {
        // Check if ticker is tracked
        isTickerTracked = tradeEngineContext.tracked_tickers.includes(requestedTicker);
        
        // Find in snapshots
        requestedTickerSnapshot = tradeEngineContext.ticker_snapshots.find(
          snap => snap.ticker.toUpperCase() === requestedTicker
        );
        
        // Fallback: find in signals if not in snapshots
        if (!requestedTickerSnapshot) {
          requestedTickerSignal = tradeEngineContext.recent_signals.find(
            sig => sig.ticker.toUpperCase() === requestedTicker
          );
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/35f772b5-a839-4b22-9045-0f9af9ec78dd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:findTicker',message:'Ticker search result',data:{requestedTicker,isTracked:isTickerTracked,foundInSnapshots:!!requestedTickerSnapshot,foundInSignals:!!requestedTickerSignal,hasPrice:!!requestedTickerSnapshot?.last_price,hasSignal:!!requestedTickerSnapshot?.latest_signal},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
      }
      
      // Helper function to format number with null handling
      const fmt = (val: number | null, decimals: number = 2, prefix: string = '', suffix: string = ''): string => {
        if (val === null || val === undefined) return 'N/A';
        return `${prefix}${val.toFixed(decimals)}${suffix}`;
      };
      
      // Helper function to format percentage
      const fmtPct = (val: number | null): string => {
        if (val === null || val === undefined) return 'N/A';
        return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
      };
      
      eyeDataContext = '\n\n=== THE EYE TRADE ENGINE - LIVE DATABASE ACCESS ===\n';
      eyeDataContext += `Data Generated: ${new Date(tradeEngineContext.generated_at).toLocaleString()}\n\n`;
      
      // Engine Status
      eyeDataContext += `Engine Status: ${tradeEngineContext.engine_status.is_running ? '🟢 RUNNING' : '🔴 STOPPED'}\n`;
      if (tradeEngineContext.engine_status.last_price_tick) {
        eyeDataContext += `Last Price Update: ${new Date(tradeEngineContext.engine_status.last_price_tick).toLocaleString()}\n`;
      }
      eyeDataContext += `Total Ticks Processed: ${tradeEngineContext.engine_status.total_ticks_processed.toLocaleString()}\n`;
      eyeDataContext += `Total News Fetched: ${tradeEngineContext.engine_status.total_news_fetched.toLocaleString()}\n`;
      
      // ============================================
      // TIER 1: REQUESTED TICKER (FULL DETAIL)
      // ============================================
      if (requestedTicker && requestedTickerSnapshot) {
        const snap = requestedTickerSnapshot;
        const companyName = snap.company_name || snap.ticker;
        
        eyeDataContext += `\n--- ${snap.ticker} DETAILED ANALYSIS (${companyName}) ---\n`;
        
        // Price Data
        eyeDataContext += `Price: ${fmt(snap.last_price, 2, '$')}`;
        if (snap.price_change_pct !== null) {
          eyeDataContext += ` (${fmtPct(snap.price_change_pct)})`;
          if (snap.price_change_abs !== null) {
            eyeDataContext += `, ${fmt(snap.price_change_abs, 2, '$')}`;
          }
        }
        eyeDataContext += '\n';
        
        if (snap.high_52w !== null || snap.low_52w !== null) {
          eyeDataContext += `52W Range: ${fmt(snap.low_52w, 2, '$')} - ${fmt(snap.high_52w, 2, '$')}\n`;
        }
        
        // Volume
        if (snap.volume !== null || snap.volume_ratio !== null) {
          const volStr = snap.volume ? `${(snap.volume / 1000000).toFixed(1)}M` : 'N/A';
          const volRatioStr = snap.volume_ratio ? `${snap.volume_ratio.toFixed(1)}x avg` : '';
          eyeDataContext += `Volume: ${volStr}${volRatioStr ? ` (${volRatioStr})` : ''}`;
          if (snap.volume_ratio && snap.volume_ratio > 1.5) {
            eyeDataContext += ' ← Unusual volume activity';
          }
          eyeDataContext += '\n';
        }
        
        // Moving Averages
        const hasSMA = snap.sma_10 !== null || snap.sma_20 !== null || snap.sma_50 !== null || snap.sma_100 !== null || snap.sma_200 !== null;
        const hasEMA = snap.ema_10 !== null || snap.ema_20 !== null || snap.ema_50 !== null || snap.ema_200 !== null;
        
        if (hasSMA || hasEMA) {
          eyeDataContext += '\nMoving Averages:\n';
          if (hasSMA) {
            const smaParts: string[] = [];
            if (snap.sma_10 !== null) smaParts.push(`SMA 10: ${fmt(snap.sma_10, 2, '$')}`);
            if (snap.sma_20 !== null) smaParts.push(`SMA 20: ${fmt(snap.sma_20, 2, '$')}`);
            if (snap.sma_50 !== null) smaParts.push(`SMA 50: ${fmt(snap.sma_50, 2, '$')}`);
            if (snap.sma_100 !== null) smaParts.push(`SMA 100: ${fmt(snap.sma_100, 2, '$')}`);
            if (snap.sma_200 !== null) smaParts.push(`SMA 200: ${fmt(snap.sma_200, 2, '$')}`);
            if (smaParts.length > 0) eyeDataContext += `  ${smaParts.join(' | ')}\n`;
          }
          if (hasEMA) {
            const emaParts: string[] = [];
            if (snap.ema_10 !== null) emaParts.push(`EMA 10: ${fmt(snap.ema_10, 2, '$')}`);
            if (snap.ema_20 !== null) emaParts.push(`EMA 20: ${fmt(snap.ema_20, 2, '$')}`);
            if (snap.ema_50 !== null) emaParts.push(`EMA 50: ${fmt(snap.ema_50, 2, '$')}`);
            if (snap.ema_200 !== null) emaParts.push(`EMA 200: ${fmt(snap.ema_200, 2, '$')}`);
            if (emaParts.length > 0) eyeDataContext += `  ${emaParts.join(' | ')}\n`;
          }
          
          // Price Position
          const positionParts: string[] = [];
          if (snap.price_vs_sma_50 !== null) positionParts.push(`${fmtPct(snap.price_vs_sma_50)} above SMA 50`);
          if (snap.price_vs_sma_200 !== null) {
            positionParts.push(`${fmtPct(snap.price_vs_sma_200)} above SMA 200`);
            if (snap.is_bullish) positionParts.push('(BULLISH trend)');
          }
          if (positionParts.length > 0) {
            eyeDataContext += `  Price Position: ${positionParts.join(', ')}\n`;
          }
        }
        
        // Momentum Indicators
        const hasMomentum = snap.rsi_14 !== null || snap.rsi_9 !== null || snap.macd !== null || 
                           snap.stochastic_k !== null || snap.williams_r !== null || snap.cci !== null;
        if (hasMomentum) {
          eyeDataContext += '\nMomentum:\n';
          if (snap.rsi_14 !== null) {
            const rsiStatus = snap.rsi_14 < 30 ? 'oversold' : snap.rsi_14 > 70 ? 'overbought' : 'neutral, not overbought';
            eyeDataContext += `  RSI(14): ${fmt(snap.rsi_14, 1)} (${rsiStatus})\n`;
          }
          if (snap.rsi_9 !== null) eyeDataContext += `  RSI(9): ${fmt(snap.rsi_9, 1)} (short-term momentum)\n`;
          if (snap.macd !== null || snap.macd_signal !== null || snap.macd_histogram !== null) {
            const macdParts: string[] = [];
            if (snap.macd !== null) macdParts.push(`MACD: ${fmt(snap.macd, 2)}`);
            if (snap.macd_signal !== null) macdParts.push(`Signal: ${fmt(snap.macd_signal, 2)}`);
            if (snap.macd_histogram !== null) {
              const histStatus = snap.macd_histogram > 0 ? 'positive, bullish momentum' : 'negative';
              macdParts.push(`Hist: ${fmt(snap.macd_histogram, 2)} (${histStatus})`);
            }
            if (macdParts.length > 0) eyeDataContext += `  ${macdParts.join(' | ')}\n`;
          }
          if (snap.stochastic_k !== null || snap.stochastic_d !== null) {
            eyeDataContext += `  Stochastic: K=${fmt(snap.stochastic_k, 1)}, D=${fmt(snap.stochastic_d, 1)}\n`;
          }
          if (snap.williams_r !== null) eyeDataContext += `  Williams %R: ${fmt(snap.williams_r, 1)}\n`;
          if (snap.cci !== null) eyeDataContext += `  CCI: ${fmt(snap.cci, 1)}\n`;
        }
        
        // Volatility Indicators
        if (snap.bollinger_upper !== null || snap.bollinger_middle !== null || snap.bollinger_lower !== null || snap.atr !== null) {
          eyeDataContext += '\nVolatility:\n';
          if (snap.bollinger_upper !== null || snap.bollinger_middle !== null || snap.bollinger_lower !== null) {
            eyeDataContext += `  Bollinger: Upper ${fmt(snap.bollinger_upper, 2, '$')} | Middle ${fmt(snap.bollinger_middle, 2, '$')} | Lower ${fmt(snap.bollinger_lower, 2, '$')}\n`;
            if (snap.last_price !== null && snap.bollinger_middle !== null) {
              const dist = ((snap.last_price - snap.bollinger_middle) / snap.bollinger_middle) * 100;
              if (Math.abs(dist) < 2) eyeDataContext += '  Price is near middle band (normal volatility)\n';
              else if (dist > 0) eyeDataContext += '  Price is above middle band\n';
              else eyeDataContext += '  Price is below middle band\n';
            }
          }
          if (snap.atr !== null) eyeDataContext += `  ATR: ${fmt(snap.atr, 2, '$')} (volatility measure)\n`;
        }
        
        // Trend Indicators
        if (snap.adx !== null) {
          eyeDataContext += '\nTrend:\n';
          const trendStrength = snap.adx > 25 ? 'strong trend' : 'weak trend';
          eyeDataContext += `  ADX: ${fmt(snap.adx, 1)} (${trendStrength})\n`;
        }
        
        // Fundamental Data
        const hasFundamentals = snap.pe_ratio !== null || snap.forward_pe !== null || snap.peg_ratio !== null ||
                               snap.price_to_book !== null || snap.price_to_sales !== null || snap.dividend_yield !== null ||
                               snap.market_cap !== null || snap.eps !== null || snap.eps_growth !== null || snap.revenue_growth !== null;
        if (hasFundamentals) {
          eyeDataContext += '\nFundamentals:\n';
          if (snap.pe_ratio !== null) {
            const peNote = snap.pe_ratio < 20 ? ' (reasonable)' : snap.pe_ratio < 30 ? ' (moderate)' : ' (high)';
            eyeDataContext += `  P/E: ${fmt(snap.pe_ratio, 1)}${peNote}\n`;
          }
          if (snap.forward_pe !== null) eyeDataContext += `  Forward P/E: ${fmt(snap.forward_pe, 1)}${snap.forward_pe < snap.pe_ratio ? ' (improving)' : ''}\n`;
          if (snap.peg_ratio !== null) eyeDataContext += `  PEG: ${fmt(snap.peg_ratio, 2)}\n`;
          if (snap.price_to_book !== null) eyeDataContext += `  P/B: ${fmt(snap.price_to_book, 1)}\n`;
          if (snap.price_to_sales !== null) eyeDataContext += `  P/S: ${fmt(snap.price_to_sales, 1)}\n`;
          if (snap.dividend_yield !== null) eyeDataContext += `  Dividend Yield: ${fmt(snap.dividend_yield, 2)}%\n`;
          if (snap.market_cap !== null) {
            const capStr = snap.market_cap >= 1e12 ? `${(snap.market_cap / 1e12).toFixed(1)}T` :
                          snap.market_cap >= 1e9 ? `${(snap.market_cap / 1e9).toFixed(1)}B` :
                          snap.market_cap >= 1e6 ? `${(snap.market_cap / 1e6).toFixed(1)}M` : `${snap.market_cap.toFixed(0)}`;
            eyeDataContext += `  Market Cap: $${capStr}\n`;
          }
          if (snap.eps !== null) eyeDataContext += `  EPS: ${fmt(snap.eps, 2, '$')}\n`;
          if (snap.eps_growth !== null) eyeDataContext += `  EPS Growth: ${fmt(snap.eps_growth, 1)}%\n`;
          if (snap.revenue_growth !== null) eyeDataContext += `  Revenue Growth: ${fmt(snap.revenue_growth, 1)}%\n`;
        }
        
        // Signal
        if (snap.latest_signal) {
          const confStr = snap.signal_confidence ? `${(snap.signal_confidence * 100).toFixed(0)}%` : 'N/A';
          const timeStr = snap.signal_timestamp ? new Date(snap.signal_timestamp).toLocaleString() : 'N/A';
          eyeDataContext += `\nSignal: ${snap.latest_signal}${snap.signal_strategy ? ` (${snap.signal_strategy})` : ''}, ${confStr} confidence @ ${timeStr}\n`;
        }
      } else if (requestedTicker && isTickerTracked) {
        // Tracked but no snapshot
        eyeDataContext += `\n--- ${requestedTicker} STATUS ---\n`;
        eyeDataContext += `${requestedTicker}: TRACKED (no current snapshot data)\n`;
        if (requestedTickerSignal) {
          eyeDataContext += `Recent Signal: ${requestedTickerSignal.signal} (${requestedTickerSignal.strategy}) @ ${new Date(requestedTickerSignal.timestamp).toLocaleString()}\n`;
        }
      }
      
      // ============================================
      // TIER 2: TOP 50 ACTIVE TICKERS (COMPACT)
      // ============================================
      if (tradeEngineContext.ticker_snapshots.length > 0) {
        // Sort by volume (descending), then filter out requested ticker if shown
        const otherSnapshots = requestedTickerSnapshot
          ? tradeEngineContext.ticker_snapshots.filter(snap => snap.ticker.toUpperCase() !== requestedTicker)
          : tradeEngineContext.ticker_snapshots;
        
        // Sort by volume ratio or volume, then take top 50
        const sortedByVolume = [...otherSnapshots].sort((a, b) => {
          const volA = a.volume_ratio || (a.volume || 0);
          const volB = b.volume_ratio || (b.volume || 0);
          return volB - volA;
        });
        
        const top50 = sortedByVolume.slice(0, 50);
        
        if (top50.length > 0) {
          eyeDataContext += `\n--- TOP ${top50.length} ACTIVE TICKERS (by volume) ---\n`;
          top50.forEach(snap => {
            const priceStr = snap.last_price ? `$${snap.last_price.toFixed(2)}` : 'N/A';
            const volStr = snap.volume ? `${(snap.volume / 1000000).toFixed(1)}M` : 'N/A';
            const volRatioStr = snap.volume_ratio ? `(${snap.volume_ratio.toFixed(1)}x)` : '';
            const rsiStr = snap.rsi_14 !== null ? snap.rsi_14.toFixed(0) : 'N/A';
            const peStr = snap.pe_ratio !== null ? snap.pe_ratio.toFixed(1) : 'N/A';
            const signalStr = snap.latest_signal || 'N/A';
            eyeDataContext += `${snap.ticker.padEnd(6)}: ${priceStr.padStart(10)} | Vol: ${volStr.padStart(8)} ${volRatioStr.padStart(8)} | RSI: ${rsiStr.padStart(3)} | P/E: ${peStr.padStart(5)} | Signal: ${signalStr}\n`;
          });
        }
      }
      
      // ============================================
      // TIER 3: ALL TICKERS WITH SIGNALS
      // ============================================
      const tickersWithSignals = tradeEngineContext.ticker_snapshots.filter(snap => snap.latest_signal && snap.latest_signal !== 'HOLD');
      if (tickersWithSignals.length > 0) {
        eyeDataContext += `\n--- ALL TICKERS WITH ACTIVE SIGNALS (${tickersWithSignals.length}) ---\n`;
        tickersWithSignals.forEach(snap => {
          const confStr = snap.signal_confidence ? `${(snap.signal_confidence * 100).toFixed(0)}%` : 'N/A';
          const priceStr = snap.last_price ? `$${snap.last_price.toFixed(2)}` : 'N/A';
          const rsiStr = snap.rsi_14 !== null ? snap.rsi_14.toFixed(0) : 'N/A';
          const peStr = snap.pe_ratio !== null ? snap.pe_ratio.toFixed(1) : 'N/A';
          const strategyStr = snap.signal_strategy || 'N/A';
          eyeDataContext += `${snap.ticker.padEnd(6)}: ${snap.latest_signal.padEnd(11)} | Conf: ${confStr.padStart(4)} | Price: ${priceStr.padStart(10)} | RSI: ${rsiStr.padStart(3)} | P/E: ${peStr.padStart(5)} | Strategy: ${strategyStr}\n`;
        });
      }
      
      // ============================================
      // TIER 4: MARKET SUMMARY (AGGREGATED)
      // ============================================
      eyeDataContext += `\n--- MARKET SUMMARY (ALL ${tradeEngineContext.summary.total_tracked_tickers} TRACKED TICKERS) ---\n`;
      
      // Coverage
      eyeDataContext += 'Coverage:\n';
      eyeDataContext += `  Tickers with price data: ${tradeEngineContext.summary.tickers_with_data}/${tradeEngineContext.summary.total_tracked_tickers} (${Math.round(tradeEngineContext.summary.tickers_with_data / tradeEngineContext.summary.total_tracked_tickers * 100)}%)\n`;
      if (tradeEngineContext.summary.tickers_with_indicators !== null) {
        eyeDataContext += `  Tickers with indicators: ${tradeEngineContext.summary.tickers_with_indicators}/${tradeEngineContext.summary.total_tracked_tickers} (${Math.round(tradeEngineContext.summary.tickers_with_indicators / tradeEngineContext.summary.total_tracked_tickers * 100)}%)\n`;
      }
      if (tradeEngineContext.summary.tickers_with_fundamentals !== null) {
        eyeDataContext += `  Tickers with fundamentals: ${tradeEngineContext.summary.tickers_with_fundamentals}/${tradeEngineContext.summary.total_tracked_tickers} (${Math.round(tradeEngineContext.summary.tickers_with_fundamentals / tradeEngineContext.summary.total_tracked_tickers * 100)}%)\n`;
      }
      
      // Market Health
      eyeDataContext += '\nMarket Health:\n';
      if (tradeEngineContext.summary.average_rsi !== null) {
        const rsiStatus = tradeEngineContext.summary.average_rsi < 30 ? 'oversold' : 
                         tradeEngineContext.summary.average_rsi > 70 ? 'overbought' : 'neutral';
        eyeDataContext += `  Average RSI: ${tradeEngineContext.summary.average_rsi.toFixed(1)} (${rsiStatus})\n`;
      }
      if (tradeEngineContext.summary.average_pe_ratio !== null) {
        eyeDataContext += `  Average P/E: ${tradeEngineContext.summary.average_pe_ratio.toFixed(1)}\n`;
      }
      if (tradeEngineContext.summary.bullish_tickers !== null || tradeEngineContext.summary.bearish_tickers !== null) {
        const bullish = tradeEngineContext.summary.bullish_tickers || 0;
        const bearish = tradeEngineContext.summary.bearish_tickers || 0;
        const total = bullish + bearish;
        if (total > 0) {
          eyeDataContext += `  Bullish (above SMA 200): ${bullish} tickers (${Math.round(bullish / total * 100)}%)\n`;
          eyeDataContext += `  Bearish (below SMA 200): ${bearish} tickers (${Math.round(bearish / total * 100)}%)\n`;
        }
      }
      if (tradeEngineContext.summary.oversold_tickers !== null) {
        eyeDataContext += `  Oversold (RSI < 30): ${tradeEngineContext.summary.oversold_tickers} tickers\n`;
      }
      if (tradeEngineContext.summary.overbought_tickers !== null) {
        eyeDataContext += `  Overbought (RSI > 70): ${tradeEngineContext.summary.overbought_tickers} tickers\n`;
      }
      
      // Activity
      eyeDataContext += '\nActivity:\n';
      if (tradeEngineContext.summary.high_volume_tickers && tradeEngineContext.summary.high_volume_tickers.length > 0) {
        eyeDataContext += `  High Volume (ratio > 1.5): ${tradeEngineContext.summary.high_volume_tickers.length} tickers\n`;
      }
      eyeDataContext += `  Active Signals (48h): ${tradeEngineContext.summary.signals_last_24h} tickers\n`;
      eyeDataContext += `  Recent News: ${tradeEngineContext.summary.news_count} articles\n`;
      
      // Recent Signals (if not already shown in Tier 1)
      if (tradeEngineContext.recent_signals.length > 0 && !requestedTicker) {
        eyeDataContext += `\n--- RECENT TRADING SIGNALS (Sample) ---\n`;
        tradeEngineContext.recent_signals.slice(0, 12).forEach(sig => {
          const time = new Date(sig.timestamp).toLocaleString();
          const confidence = sig.confidence ? `${(sig.confidence * 100).toFixed(0)}%` : 'N/A';
          eyeDataContext += `${sig.ticker}: ${sig.signal.padEnd(11)} (${sig.strategy}, ${confidence} conf) @ ${time}\n`;
        });
        if (tradeEngineContext.recent_signals.length > 12) {
          eyeDataContext += `... and ${tradeEngineContext.recent_signals.length - 12} more signals\n`;
        }
      }
      
      // Market News
      if (tradeEngineContext.recent_news.length > 0) {
        eyeDataContext += `\n--- MARKET NEWS (${tradeEngineContext.recent_news.length} recent) ---\n`;
        tradeEngineContext.recent_news.slice(0, 8).forEach(news => {
          eyeDataContext += `• ${news.headline}`;
          if (news.source) eyeDataContext += ` (${news.source})`;
          if (news.related_tickers) eyeDataContext += ` [${news.related_tickers}]`;
          eyeDataContext += '\n';
        });
      }
      
      eyeDataContext += '\n=== END LIVE TRADE ENGINE DATA ===\n';
      eyeDataContext += '\nIMPORTANT: The data above is REAL and LIVE from The Eye. When the user asks about stocks, signals, or market data, use this data confidently. Say "According to The Eye..." or "The Eye shows..." - DO NOT say you lack access to data.\n';
    } else {
      // No Trade Engine connection
      eyeDataContext += '\n\n[The Eye Trade Engine is currently offline or not connected. Tell the user The Eye is not available right now and suggest checking if it\'s running.]\n';
    }
    
    // Build messages array with conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: systemPrompt + eyeDataContext
      }
    ];
    
    // Add conversation history (last N messages to stay within token limits)
    if (chatHistory && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-MAX_CHAT_HISTORY_MESSAGES);
      messages.push(...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    }
    
    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });
    
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
            messages: messages,
            temperature: 0.7,
            max_tokens: OPENAI_MAX_TOKENS,
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `OpenAI API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        // Explicit null check with fallback
        const content = data.choices?.[0]?.message?.content;
        if (!content || typeof content !== 'string') {
          return 'I apologize, but I encountered an error processing your request.';
        }
        return content;
      } catch (error: unknown) {
        console.error('Error calling OpenAI API:', error);
        // Fallback to Python backend if configured
        if (pythonBackendUrl) {
          try {
            return await this.getChatResponseFromPython(message, userId);
          } catch (fallbackError) {
            console.error('Python backend fallback also failed:', fallbackError);
            return 'I apologize, but the AI service is currently unavailable. Please check your API configuration.';
          }
        }
        return 'I apologize, but the AI service is currently unavailable. Please check your OpenAI API key configuration.';
      }
    }
    
    // Option 2: Use Python backend if configured (fallback)
    if (pythonBackendUrl) {
      try {
        return await this.getChatResponseFromPython(message, userId);
      } catch (error) {
        console.error('Error calling Python backend:', error);
        return 'I apologize, but the AI service is currently unavailable.';
      }
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
          max_tokens: 20, // Small token limit for title generation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to generate title');
      }

      const data = await response.json();
      const title = data.choices?.[0]?.message?.content?.trim();
      // Explicit null check with fallback
      if (!title || typeof title !== 'string') {
        return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
      }
      return title;
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

// Trade Engine REST API - Direct connection to TheEyeBetaLocal backend
export interface TradeEngineNewsItem {
  id: number;
  ticker: string | null;
  headline: string;
  summary: string | null;
  source: string | null;
  url: string | null;
  published_at: string;
  sentiment_score: number | null;
}

export interface TradeEngineTechnicalIndicators {
  ticker: string;
  date: string;
  sma_10: number | null;
  sma_50: number | null;
  sma_200: number | null;
  rsi_14: number | null;
  macd: number | null;
}

export interface TradeEnginePriceData {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export const tradeEngineApi = {
  baseUrl: import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000',

  // Fetch news from Trade Engine
  async getNews(limit: number = 15, cursor?: string): Promise<{ items: TradeEngineNewsItem[]; next_cursor: string | null }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.append('cursor', cursor);
    
    const response = await fetch(`${this.baseUrl}/api/news?${params}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Fetch technical indicators for a ticker
  async getTechnicalIndicators(ticker: string, date?: string): Promise<TradeEngineTechnicalIndicators> {
    const params = date ? `?date=${date}` : '';
    const response = await fetch(`${this.baseUrl}/api/v1/indicators/${ticker}/technical${params}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Fetch price data for charting
  async getPriceData(ticker: string, startDate?: string, endDate?: string, limit: number = 100): Promise<TradeEnginePriceData[]> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await fetch(`${this.baseUrl}/api/v1/charting/${ticker}/prices?${params}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Get list of available tickers
  async getTickers(activeOnly: boolean = true): Promise<Array<{ ticker_id: number; ticker: string; name: string }>> {
    const response = await fetch(`${this.baseUrl}/api/v1/tickers?active_only=${activeOnly}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Health check
  async healthCheck(): Promise<{ status: string; healthy: boolean }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      return { status: 'error', healthy: false };
    }
    return response.json();
  },

  // ============================================================
  // AI Context API - Get comprehensive data for AI chatbot
  // ============================================================

  // Get full AI context (engine status, snapshots, signals, news)
  async getAIContext(includeNews: boolean = true, newsLimit: number = 10, signalsHours: number = 24): Promise<TradeEngineAIContext> {
    const params = new URLSearchParams({
      include_news: includeNews.toString(),
      news_limit: newsLimit.toString(),
      signals_hours: signalsHours.toString(),
    });
    
    const response = await fetch(`${this.baseUrl}/api/v1/ai/context?${params}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Get recent trading signals
  async getSignals(ticker?: string, signalType?: string, hours: number = 24, limit: number = 50): Promise<TradeEngineSignal[]> {
    const params = new URLSearchParams({
      hours: hours.toString(),
      limit: limit.toString(),
    });
    if (ticker) params.append('ticker', ticker);
    if (signalType) params.append('signal_type', signalType);
    
    const response = await fetch(`${this.baseUrl}/api/v1/ai/signals?${params}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Get portfolio summary
  async getPortfolioSummary(): Promise<TradeEnginePortfolioSummary> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/portfolio`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },

  // Get detailed ticker info
  async getTickerDetails(ticker: string): Promise<TradeEngineTickerDetails> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/ticker/${ticker}`);
    if (!response.ok) {
      throw new Error(`Trade Engine API error: ${response.statusText}`);
    }
    return response.json();
  },
};

// AI Context Types
export interface TradeEngineSignal {
  ticker: string;
  company_name: string | null;
  signal: 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY' | 'STRONG_SELL';
  strategy: string;
  confidence: number | null;
  timestamp: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
}

export interface TradeEngineTickerSnapshot {
  // ============================================
  // BASIC PRICE DATA
  // ============================================
  ticker: string;
  company_name: string | null;
  last_price: number | null;
  price_change_pct: number | null;
  price_change_abs: number | null;
  high_52w: number | null;
  low_52w: number | null;
  updated_at: string | null;
  
  // ============================================
  // VOLUME DATA
  // ============================================
  volume: number | null;
  avg_volume_10d: number | null;
  avg_volume_30d: number | null;
  volume_ratio: number | null;
  
  // ============================================
  // SIMPLE MOVING AVERAGES (SMA)
  // ============================================
  sma_10: number | null;
  sma_20: number | null;
  sma_50: number | null;
  sma_100: number | null;
  sma_200: number | null;
  
  // ============================================
  // EXPONENTIAL MOVING AVERAGES (EMA)
  // ============================================
  ema_10: number | null;
  ema_20: number | null;
  ema_50: number | null;
  ema_200: number | null;
  
  // ============================================
  // MOMENTUM INDICATORS
  // ============================================
  rsi_14: number | null;
  rsi_9: number | null;
  stochastic_k: number | null;
  stochastic_d: number | null;
  williams_r: number | null;
  cci: number | null;
  
  // ============================================
  // TREND INDICATORS
  // ============================================
  macd: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  adx: number | null;
  
  // ============================================
  // VOLATILITY INDICATORS
  // ============================================
  bollinger_upper: number | null;
  bollinger_middle: number | null;
  bollinger_lower: number | null;
  atr: number | null;
  
  // ============================================
  // FUNDAMENTAL DATA
  // ============================================
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
  
  // ============================================
  // SIGNAL DATA
  // ============================================
  latest_signal: string | null;
  signal_strategy: string | null;
  signal_confidence: number | null;
  signal_timestamp: string | null;
  
  // ============================================
  // DERIVED METRICS
  // ============================================
  price_vs_sma_50: number | null;
  price_vs_sma_200: number | null;
  price_vs_ema_50: number | null;
  price_vs_ema_200: number | null;
  price_vs_bollinger_middle: number | null;
  is_bullish: boolean | null;
  is_oversold: boolean | null;
  is_overbought: boolean | null;
}

export interface TradeEngineEngineStatus {
  is_running: boolean;
  engine_started_at: string | null;
  last_price_tick: string | null;
  last_news_poll: string | null;
  total_ticks_processed: number;
  total_news_fetched: number;
  active_workers: Record<string, boolean>;
}

export interface TradeEngineAIContext {
  generated_at: string;
  engine_status: TradeEngineEngineStatus;
  tracked_tickers: string[];
  ticker_snapshots: TradeEngineTickerSnapshot[];
  recent_signals: TradeEngineSignal[];
  recent_news: Array<{
    headline: string;
    source: string | null;
    category: string | null;
    published_at: string;
    related_tickers: string | null;
  }>;
  summary: {
    // Coverage metrics
    total_tracked_tickers: number;
    tickers_with_data: number;
    tickers_with_indicators: number | null;
    tickers_with_fundamentals: number | null;
    
    // Signal counts
    buy_signals_count: number;
    sell_signals_count: number;
    hold_signals_count: number;
    tickers_with_buy: string[];
    tickers_with_sell: string[];
    
    // Market health indicators
    average_rsi: number | null;
    average_pe_ratio: number | null;
    bullish_tickers: number | null;
    bearish_tickers: number | null;
    oversold_tickers: number | null;
    overbought_tickers: number | null;
    
    // Activity metrics
    signals_last_24h: number;
    news_count: number;
    high_volume_tickers: string[] | null;
  };
}

export interface TradeEnginePortfolioSummary {
  total_tickers: number;
  tickers_with_buy_signals: string[];
  tickers_with_sell_signals: string[];
  average_rsi: number | null;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
}

export interface TradeEngineTickerDetails {
  ticker: string;
  name: string;
  snapshot: TradeEngineTickerSnapshot | null;
  recent_signals: TradeEngineSignal[];
  price_history: Array<{
    timestamp: string;
    price: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
}
