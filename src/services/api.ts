import { supabase } from '@/lib/supabase';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
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
  StockSnapshot,
} from '@/types/database';

// Constants for input validation and API configuration
const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;
const MAX_CHAT_HISTORY_MESSAGES = 30;
const OPENAI_MAX_TOKENS = 2000;
const OPENAI_CHAT_TEMPERATURE = 0.7;

// Web Search Intent Detection
// NOTE: Web search is ONLY for news and general knowledge
// Quantitative data (prices, indicators, signals) comes from The Eye database
interface SearchIntent {
  shouldSearch: boolean;
  searchQuery: string | null;
  intentType: 'news' | 'general' | 'none';
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
}

/**
 * Detect if the user's message requires a web search.
 *
 * IMPORTANT: Web search is used for:
 * - News (why is stock dropping, latest headlines, what's happening)
 * - General knowledge (what is a P/E ratio, how does Fed affect markets)
 * - General real-world price lookups (e.g., "price of a boat")
 * - Current events (Fed decisions, earnings announcements)
 *
 * NOT used for:
 * - Stock prices (from The Eye database)
 * - Technical indicators (from The Eye database)
 * - Trading signals (from Trade Engine)
 */
function detectSearchIntent(message: string): SearchIntent {
  const msgUpper = message.toUpperCase();
  const financeTopicPattern = /\b(finance|financial|invest|investment|investing|stock|stocks|equity|etf|mutual fund|bond|bonds|portfolio|trading|trade|market|markets|economy|economic|inflation|interest rate|fed|federal reserve|gdp|earnings|sec|tax|taxes|budget|debt|loan|mortgage|retirement|savings|cash flow|net worth|asset allocation|risk|dividend)\b/i;
  const marketAssetPattern = /\b(stock|stocks|share|shares|ticker|quote|crypto|bitcoin|btc|eth|forex|etf|index)\b/i;

  // News-related patterns - things that require current events/news
  const newsPatterns = [
    /(?:latest|recent|breaking|today(?:'s)?|current)\s+(?:news|headlines|updates|developments)/i,
    /what(?:'s| is)\s+(?:happening|going on)\s+(?:with|to|at)/i,
    /(?:news|headlines|updates)\s+(?:about|on|for|regarding)/i,
    /(?:any|what)\s+news\s+(?:on|about|for)/i,
    /why\s+(?:is|did|has|are)\s+.+\s+(?:going|dropping|rising|falling|crashing|surging|up|down|tanking|mooning|rallying)/i,
    /what\s+(?:caused|happened|is happening)/i,
  ];

  // General knowledge patterns - educational/informational queries
  const generalPatterns = [
    /(?:search|look up|find|google)\s+(?:for\s+)?/i,
    /(?:can you|could you|please)\s+(?:search|look up|find|browse)/i,
    /(?:what|who|when|where)\s+(?:is|are|was|were)\s+(?:the\s+)?(?:fed|federal reserve|sec|congress|government)/i,
    /(?:latest|recent)\s+(?:fed|federal reserve|interest rate|inflation|gdp|economic)/i,
    /(?:earnings|quarterly results|annual report)\s+(?:for|of|announcement)/i,
  ];

  // General price lookup patterns (non-market items/services)
  const pricePatterns = [
    /(?:what(?:'s| is)\s+the\s+(?:price|cost)\s+(?:of|for)\s+)(.+?)(?:\?|$|\.)/i,
    /(?:price|cost|value|worth)\s+(?:of|for)\s+(.+?)(?:\?|$|\.)/i,
    /how much (?:is|does)\s+(.+?)\s+(?:cost|worth|go for)(?:\?|$|\.)/i,
  ];

  // Check for news intent (why is X dropping, what's happening with Y)
  for (const pattern of newsPatterns) {
    if (pattern.test(message)) {
      // Extract the subject of the news query
      const tickerMatch = msgUpper.match(/\b([A-Z]{2,5})\b/);
      const subjectMatch = message.match(/(?:news|headlines|happening|going on)\s+(?:about|on|for|with|to|at)\s+([A-Za-z\s]+?)(?:\?|$|\.)/i);
      const whyMatch = message.match(/why\s+(?:is|did|has|are)\s+([A-Za-z\s]+?)\s+(?:going|dropping|rising|falling|crashing|surging|up|down|tanking|mooning|rallying)/i);

      const searchSubject = tickerMatch?.[1] || subjectMatch?.[1]?.trim() || whyMatch?.[1]?.trim() || '';
      if (searchSubject) {
        return {
          shouldSearch: true,
          searchQuery: `${searchSubject} stock news today`,
          intentType: 'news',
        };
      }

      // Generic news search
      return {
        shouldSearch: true,
        searchQuery: message.replace(/(?:what(?:'s| is)|tell me|show me|find)/gi, '').trim(),
        intentType: 'news',
      };
    }
  }

  // Check for general price lookup intent (e.g., "price of a boat")
  // Keep stock/market pricing queries on The Eye data path.
  const isLikelyMarketAssetQuery = marketAssetPattern.test(message);
  if (!isLikelyMarketAssetQuery) {
    for (const pattern of pricePatterns) {
      const match = message.match(pattern);
      const subject = match?.[1]?.trim();
      if (subject) {
        return {
          shouldSearch: true,
          searchQuery: `${subject} price in USD`,
          intentType: 'general',
        };
      }
    }
  }

  // Check for general search intent (explicit search requests, Fed info, etc.)
  for (const pattern of generalPatterns) {
    if (pattern.test(message)) {
      // Extract the search query
      const searchMatch = message.match(/(?:search|look up|find|google|browse)\s+(?:for\s+)?(.+?)(?:\?|$|\.)/i);
      const extractedQuery = searchMatch?.[1]?.trim() || message.trim();
      const hasPriceCue = /\b(price|cost|worth|value|how much)\b/i.test(extractedQuery);
      const isFinanceRelated = financeTopicPattern.test(extractedQuery);
      const isMarketAsset = marketAssetPattern.test(extractedQuery);

      // Allow finance searches.
      if (isFinanceRelated) {
        return {
          shouldSearch: true,
          searchQuery: extractedQuery,
          intentType: 'general',
        };
      }

      // Allow non-market object price lookup searches.
      if (hasPriceCue && !isMarketAsset) {
        return {
          shouldSearch: true,
          searchQuery: `${extractedQuery} in USD`,
          intentType: 'general',
        };
      }
    }
  }

  // No search needed
  return {
    shouldSearch: false,
    searchQuery: null,
    intentType: 'none',
  };
}

/**
 * Perform a web search using the backend API.
 * Returns search results or null if search fails.
 */
async function performWebSearch(query: string, maxResults: number = 5): Promise<WebSearchResponse | null> {
  const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;

  if (!pythonBackendUrl) {
    console.log('[WebSearch] Backend URL not configured');
    return null;
  }

  try {
    const params = new URLSearchParams({
      query,
      max_results: maxResults.toString(),
    });

    const response = await fetch(`${pythonBackendUrl}/api/search?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.log('[WebSearch] Search endpoint returned error:', response.status);
      return null;
    }

    const data: WebSearchResponse = await response.json();
    console.log('[WebSearch] Found', data.results?.length || 0, 'results for:', query);
    return data;
  } catch (error) {
    console.log('[WebSearch] Search failed:', error);
    return null;
  }
}

/**
 * Format web search results for inclusion in AI context.
 */
function formatSearchResultsForAI(searchResponse: WebSearchResponse, intentType: 'news' | 'general'): string {
  if (!searchResponse.results || searchResponse.results.length === 0) {
    return '';
  }

  let context = '\n\n=== WEB SEARCH RESULTS ===\n';
  context += `Search Query: "${searchResponse.query}"\n`;
  context += `Results Found: ${searchResponse.results.length}\n\n`;

  if (intentType === 'news') {
    context += 'NEWS FROM WEB:\n';
  } else {
    context += 'SEARCH RESULTS:\n';
  }

  searchResponse.results.forEach((result, index) => {
    context += `\n[${index + 1}] ${result.title}\n`;
    context += `    ${result.snippet}\n`;
    context += `    Source: ${result.url}\n`;
  });

  context += '\n=== END WEB SEARCH RESULTS ===\n';
  context += 'IMPORTANT: Use the web search results above to answer the user\'s question. Cite sources when appropriate.\n';

  return context;
}

// Portfolio API
export const portfolioApi = {
  async getHistory(userId: string): Promise<PortfolioHistory[]> {
    const { data, error } = await supabase
      .schema('trading')
      .from('portfolio_history')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async addHistoryEntry(userId: string, date: string, value: number): Promise<PortfolioHistory> {
    const { data, error } = await supabase
      .schema('trading')
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
      .schema('trading')
      .from('open_positions')
      .select('*')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(userId: string, position: Omit<OpenPosition, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<OpenPosition> {
    const { data, error } = await supabase
      .schema('trading')
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
      .schema('trading')
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
      .schema('trading')
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
      .schema('trading')
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
      .schema('trading')
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
      .schema('trading')
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('exit_date', { ascending: false, nullsFirst: false });

    if (error) throw error;
    return data || [];
  },

  async getClosed(userId: string): Promise<Trade[]> {
    const { data, error } = await supabase
      .schema('trading')
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
      .schema('trading')
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
      .schema('trading')
      .from('trade_journal')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(userId: string, entry: Omit<TradeJournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'trade_id'> & { trade_id?: string | null }): Promise<TradeJournalEntry> {
    const { data, error } = await supabase
      .schema('trading')
      .from('trade_journal')
      .insert({ ...entry, user_id: userId })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<TradeJournalEntry>): Promise<TradeJournalEntry> {
    const { data, error } = await supabase
      .schema('trading')
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
      .schema('trading')
      .from('trade_journal')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};

function normalizeChatTitle(title?: string): string {
  const trimmedTitle = title?.trim();

  if (trimmedTitle == null) {
    return 'New Chat';
  }

  if (trimmedTitle.length === 0) {
    throw new Error('Title cannot be empty');
  }

  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title too long. Maximum length is ${MAX_TITLE_LENGTH} characters.`);
  }

  return trimmedTitle;
}

function fromAiChats() {
  return supabase.from('chats');
}

function fromAiChatMessages() {
  return supabase.from('chat_messages');
}

/**
 * Returns true when a Supabase/PostgREST error indicates that the table or
 * schema is not accessible (404 Not Found, 400 schema-not-in-search-path,
 * or PostgreSQL error 42P01 undefined_table).  In those cases callers should
 * treat the result as empty rather than propagating a hard error.
 */
function isSchemaOrTableNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string; message?: string };
  if (e.status === 404) return true;
  if (e.status === 400 && e.message?.includes('schema')) return true;
  if (e.code === '42P01') return true; // PostgreSQL: undefined_table
  return false;
}

async function fetchChatsForUser(userId: string): Promise<ChatWithMessages[]> {
  const { data: chats, error: chatsError } = await fromAiChats()
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (chatsError) {
    if (isSchemaOrTableNotFound(chatsError)) {
      console.warn('ai.chats table not accessible (404). Ensure the "ai" schema is added to Supabase Exposed Schemas. Returning empty chat list.');
      return [];
    }
    throw chatsError;
  }
  if (!Array.isArray(chats) || chats.length === 0) return [];

  const chatIds = chats.map(c => c.id);
  const { data: messages, error: messagesError } = await fromAiChatMessages()
    .select('*')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });

  if (messagesError) {
    if (isSchemaOrTableNotFound(messagesError)) {
      console.warn('ai.chat_messages table not accessible (404). Returning chats without messages.');
      return chats.map(chat => ({ ...chat, messages: [], messageCount: 0, lastMessage: undefined }));
    }
    throw messagesError;
  }

  const messagesByChat = (messages || []).reduce((acc, msg) => {
    if (!acc[msg.chat_id!]) acc[msg.chat_id!] = [];
    acc[msg.chat_id!].push(msg);
    return acc;
  }, {} as Record<string, ChatMessage[]>);

  return chats.map(chat => ({
    ...chat,
    messages: [...(messagesByChat[chat.id] || [])].reverse(),
    messageCount: (messagesByChat[chat.id] || []).length,
    lastMessage: (messagesByChat[chat.id] || [])[0],
  }));
}

async function fetchMessagesForUser(userId: string): Promise<ChatMessage[]> {
  const { data, error } = await fromAiChatMessages()
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isSchemaOrTableNotFound(error)) {
      console.warn('ai.chat_messages table not accessible (404). Returning empty message list.');
      return [];
    }
    throw error;
  }
  return data || [];
}

// Chat API
// Chats API - for managing chat sessions
export const chatsApi = {
  // Get all chats for a user with message counts
  async getAll(userId: string): Promise<ChatWithMessages[]> {
    return fetchChatsForUser(userId);
  },

  // Create a new chat
  async create(userId: string, title?: string): Promise<Chat> {
    const normalizedTitle = normalizeChatTitle(title);

    const { data, error } = await fromAiChats()
      .insert({ user_id: userId, title: normalizedTitle })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update chat title
  async updateTitle(chatId: string, title: string): Promise<Chat> {
    const normalizedTitle = normalizeChatTitle(title);

    const { data, error } = await fromAiChats()
      .update({ title: normalizedTitle, updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Delete a chat (cascade deletes messages)
  async delete(chatId: string): Promise<void> {
    const { error } = await fromAiChats()
      .delete()
      .eq('id', chatId);

    if (error) throw error;
  },

  // Get single chat with messages
  async getWithMessages(chatId: string): Promise<ChatWithMessages | null> {
    const { data: chat, error: chatError } = await fromAiChats()
      .select('*')
      .eq('id', chatId)
      .maybeSingle();

    if (chatError) {
      if (isSchemaOrTableNotFound(chatError)) return null;
      throw chatError;
    }
    if (!chat) return null;

    const { data: messages, error: messagesError } = await fromAiChatMessages()
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      if (isSchemaOrTableNotFound(messagesError)) {
        return { ...chat, messages: [], messageCount: 0, lastMessage: undefined };
      }
      throw messagesError;
    }

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
    const { data, error } = await fromAiChatMessages()
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isSchemaOrTableNotFound(error)) return [];
      throw error;
    }
    return data || [];
  },

  // Legacy: Get all messages for a user (for backward compatibility)
  async getAllUserMessages(userId: string): Promise<ChatMessage[]> {
    return fetchMessagesForUser(userId);
  },

  async addMessage(userId: string, chatId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    // Input validation
    if (!content || content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const { data, error } = await fromAiChatMessages()
      .insert({ user_id: userId, chat_id: chatId, role, content })
      .select()
      .single();

    if (error) throw error;

    // Update chat's updated_at timestamp
    const { error: updateChatError } = await fromAiChats()
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId);

    if (updateChatError) {
      // Log error but don't fail the message creation
      console.error('Failed to update chat timestamp', { chatId, error: updateChatError });
    }

    return data;
  },

  async clearMessages(chatId: string): Promise<void> {
    const { error } = await fromAiChatMessages()
      .delete()
      .eq('chat_id', chatId);

    if (error) throw error;
  },
};

// Learning API
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
    const status = completed ?? normalizedProgress >= 100 ? 'completed' : normalizedProgress > 0 ? 'in_progress' : 'not_started';
    const timestamp = new Date().toISOString();

    const { error: upsertError } = await supabase
      .schema('academy')
      .from('user_lesson_progress')
      .upsert({
        user_id: userId,
        lesson_id: lesson.id,
        status,
        best_quiz_score: existingProgress?.best_quiz_score ?? null,
        last_opened_at: timestamp,
        completed_at: status === 'completed'
          ? existingProgress?.completed_at ?? timestamp
          : null,
      }, { onConflict: 'user_id,lesson_id' });

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

  async initializeTopics(userId: string): Promise<LearningTopic[]> {
    return this.getTopics(userId);
  },
};

// Achievements API
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

// Market Data API (can be updated by Python backend)
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

// News API - for financial news articles
/**
 * Score a news article by financial importance.
 * Higher score = more market-moving / significant.
 * Works with NewsArticle or any object with title/summary/provider/published_at.
 */
export function scoreNewsImportance(article: {
  title: string;
  summary?: string | null;
  provider?: string | null;
  published_at?: string | null;
}): number {
  let score = 0;
  const text = `${article.title} ${article.summary ?? ''}`.toLowerCase();

  // Tier 1 – macro / systemic events (+4 each)
  const macroKeywords = [
    'fed ', 'federal reserve', 'fomc', 'interest rate', 'rate hike', 'rate cut',
    'inflation', 'recession', 'gdp', 'jobs report', 'nonfarm', 'cpi', 'pce',
    'tariff', 'sanctions', 'debt ceiling',
  ];

  // Tier 2 – crisis / high-impact corporate (+3 each)
  const crisisKeywords = [
    'crash', 'collapse', 'bankruptcy', 'default', 'crisis', 'war ', 'conflict',
    'earnings beat', 'earnings miss', 'earnings surprise', 'profit warning',
  ];

  // Tier 3 – significant market events (+2 each)
  const eventKeywords = [
    'earnings', 'revenue', 'merger', 'acquisition', 'ipo', 'sec ', ' sec',
    'doj', 'investigation', 'lawsuit', 'layoffs', 'guidance', 'upgrade',
    'downgrade', 's&p 500', 'nasdaq', 'dow jones', 'wall street',
  ];

  // Tier 4 – general financial (+1 each)
  const generalKeywords = [
    'stock', 'shares', 'market', 'analyst', 'rally', 'surge', 'plunge',
    'drop', 'rise', 'fall', 'dividend', 'buyback',
  ];

  macroKeywords.forEach(kw => { if (text.includes(kw)) score += 4; });
  crisisKeywords.forEach(kw => { if (text.includes(kw)) score += 3; });
  eventKeywords.forEach(kw => { if (text.includes(kw)) score += 2; });
  generalKeywords.forEach(kw => { if (text.includes(kw)) score += 1; });

  // Provider reputation bonus
  const provider = (article.provider ?? '').toLowerCase();
  if (['reuters', 'bloomberg', 'wall street journal', 'wsj', 'financial times', 'ft.com'].some(p => provider.includes(p))) {
    score += 3;
  } else if (['cnbc', 'marketwatch', "barron's", 'barrons', 'seeking alpha'].some(p => provider.includes(p))) {
    score += 2;
  } else {
    score += 1;
  }

  // Recency bonus (freshness matters, but content wins)
  if (article.published_at) {
    const ageHours = (Date.now() - new Date(article.published_at).getTime()) / 3_600_000;
    if (ageHours <= 6) score += 2;
    else if (ageHours <= 24) score += 1;
  }

  return score;
}

export const newsApi = {
  async getLatest(limit: number = 5): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .schema('market')
      .from('news')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];
  },

  async getAll(): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .schema('market')
      .from('news')
      .select('*')
      .order('published_at', { ascending: false });

    if (error) throw error;

    return data || [];
  },

  /** Fetch articles published within the last `hours` hours, up to `limit` rows. */
  async getRecent(hours: number = 12, limit: number = 150): Promise<NewsArticle[]> {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    const { data, error } = await supabase
      .schema('market')
      .from('news')
      .select('*')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];
  },
};


// === STOCK SNAPSHOT CACHE ===
// In-memory cache to reduce database queries
// Stores tickers 1-60 and refreshes every 5 minutes
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const stockCache = {
  // Cache for individual tickers: { 'AAPL': { data: StockSnapshot, timestamp: 123456 } }
  tickers: new Map<string, CacheEntry<StockSnapshot>>(),
  // Cache for company name lookups (lowercase key)
  companyNames: new Map<string, CacheEntry<StockSnapshot | null>>(),
  // Cache for the main stock list (first 60 tickers)
  mainList: null as CacheEntry<StockSnapshot[]> | null,
  // Whether initial load has been done
  initialized: false,
  // Cache TTL in milliseconds (5 minutes)
  TTL_MS: 5 * 60 * 1000,
  // Number of stocks to pre-cache
  PRELOAD_COUNT: 60,

  isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.TTL_MS;
  },

  getTicker(ticker: string): StockSnapshot | null {
    const entry = this.tickers.get(ticker.toUpperCase());
    if (entry && !this.isExpired(entry.timestamp)) {
      console.log('[Cache] Hit for ticker:', ticker);
      return entry.data;
    }
    return null;
  },

  setTicker(ticker: string, data: StockSnapshot): void {
    this.tickers.set(ticker.toUpperCase(), { data, timestamp: Date.now() });
  },

  getCompanyName(name: string): StockSnapshot | null | undefined {
    const entry = this.companyNames.get(name.toLowerCase());
    if (entry && !this.isExpired(entry.timestamp)) {
      console.log('[Cache] Hit for company name:', name);
      return entry.data;
    }
    return undefined; // undefined means not in cache, null means cached as "not found"
  },

  setCompanyName(name: string, data: StockSnapshot | null): void {
    this.companyNames.set(name.toLowerCase(), { data, timestamp: Date.now() });
  },

  getMainList(): StockSnapshot[] | null {
    if (this.mainList && !this.isExpired(this.mainList.timestamp)) {
      console.log('[Cache] Hit for main stock list');
      return this.mainList.data;
    }
    return null;
  },

  setMainList(data: StockSnapshot[]): void {
    this.mainList = { data, timestamp: Date.now() };
    // Also populate individual ticker cache from the list
    data.forEach(snap => {
      this.tickers.set(snap.ticker.toUpperCase(), { data: snap, timestamp: Date.now() });
      if (snap.company_name) {
        // Cache by company name too (lowercase for case-insensitive lookup)
        this.companyNames.set(snap.company_name.toLowerCase(), { data: snap, timestamp: Date.now() });
      }
    });
    console.log('[Cache] Stored', data.length, 'stocks in cache');
  },

  clear(): void {
    this.tickers.clear();
    this.companyNames.clear();
    this.mainList = null;
    this.initialized = false;
    console.log('[Cache] Cleared');
  },

  getStats(): { tickers: number; companyNames: number; hasMainList: boolean; initialized: boolean } {
    return {
      tickers: this.tickers.size,
      companyNames: this.companyNames.size,
      hasMainList: this.mainList !== null,
      initialized: this.initialized,
    };
  },
};

type StockSnapshotQuery = PostgrestFilterBuilder<
  Database['market']['Tables']['stock_snapshots']['Row'],
  Database['market']['Tables']['stock_snapshots']['Row'],
  StockSnapshot[],
  'stock_snapshots',
  unknown
>;

const fromStockSnapshots = () => supabase.schema('market').from('stock_snapshots') as StockSnapshotQuery;

const runStockSnapshotsQuery = (buildQuery: (query: StockSnapshotQuery) => StockSnapshotQuery) =>
  buildQuery(fromStockSnapshots());

// Stock Snapshots API - Read financial data from database (with caching)
export const stockSnapshotsApi = {
  // Initialize cache by pre-loading first 60 stocks
  async initializeCache(): Promise<void> {
    if (stockCache.initialized && stockCache.mainList && !stockCache.isExpired(stockCache.mainList.timestamp)) {
      console.log('[Cache] Already initialized and valid');
      return;
    }

    console.log('[Cache] Initializing - loading first', stockCache.PRELOAD_COUNT, 'stocks...');

    const { data, error } = await runStockSnapshotsQuery(query =>
      query
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(stockCache.PRELOAD_COUNT)
    );

    if (error) {
      console.error('[Cache] Failed to initialize:', error);
      throw error;
    }

    stockCache.setMainList(data || []);
    stockCache.initialized = true;
    console.log('[Cache] Initialization complete -', data?.length || 0, 'stocks cached');
  },

  // Get cache statistics
  getCacheStats() {
    return stockCache.getStats();
  },

  // Clear the cache (useful for forcing refresh)
  clearCache(): void {
    stockCache.clear();
  },

  // Get all stock snapshots (with caching)
  async getAll(limit?: number): Promise<StockSnapshot[]> {
    // Check cache first
    const cached = stockCache.getMainList();
    if (cached) {
      return limit ? cached.slice(0, limit) : cached;
    }

    // Cache miss - fetch from database
    console.log('[Cache] Miss for main list - fetching from database');
    // Fetch at least PRELOAD_COUNT to populate cache, or more if requested
    const fetchLimit = Math.max(limit || 0, stockCache.PRELOAD_COUNT);

    const { data, error } = await runStockSnapshotsQuery(query =>
      query
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(fetchLimit)
    );
    if (error) throw error;

    const result = data || [];
    stockCache.setMainList(result);

    return limit ? result.slice(0, limit) : result;
  },

  // Get stock snapshot by ticker symbol (with caching)
  async getByTicker(ticker: string): Promise<StockSnapshot | null> {
    // Check cache first
    const cached = stockCache.getTicker(ticker);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from database
    console.log('[Cache] Miss for ticker:', ticker, '- fetching from database');
    const { data, error } = await runStockSnapshotsQuery(query =>
      query
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (error) throw error;

    if (data) {
      stockCache.setTicker(ticker, data);
    }
    return data;
  },

  // Get stock snapshot by company name (with caching)
  async getByCompanyName(companyName: string): Promise<StockSnapshot | null> {
    // Check cache first
    const cached = stockCache.getCompanyName(companyName);
    if (cached !== undefined) {
      return cached; // Could be null (meaning "not found" is cached)
    }

    // Cache miss - fetch from database
    console.log('[Cache] Miss for company name:', companyName, '- fetching from database');
    const { data, error } = await runStockSnapshotsQuery(query =>
      query
        .select('*')
        .ilike('company_name', `%${companyName}%`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (error) {
      throw error;
    }

    // Cache the "not found" result too
    if (!data) {
      stockCache.setCompanyName(companyName, null);
      return null;
    }

    stockCache.setCompanyName(companyName, data);
    stockCache.setTicker(data.ticker, data); // Also cache by ticker
    return data;
  },

  // Get stock snapshots by multiple tickers (with caching)
  async getByTickers(tickers: string[]): Promise<StockSnapshot[]> {
    const results: StockSnapshot[] = [];
    const tickersToFetch: string[] = [];

    // Check cache for each ticker
    for (const ticker of tickers) {
      const cached = stockCache.getTicker(ticker);
      if (cached) {
        results.push(cached);
      } else {
        tickersToFetch.push(ticker.toUpperCase());
      }
    }

    // If all found in cache, return
    if (tickersToFetch.length === 0) {
      console.log('[Cache] All', tickers.length, 'tickers found in cache');
      return results;
    }

    // Fetch missing tickers from database
    console.log('[Cache] Fetching', tickersToFetch.length, 'missing tickers from database');
    const { data, error } = await runStockSnapshotsQuery(query =>
      query
        .select('*')
        .in('ticker', tickersToFetch)
        .order('updated_at', { ascending: false })
    );

    if (error) throw error;

    // Cache and add to results
    if (data) {
      data.forEach(snap => {
        stockCache.setTicker(snap.ticker, snap);
        results.push(snap);
      });
    }

    return results;
  },

  // Get stock snapshots with signals (with caching for individual results)
  async getWithSignals(limit?: number): Promise<StockSnapshot[]> {
    // This query is dynamic (filtered by signal), so we fetch fresh but cache results
    const { data, error } = await runStockSnapshotsQuery(query => {
      let filteredQuery = query
        .select('*')
        .not('latest_signal', 'is', null)
        .order('signal_timestamp', { ascending: false });

      if (limit) {
        filteredQuery = filteredQuery.limit(limit);
      }

      return filteredQuery;
    });
    if (error) throw error;

    // Cache individual results
    if (data) {
      data.forEach(snap => {
        stockCache.setTicker(snap.ticker, snap);
      });
    }

    return data || [];
  },

  // Get recently updated stock snapshots
  async getRecentlyUpdated(hours: number = 24, limit?: number): Promise<StockSnapshot[]> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours);

    const { data, error } = await runStockSnapshotsQuery(query => {
      let filteredQuery = query
        .select('*')
        .gte('updated_at', cutoffTime.toISOString())
        .order('updated_at', { ascending: false });

      if (limit) {
        filteredQuery = filteredQuery.limit(limit);
      }

      return filteredQuery;
    });
    if (error) throw error;
    return data || [];
  },
};

// ============================================================
// Stock Ranking System
// ============================================================

export interface StockScore {
  ticker: string;
  company_name: string | null;
  last_price: number | null;
  price_change_pct: number | null;
  updated_at: string | null;
  composite_score: number;
  rank_tier: string;       // "Strong Buy" | "Buy" | "Hold" | "Underperform" | "Sell"
  conviction: string;      // "High" | "Medium" | "Low"
  momentum_score: number;
  technical_score: number;
  fundamental_score: number;
  risk_score: number;
  quality_score: number;
  ml_score: number | null;
  has_ml_data: boolean;
  dimensions_bullish: number;
  breakdown: {
    // Technical
    rsi_14: number | null;
    rsi_9: number | null;
    macd_above_signal: boolean | null;
    macd_histogram: number | null;
    golden_cross: boolean | null;
    adx: number | null;
    stochastic_k: number | null;
    stochastic_d: number | null;
    williams_r: number | null;
    cci: number | null;
    bollinger_position: number | null;
    // Momentum
    volume_ratio: number | null;
    price_vs_sma_50: number | null;
    price_vs_sma_200: number | null;
    price_vs_ema_50: number | null;
    fifty_two_week_position: number | null;
    // Fundamental
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
    // ML/Signals
    signal_confidence: number | null;
    is_bullish: boolean | null;
    signal_strategy: string | null;
  };
  data_fresh: boolean;
}

export type Horizon = 'short' | 'long' | 'balanced';

export interface TopStocksOptions {
  limit?: number;
  minScore?: number;
  horizon?: Horizon;
}

export interface TopStocksResult {
  stocks: StockScore[];
  hasStaleData: boolean;
  hasMlData: boolean;
  totalScored: number;
  horizon: Horizon;
}

// Calls GET /api/stocks/ranking on the Python backend.
// The backend queries Supabase directly, scores all stocks server-side,
// caches results for 10 min per horizon, and returns only the top-N ranked stocks.
export const stockRankingApi = {
  async getRanking(options: TopStocksOptions = {}, source?: string): Promise<TopStocksResult> {
    const { limit = 20, minScore = 0, horizon = 'balanced' } = options;
    const backendUrl = import.meta.env.VITE_PYTHON_API_URL;
    if (!backendUrl) {
      throw new Error('VITE_PYTHON_API_URL is not configured');
    }

    const params = new URLSearchParams({
      limit: String(limit),
      min_score: String(minScore),
      horizon,
    });
    if (source) params.append('source', source);

    try {
      const res = await fetch(`${backendUrl}/api/stocks/ranking?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Stock ranking API error: ${res.statusText}`);
      }

      // Backend returns snake_case; map to camelCase for the frontend
      const data = await res.json();
      return {
        stocks: data.stocks,
        hasStaleData: data.has_stale_data,
        hasMlData: data.has_ml_data,
        totalScored: data.total_scored,
        horizon: data.horizon,
      };
    } catch (error) {
      // Network or CSP error — log and re-throw with a clearer message
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        console.warn('[StockRanking] Network/CSP error fetching stock ranking from:', `${backendUrl}/api/stocks/ranking`);
        throw new Error('Unable to reach the stock ranking backend. The server may be down or blocked by Content Security Policy.');
      }
      throw error;
    }
  },
};

// Experience level type
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | null;


// Generate system prompt based on user's experience level
// Note: experienceLevel can be null, which defaults to intermediate level
function getSystemPrompt(experienceLevel: ExperienceLevel, hasEyeData: boolean = false): string {
  // Default to intermediate if null
  const level = experienceLevel ?? 'intermediate';

  const baseRules = `
IDENTITY:
You are the AI behind The Eye — a proprietary financial intelligence platform. You are NOT a generic chatbot. You have real-time market data, signals, and analysis at your fingertips. Speak with that authority.

PERSONALITY:
- Be direct. Say what you actually think. Don't hedge everything into meaninglessness.
- When you have a view, own it: "I'd lean bullish here because..." not "It could potentially go either way."
- Show your reasoning on complex questions. Walk through the logic — what the data says, what it implies, and what you'd do.
- Challenge weak assumptions. If someone's thesis has holes, point them out.
- Be human. Conversational tone, occasional dry wit. Never sound like a compliance form.
- Simple questions get simple answers. Don't over-explain obvious things.

FORMATTING:
- Use short paragraphs separated by blank lines for readability.
- Use **bold** for key numbers, tickers, signals, and critical terms.
- Use numbered lists (1. 2. 3.) only for sequential steps or ranked items.
- Use bullet points sparingly, only for actual lists of comparable items.
- Do NOT use markdown headers (#, ##, ###). Write in flowing paragraphs.
- Do NOT wrap your response in JSON or code blocks. Just write naturally.

TOPIC RULES:
- ONLY discuss finance, investing, trading, economics, personal finance, and money management.
- Exception: you may answer real-world price/cost questions (e.g. "how much is a boat").
- For unrelated topics, redirect with personality — not a cold refusal.
- You MAY provide specific, actionable financial views (buy/sell/hold) when asked.
- When giving actionable advice, include this exact one-line disclaimer once: "Test mode only. Not financial advice."

WEB SEARCH (for NEWS and GENERAL KNOWLEDGE):
- When web search results are provided, use them naturally. Cite sources.
- IMPORTANT: Stock prices, indicators, and signals come from THE EYE DATABASE, not web search.
`;

  // Add The Eye rules based on whether data is available
  const eyeRules = hasEyeData ? `
THE EYE TRADE ENGINE (CONNECTED):
- You have LIVE access to The Eye trade engine. The data below is REAL and CURRENT.
- When answering about stocks, signals, prices, or market data — USE the data. It's yours.
- Reference The Eye naturally: "The Eye is showing..." or "Looking at The Eye's data..."
- Be confident. You HAVE the data. NEVER say "I don't have access" — because you do.
- Connect data points when reasoning: "RSI at 72 combined with the volume spike suggests..."
` : `
THE EYE TRADE ENGINE (NOT CONNECTED):
- The Eye trade engine isn't connected right now.
- For live prices, signals, or market data — let the user know The Eye is offline.
- You can still reason about finance, use web search for news, and give general analysis.
`;

  const allRules = baseRules + eyeRules;

  switch (level) {
    case 'beginner':
      return `You are The Eye's AI advisor, tuned for someone just starting their financial journey.
Be warm and encouraging — like a smart friend who's genuinely excited to help them learn. Use everyday analogies to explain concepts (comparing diversification to not putting all your eggs in one basket, etc). Never condescend. If they ask something basic, answer it clearly and make them feel good about asking. Keep things digestible — go deeper only when they ask for more.
${allRules}`;

    case 'intermediate':
      return `You are The Eye's AI advisor, talking to someone who knows their way around markets.
Be direct and practical. Skip the basics — they know what an ETF is. Use technical terms naturally. When you reason through something, show the interesting connections between data points. They can handle nuance, so give it to them.
${allRules}`;

    case 'advanced':
      return `You are The Eye's AI advisor, engaging with a sophisticated investor.
Be concise, technical, and opinionated. Skip fundamentals entirely. Engage at an advanced level — multi-factor analysis, cross-asset correlations, options Greeks, macro regime shifts. They want sharp insight, not hand-holding. Challenge their assumptions when appropriate. Show deep reasoning on complex setups.
${allRules}`;

    default:
      return `You are The Eye's AI financial advisor.
Match your depth to the question. Simple questions get crisp answers. Complex questions get thorough analysis with visible reasoning. Always be direct and data-driven.
${allRules}`;
  }
}

// Python Backend API endpoint helpers
// These can be configured to call your Python backend for AI responses, live market data, etc.
export const pythonApi = {
  // Analyze quantitative data using Deepseek (compliance-safe: only sends numerical data, no PII)
  async analyzeQuantitativeData(quantitativeData: Record<string, number | undefined>): Promise<string> {
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;

    if (!pythonBackendUrl) {
      throw new Error('AI backend URL not configured');
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
      const response = await fetch(`${pythonBackendUrl}/api/ai/analyze-quantitative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quantitative_data: sanitizedData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `AI backend error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.response || 'Unable to analyze data.';
    } catch (error) {
      console.error('Error calling AI analysis backend:', error);
      throw error;
    }
  },

  // Call backend AI proxy for chat response (API keys remain server-side)
  async getChatResponse(
    message: string,
    userId: string,
    experienceLevel?: ExperienceLevel,
    chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    tradeEngineContext?: TradeEngineAIContext | null
  ): Promise<string> {
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

    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;

    const hasTradeEngineData = !!tradeEngineContext;

    // Extract ticker from message FIRST (before fetching all data)
    // This allows us to query for specific ticker if needed
    const messageUpper = message.toUpperCase();
    const skipWords = new Set(['WHAT', 'WHEN', 'WHERE', 'WHY', 'HOW', 'HOWS', 'HOW\'S', 'WHO', 'WHICH', 'IS', 'ARE', 'WAS', 'WERE', 'THE', 'A', 'AN', 'FOR', 'AND', 'OR', 'BUT', 'WITH', 'ABOUT', 'FROM', 'TO', 'OF', 'IN', 'ON', 'AT', 'BY', 'LATEST', 'PRICE', 'STOCK', 'SHARES', 'SHARE', 'COMPANY', 'TICKER', 'SYMBOL', 'ME', 'YOU', 'TELL', 'SHOW', 'GIVE', 'CAN', 'WILL', 'SHOULD', 'WOULD', 'COULD', 'GOOD', 'NOW', 'THEN', 'BOND', 'BONDS']);

    let requestedTicker: string | null = null;

    // Priority 1: Check for ticker in parentheses (e.g., "Apple (AAPL)")
    const parenMatch = messageUpper.match(/\(([A-Z]{1,5})\)/);
    if (parenMatch && parenMatch[1]) {
      const ticker = parenMatch[1];
      if (ticker.length >= 2 && ticker.length <= 5 && !skipWords.has(ticker)) {
        requestedTicker = ticker;
      }
    }

    // Priority 2: Check after common phrases (e.g., "what is AAPL", "price of NVDA")
    if (!requestedTicker) {
      const afterPhraseMatch = messageUpper.match(/(?:about|for|on|with|regarding|tell me about|what is|what's|price of|price for|show me|give me|tell me|latest price for|latest price of)\s+([A-Z]{1,5})\b/i);
      if (afterPhraseMatch && afterPhraseMatch[1]) {
        const ticker = afterPhraseMatch[1];
        if (ticker.length >= 2 && ticker.length <= 5 && !skipWords.has(ticker)) {
          requestedTicker = ticker;
        }
      }
    }

    // Priority 3: Look for ticker patterns in all words (2-5 uppercase letters, not in skip list)
    if (!requestedTicker) {
      const words = messageUpper.split(/\s+/);
      for (const word of words) {
        const cleanWord = word.replace(/[^A-Z]/g, ''); // Remove non-letters
        if (cleanWord.length >= 2 && cleanWord.length <= 5 && !skipWords.has(cleanWord)) {
          requestedTicker = cleanWord;
          break;
        }
      }
    }

    // Priority 4: Check for standalone ticker (entire message is just a ticker)
    if (!requestedTicker) {
      const cleanMessage = messageUpper.trim().replace(/[^A-Z]/g, '');
      if (cleanMessage.length >= 2 && cleanMessage.length <= 5 && !skipWords.has(cleanMessage)) {
        requestedTicker = cleanMessage;
      }
    }

    // Store original query for company name search if ticker not found
    const originalQuery = message.trim();

    // Detect if this message is asking about stocks/market data
    // Only query database when relevant to avoid unnecessary API calls
    const stockRelatedPatterns = [
      /(?:price|stock|share|ticker|symbol|market|trade|trading|invest|portfolio)/i,
      /(?:buy|sell|hold|signal|analysis|chart|technical|fundamental)/i,
      /(?:earnings|dividend|pe ratio|market cap|volume|rsi|macd|sma|ema)/i,
      /\b[A-Z]{2,5}\b/, // Potential ticker symbols
    ];

    const isStockRelatedQuery = stockRelatedPatterns.some(pattern => pattern.test(message)) || !!requestedTicker;

    // Fetch stock snapshots from database ONLY when needed
    let stockSnapshotsData: StockSnapshot[] = [];
    let specificTickerSnapshot: StockSnapshot | null = null;

    // Only query database if:
    // 1. User is asking about a specific ticker, OR
    // 2. Query is stock-related and we don't have Trade Engine data
    if (isStockRelatedQuery) {
      try {
        // Initialize cache on first stock-related query (loads 60 stocks)
        // This is a no-op if cache is already initialized and valid
        await stockSnapshotsApi.initializeCache();

        // If we have a specific ticker, query for it (will hit cache if available)
        if (requestedTicker) {
          try {
            // Try exact ticker match first
            specificTickerSnapshot = await stockSnapshotsApi.getByTicker(requestedTicker);

            // If not found, try common typos/variations
            if (!specificTickerSnapshot) {
              const typoMap: Record<string, string> = {
                'APPL': 'AAPL',
                'NVDIA': 'NVDA',
                'MICROSOFT': 'MSFT',
                'APPLE': 'AAPL',
                'META': 'META',
                'GOOGLE': 'GOOGL',
                'ALPHABET': 'GOOGL',
                'TESLA': 'TSLA',
                'AMAZON': 'AMZN',
              };

              const correctedTicker = typoMap[requestedTicker];
              if (correctedTicker) {
                specificTickerSnapshot = await stockSnapshotsApi.getByTicker(correctedTicker);
                if (specificTickerSnapshot) {
                  requestedTicker = correctedTicker; // Update to corrected ticker
                }
              }
            }

            // If still not found, try company name search (for company names like "APPLE", "MICROSOFT")
            if (!specificTickerSnapshot) {
              specificTickerSnapshot = await stockSnapshotsApi.getByCompanyName(requestedTicker);
              if (specificTickerSnapshot) {
                requestedTicker = specificTickerSnapshot.ticker; // Update to actual ticker
              }
            }

            console.log('[AI] Queried database for ticker:', requestedTicker, specificTickerSnapshot ? '(found)' : '(not found)');
          } catch (_error) {
            // Ignore errors, continue without specific ticker
            console.log('[AI] Database query failed for ticker:', requestedTicker);
          }
        } else {
          // No ticker extracted, but might be a company name - try searching by company name
          const companyNameWords = originalQuery.split(/\s+/).filter(w =>
            w.length > 3 && !skipWords.has(w.toUpperCase())
          );

          if (companyNameWords.length > 0) {
            // Try the longest word as company name
            const potentialCompanyName = companyNameWords.sort((a, b) => b.length - a.length)[0];

            try {
              specificTickerSnapshot = await stockSnapshotsApi.getByCompanyName(potentialCompanyName);
              if (specificTickerSnapshot) {
                requestedTicker = specificTickerSnapshot.ticker; // Set ticker from found company
                console.log('[AI] Found ticker by company name:', potentialCompanyName, '->', requestedTicker);
              }
            } catch (_error) {
              // Ignore errors, continue without specific ticker
            }
          }
        }

        // Only fetch general stock list if:
        // - No specific ticker was found AND
        // - No Trade Engine data is available AND
        // - Query seems to be asking about general market/multiple stocks
        const needsGeneralStockList = !specificTickerSnapshot && !hasTradeEngineData &&
          /(?:market|stocks|portfolio|top|best|worst|signals|overview)/i.test(message);

        if (needsGeneralStockList) {
          stockSnapshotsData = await stockSnapshotsApi.getAll(50); // Reduced from 100 to 50
          console.log('[AI] Fetched general stock list:', stockSnapshotsData.length, 'tickers');
        }
      } catch (error) {
        console.error('Error fetching The Eye data from database:', error);
        // Continue without database snapshots - will use Trade Engine data if available
      }
    } else {
      console.log('[AI] Skipping database query - not a stock-related question');
    }

    const hasStockSnapshotsData = stockSnapshotsData.length > 0 || !!specificTickerSnapshot;
    const hasAnyFinancialData = hasTradeEngineData || hasStockSnapshotsData;

    // Fetch recent news from Supabase news table for AI context, sorted by importance
    let supabaseNewsData: NewsArticle[] = [];
    try {
      const rawNews = await newsApi.getLatest(20); // fetch more, then pick top 8 by importance
      supabaseNewsData = rawNews
        .sort((a, b) => scoreNewsImportance(b) - scoreNewsImportance(a))
        .slice(0, 8);
    } catch (error) {
      console.log('[AI] Supabase news fetch failed, continuing without news data:', error);
    }

    const systemPrompt = getSystemPrompt(experienceLevel ?? null, hasAnyFinancialData);

    // Build The Eye data context from LIVE Trade Engine connection AND database snapshots
    let eyeDataContext = '';

    if (hasTradeEngineData && tradeEngineContext) {
      // Use the same ticker extraction logic as above (requestedTicker already extracted at the top)
      // No need to re-extract - the requestedTicker variable from above is already available

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
      // No Trade Engine connection - but we may still have Supabase data
      if (hasStockSnapshotsData) {
        eyeDataContext += '\n\n[Note: The Eye Trade Engine live connection is not available, but historical data from the database is available below. Use this data to help the user.]\n';
      } else {
        eyeDataContext += '\n\n[The Eye Trade Engine is currently offline and no cached data is available. You can still help with general financial questions, but real-time market data is not available.]\n';
      }
    }

    // Add The Eye data from stock_snapshots table (complements Trade Engine data)
    if (hasStockSnapshotsData && stockSnapshotsData.length > 0) {
      // Use the specific ticker snapshot if we found it, otherwise check in the general data
      let dbSnapshot = specificTickerSnapshot;

      if (!dbSnapshot && requestedTicker) {
        // Fallback: check in the general data
        dbSnapshot = stockSnapshotsData.find(
          snap => snap.ticker.toUpperCase() === requestedTicker
        );
      }

      // Add database snapshot context (referenced as The Eye)
      if (dbSnapshot) {
        if (eyeDataContext) eyeDataContext += '\n\n';
        eyeDataContext += '=== THE EYE DATA (from database) ===\n';
        eyeDataContext += 'IMPORTANT: This data is from The Eye database. Use this data to answer the user\'s question about this ticker.\n';
        eyeDataContext += `Ticker: ${dbSnapshot.ticker}${dbSnapshot.company_name ? ` (${dbSnapshot.company_name})` : ''}\n`;

        if (dbSnapshot.last_price !== null) {
          eyeDataContext += `Price: $${dbSnapshot.last_price.toFixed(2)}`;
          if (dbSnapshot.price_change_pct !== null) {
            eyeDataContext += ` (${dbSnapshot.price_change_pct >= 0 ? '+' : ''}${dbSnapshot.price_change_pct.toFixed(2)}%)`;
          }
          eyeDataContext += '\n';
        }

        if (dbSnapshot.volume !== null) {
          const volStr = dbSnapshot.volume >= 1000000
            ? `${(dbSnapshot.volume / 1000000).toFixed(1)}M`
            : `${(dbSnapshot.volume / 1000).toFixed(1)}K`;
          eyeDataContext += `Volume: ${volStr}`;
          if (dbSnapshot.volume_ratio !== null && dbSnapshot.volume_ratio > 1.5) {
            eyeDataContext += ` (${dbSnapshot.volume_ratio.toFixed(1)}x avg - high activity)`;
          }
          eyeDataContext += '\n';
        }

        // Technical indicators
        if (dbSnapshot.rsi_14 !== null) {
          const rsiStatus = dbSnapshot.rsi_14 < 30 ? 'oversold' : dbSnapshot.rsi_14 > 70 ? 'overbought' : 'neutral';
          eyeDataContext += `RSI(14): ${dbSnapshot.rsi_14.toFixed(1)} (${rsiStatus})\n`;
        }

        if (dbSnapshot.sma_50 !== null || dbSnapshot.sma_200 !== null) {
          eyeDataContext += 'Moving Averages: ';
          const maParts: string[] = [];
          if (dbSnapshot.sma_50 !== null) maParts.push(`SMA 50: $${dbSnapshot.sma_50.toFixed(2)}`);
          if (dbSnapshot.sma_200 !== null) maParts.push(`SMA 200: $${dbSnapshot.sma_200.toFixed(2)}`);
          eyeDataContext += maParts.join(' | ') + '\n';
        }

        if (dbSnapshot.macd !== null || dbSnapshot.macd_signal !== null) {
          eyeDataContext += 'MACD: ';
          const macdParts: string[] = [];
          if (dbSnapshot.macd !== null) macdParts.push(`MACD: ${dbSnapshot.macd.toFixed(2)}`);
          if (dbSnapshot.macd_signal !== null) macdParts.push(`Signal: ${dbSnapshot.macd_signal.toFixed(2)}`);
          if (dbSnapshot.macd_histogram !== null) {
            const histStatus = dbSnapshot.macd_histogram > 0 ? 'bullish' : 'bearish';
            macdParts.push(`Hist: ${dbSnapshot.macd_histogram.toFixed(2)} (${histStatus})`);
          }
          eyeDataContext += macdParts.join(' | ') + '\n';
        }

        // Fundamentals
        if (dbSnapshot.pe_ratio !== null) {
          eyeDataContext += `P/E Ratio: ${dbSnapshot.pe_ratio.toFixed(1)}\n`;
        }
        if (dbSnapshot.market_cap !== null) {
          const capStr = dbSnapshot.market_cap >= 1e12 ? `${(dbSnapshot.market_cap / 1e12).toFixed(1)}T` :
                        dbSnapshot.market_cap >= 1e9 ? `${(dbSnapshot.market_cap / 1e9).toFixed(1)}B` :
                        `${(dbSnapshot.market_cap / 1e6).toFixed(1)}M`;
          eyeDataContext += `Market Cap: $${capStr}\n`;
        }

        // Signal
        if (dbSnapshot.latest_signal) {
          const confStr = dbSnapshot.signal_confidence
            ? `${(dbSnapshot.signal_confidence * 100).toFixed(0)}%`
            : 'N/A';
          const timeStr = dbSnapshot.signal_timestamp
            ? new Date(dbSnapshot.signal_timestamp).toLocaleString()
            : 'N/A';
          eyeDataContext += `Signal: ${dbSnapshot.latest_signal}${dbSnapshot.signal_strategy ? ` (${dbSnapshot.signal_strategy})` : ''}, ${confStr} confidence @ ${timeStr}\n`;
        }

        if (dbSnapshot.updated_at) {
          eyeDataContext += `Last Updated: ${new Date(dbSnapshot.updated_at).toLocaleString()}\n`;
        }

        eyeDataContext += '\n=== END THE EYE DATA (from database) ===\n';
        eyeDataContext += 'IMPORTANT: The data above is from The Eye database. When the user asks about this ticker, use this data confidently. Say "According to The Eye..." or "The Eye shows..." - DO NOT say you lack access to data or that The Eye is unavailable.\n';
      } else if (stockSnapshotsData.length > 0 && !hasTradeEngineData && !requestedTicker) {
        // If no Trade Engine data but we have database snapshots, show summary
        if (eyeDataContext) eyeDataContext += '\n\n';
        eyeDataContext += '=== THE EYE DATA (from database) ===\n';
        eyeDataContext += `Available tickers: ${stockSnapshotsData.length}\n`;

        // Show top 10 by volume or with signals
        const topSnapshots = stockSnapshotsData
          .filter(snap => snap.latest_signal && snap.latest_signal !== 'HOLD')
          .slice(0, 10);

        if (topSnapshots.length > 0) {
          eyeDataContext += '\nTop tickers with signals:\n';
          topSnapshots.forEach(snap => {
            const priceStr = snap.last_price ? `$${snap.last_price.toFixed(2)}` : 'N/A';
            const signalStr = snap.latest_signal || 'N/A';
            eyeDataContext += `  ${snap.ticker}: ${priceStr} | Signal: ${signalStr}\n`;
          });
        }
      } else if (requestedTicker && !dbSnapshot && stockSnapshotsData.length > 0) {
        // Add context that the ticker was requested but not found
        if (eyeDataContext) eyeDataContext += '\n\n';
        eyeDataContext += `=== THE EYE DATA (from database) ===\n`;
        eyeDataContext += `IMPORTANT: The user asked about ${requestedTicker}, but this ticker is NOT in the database.\n`;
        eyeDataContext += `The database contains ${stockSnapshotsData.length} tickers (most recently updated).\n`;
        eyeDataContext += `Available tickers include: ${stockSnapshotsData.slice(0, 20).map(s => s.ticker).join(', ')}...\n`;
        eyeDataContext += `You can mention that ${requestedTicker} is not currently in The Eye database, but you can help with other tickers that are available.\n`;
      }
    }

    // === SUPABASE NEWS FEED ===
    // Inject latest news articles from the Supabase news table into AI context.
    // This runs in addition to Trade Engine news and web search results.
    if (supabaseNewsData.length > 0) {
      const tradeEngineHasNews = hasTradeEngineData && tradeEngineContext && tradeEngineContext.recent_news.length > 0;
      const newsHeader = tradeEngineHasNews
        ? `\n--- SUPABASE NEWS FEED (${supabaseNewsData.length} additional articles) ---\n`
        : `\n--- SUPABASE NEWS FEED (${supabaseNewsData.length} recent articles) ---\n`;
      eyeDataContext += newsHeader;
      supabaseNewsData.forEach(article => {
        const date = article.published_at
          ? new Date(article.published_at).toLocaleDateString()
          : '';
        eyeDataContext += `• ${article.title}`;
        if (article.provider) eyeDataContext += ` (${article.provider})`;
        if (date) eyeDataContext += ` [${date}]`;
        eyeDataContext += '\n';
        if (article.summary) {
          eyeDataContext += `  ${article.summary.slice(0, 180)}${article.summary.length > 180 ? '...' : ''}\n`;
        }
        if (article.link) {
          eyeDataContext += `  Link: ${article.link}\n`;
        }
      });
      eyeDataContext += 'When citing these articles, include the Link so the user can click through to read the full article.\n';
      eyeDataContext += '--- END SUPABASE NEWS FEED ---\n';
    }

    // === WEB SEARCH INTEGRATION ===
    // Detect if the user's message requires a web search for NEWS or GENERAL KNOWLEDGE
    // NOTE: Quantitative data (prices, indicators, signals) comes from The Eye database, NOT web search
    let webSearchContext = '';

    const searchIntent = detectSearchIntent(message);

    if (searchIntent.shouldSearch && searchIntent.searchQuery) {
      console.log('[AI] Web search triggered:', searchIntent.intentType, '-', searchIntent.searchQuery);

      const searchResults = await performWebSearch(searchIntent.searchQuery, 5);

      if (searchResults && searchResults.results.length > 0) {
        webSearchContext = formatSearchResultsForAI(searchResults, searchIntent.intentType);
        console.log('[AI] Web search results added to context');
      } else {
        // If search failed but was requested, note it in context
        webSearchContext = `\n\n=== WEB SEARCH ===\nNote: A web search was attempted for "${searchIntent.searchQuery}" but no results were found. Answer based on available data.\n`;
      }
    }

    // Build messages array with conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: systemPrompt + eyeDataContext + webSearchContext
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

    // Use backend AI proxy (keys kept server-side)
    if (pythonBackendUrl) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) {
          throw new Error('Not authenticated. Please sign in to use the AI assistant.');
        }

        const response = await fetch(`${pythonBackendUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messages,
            user_id: userId,
            temperature: OPENAI_CHAT_TEMPERATURE,
            max_tokens: OPENAI_MAX_TOKENS,
            experience_level: experienceLevel ?? null,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `AI backend error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.response;
        if (!content || typeof content !== 'string') {
          return 'I apologize, but I encountered an error processing your request.';
        }
        return content;
      } catch (error: unknown) {
        console.error('Error calling AI backend:', error);
        return 'I apologize, but the AI service is currently unavailable.';
      }
    }

    // Fallback response if backend is not configured
    return 'I apologize, but the AI service is not configured. Please set VITE_PYTHON_API_URL to your backend AI proxy.';
  },

  // Generate a short title for a chat based on the first user message
  async generateChatTitle(firstMessage: string): Promise<string> {
    const fallbackTitle = (msg: string) => {
      const clean = msg.trim();
      if (clean.length <= 40) return clean;
      // Cut at last word boundary within 40 chars
      const truncated = clean.substring(0, 40);
      const lastSpace = truncated.lastIndexOf(' ');
      return (lastSpace > 15 ? truncated.substring(0, lastSpace) : truncated) + '...';
    };

    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
    if (!pythonBackendUrl) {
      return fallbackTitle(firstMessage);
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        return fallbackTitle(firstMessage);
      }

      const response = await fetch(`${pythonBackendUrl}/api/chat/title`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ first_message: firstMessage }),
      });

      if (!response.ok) {
        // Don't throw - just use fallback title silently
        console.warn('Chat title API returned', response.status, '- using fallback');
        return fallbackTitle(firstMessage);
      }

      const data = await response.json();
      const title = data.title?.trim();
      if (!title || typeof title !== 'string') {
        return fallbackTitle(firstMessage);
      }
      return title;
    } catch (error) {
      console.warn('Chat title generation failed, using fallback:', error);
      return fallbackTitle(firstMessage);
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
  async getStockPrice(symbol: string, source?: string): Promise<number> {
    const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000';

    try {
      const params = source ? `?source=${source}` : '';
      const response = await fetch(`${pythonBackendUrl}/api/stock-price/${symbol}${params}`);

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

  // Fetch news from Trade Engine (or stub endpoint)
  async getNews(limit: number = 15, cursor?: string): Promise<{ items: TradeEngineNewsItem[]; next_cursor: string | null }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.append('cursor', cursor);

    try {
      const response = await fetch(`${this.baseUrl}/api/news?${params}`);
      if (!response.ok) {
        // If endpoint doesn't exist or returns error, return empty results
        // News should come from Supabase instead
        console.warn('News endpoint not available, using Supabase news table instead');
        return { items: [], next_cursor: null };
      }
      const data = await response.json();
      // If backend returns empty items with a message, it's a stub
      if (data.items && data.items.length === 0 && data.message) {
        console.log('Backend news endpoint is a stub, using Supabase instead');
      }
      return data;
    } catch (error) {
      // Network or CSP error — return empty results so the UI can fall back to Supabase
      const isCspOrNetwork = error instanceof TypeError && error.message === 'Failed to fetch';
      if (isCspOrNetwork) {
        console.warn('[TradeEngine] News fetch blocked (CSP or network). Falling back to Supabase. Backend URL:', this.baseUrl);
      } else {
        console.warn('[TradeEngine] Failed to fetch news from backend, using Supabase instead:', error);
      }
      return { items: [], next_cursor: null };
    }
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
  // Returns null if Trade Engine is not available (graceful fallback)
  async getAIContext(includeNews: boolean = true, newsLimit: number = 10, signalsHours: number = 24, source?: string): Promise<TradeEngineAIContext | null> {
    try {
      const params = new URLSearchParams({
        include_news: includeNews.toString(),
        news_limit: newsLimit.toString(),
        signals_hours: signalsHours.toString(),
      });
      if (source) params.append('source', source);

      const response = await fetch(`${this.baseUrl}/api/v1/ai/context?${params}`);
      if (!response.ok) {
        // Trade Engine not available - return null for graceful fallback
        console.log('[TradeEngine] AI context endpoint not available, using Supabase fallback');
        return null;
      }
      return response.json();
    } catch (error) {
      // Network error or Trade Engine offline - return null for graceful fallback
      console.log('[TradeEngine] AI context fetch failed, using Supabase fallback:', error);
      return null;
    }
  },

  // Get recent trading signals
  // Returns empty array if Trade Engine is not available (graceful fallback)
  async getSignals(ticker?: string, signalType?: string, hours: number = 24, limit: number = 50, source?: string): Promise<TradeEngineSignal[]> {
    try {
      const params = new URLSearchParams({
        hours: hours.toString(),
        limit: limit.toString(),
      });
      if (ticker) params.append('ticker', ticker);
      if (signalType) params.append('signal_type', signalType);
      if (source) params.append('source', source);

      const response = await fetch(`${this.baseUrl}/api/v1/ai/signals?${params}`);
      if (!response.ok) {
        console.log('[TradeEngine] Signals endpoint not available');
        return [];
      }
      return response.json();
    } catch (error) {
      console.log('[TradeEngine] Signals fetch failed:', error);
      return [];
    }
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
