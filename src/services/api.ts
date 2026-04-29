import { supabase } from '@/lib/supabase';
import { getPythonApiUrl } from '@/lib/env';
import { apiClient, ApiError } from '@/lib/api-client';
import { createStockSnapshotsApi, type StockSnapshotQuery } from '@/services/stock-cache';
import { createStreamTimeout, getTimeoutForMessage } from '@/services/chat-api';
import type {
  NewsArticle,
} from '@/types/database';

// Legacy compatibility module.
// New code should import focused modules from src/services/*-api.ts instead.

// Constants for input validation and API configuration
const MAX_MESSAGE_LENGTH = 10000;
const MAX_CHAT_HISTORY_MESSAGES = 30;
const OPENAI_MAX_TOKENS = 2000;
const OPENAI_CHAT_TEMPERATURE = 0.7;

export { portfolioApi, positionsApi, tradesApi, journalApi } from '@/services/trading-api';

export { chatApi, chatsApi } from '@/services/chat-api';

export { achievementsApi, learningApi, marketApi } from '@/services/user-data-api';

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


const fromStockSnapshots = () => supabase.schema('market').from('stock_snapshots') as StockSnapshotQuery;

// Stock Snapshots API - Read financial data from database (with caching)
export const stockSnapshotsApi = createStockSnapshotsApi(fromStockSnapshots);

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

export interface TopStocksOptions {
  limit?: number;
  minScore?: number;
}

export interface TopStocksResult {
  stocks: StockScore[];
  totalScored: number;
  lastRankedAt: string | null;
  dataAgeHours: number | null;
}

// Calls GET /api/stocks/ranking on the Python backend.
// The backend returns the current pre-computed daily ranking from market.trending_stocks.
export const stockRankingApi = {
  async getRanking(options: TopStocksOptions = {}): Promise<TopStocksResult> {
    const { limit = 20, minScore = 0 } = options;
    const backendUrl = getPythonApiUrl();

    const params = new URLSearchParams({
      limit: String(limit),
      min_score: String(minScore),
    });

    try {
      const data = await apiClient.get<{
        stocks: StockScore[];
        total: number;
        last_ranked_at: string | null;
        data_age_hours: number | null;
      }>(`/api/stocks/ranking?${params}`);

      return {
        stocks: data.stocks,
        totalScored: data.total,
        lastRankedAt: data.last_ranked_at,
        dataAgeHours: data.data_age_hours,
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


// NOTE: System prompt assembly has moved to the backend (ai_proxy.py).
// The backend builds the full IRIS prompt from experience_level, session_type, and raw context.
// This stub is retained only to avoid breaking any residual callers; it is not used in new code.
function _getSystemPrompt(experienceLevel: ExperienceLevel, hasEyeData: boolean = false): string {
  // Default to intermediate if null
  const level = experienceLevel ?? 'intermediate';

  const baseRules = `
IDENTITY:
You are the AI behind The Eye, a financial research platform. You are not a generic chatbot. Speak with clarity and analytical discipline.

PERSONALITY:
- Be direct. Say what you actually think. Don't hedge everything into meaninglessness.
- When you have a view, frame it as analysis: "The case looks stronger because..." not "You should buy this."
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
- Do not tell users what they personally should buy, sell, or allocate.
- You may explain analytical scenarios, trade-offs, and decision frameworks.
- When using directional language, clearly label it as educational analysis and remind the user it is not personalised investment advice.

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
- Be confident about the data you actually have. Do not overclaim certainty.
- Connect data points when reasoning: "RSI at 72 combined with the volume spike suggests..."
` : `
THE EYE TRADE ENGINE (NOT CONNECTED):
- The Eye trade engine isn't connected right now.
- For live prices, signals, or market data, say clearly that The Eye is offline.
- You can still reason about finance, use web search for news, and give general educational analysis.
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

interface ChatStreamEvent {
  content?: string;
  done?: boolean;
  error?: string;
}

function normalizeStreamBuffer(buffer: string): string {
  return buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = await response.json() as { detail?: string; message?: string; error?: string };
      return body.message ?? body.detail ?? body.error ?? response.statusText;
    } catch {
      return response.statusText;
    }
  }

  try {
    const body = await response.text();
    return body || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function consumeChatStream(
  response: Response,
  onChunk?: (chunk: string) => void,
  onChunkReceived?: () => void,
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new ApiError(response.status, message);
  }

  if (contentType.includes('application/json')) {
    const body = await response.json() as { response?: string };
    const content = typeof body.response === 'string' ? body.response : '';
    if (content) {
      onChunk?.(content);
    }
    return content;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let assembled = '';

  const processBuffer = (): { done: boolean } => {
    while (true) {
      const eventBoundary = buffer.indexOf('\n\n');
      if (eventBoundary === -1) {
        return { done: false };
      }

      const rawEvent = buffer.slice(0, eventBoundary).trim();
      buffer = buffer.slice(eventBoundary + 2);

      if (!rawEvent) {
        continue;
      }

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) {
        continue;
      }

      let event: ChatStreamEvent;
      try {
        event = JSON.parse(dataLines.join('\n')) as ChatStreamEvent;
      } catch {
        continue;
      }

      if (typeof event.content === 'string' && event.content.length > 0) {
        assembled += event.content;
        onChunk?.(event.content);
      }

      if (event.error) {
        if (assembled.length > 0 && event.error === 'Stream interrupted') {
          throw new Error('Connection lost while streaming the response. Please try again.');
        }
        throw new Error(event.error);
      }

      if (event.done) {
        return { done: true };
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer = normalizeStreamBuffer(buffer + decoder.decode());
        break;
      }

      onChunkReceived?.();
      buffer = normalizeStreamBuffer(buffer + decoder.decode(value, { stream: true }));
      const result = processBuffer();
      if (result.done) {
        return assembled;
      }
    }

    const finalResult = processBuffer();
    if (finalResult.done) {
      return assembled;
    }
  } finally {
    reader.releaseLock();
  }

  if (assembled.length > 0) {
    throw new Error('Connection lost while streaming the response. Please try again.');
  }

  throw new Error('Stream ended before completion.');
}

// Python Backend API endpoint helpers
// These can be configured to call your Python backend for AI responses, live market data, etc.
export const pythonApi = {
  // Analyze quantitative data using Deepseek (compliance-safe: only sends numerical data, no PII)
  async analyzeQuantitativeData(quantitativeData: Record<string, number | undefined>): Promise<string> {
    // Filter out undefined values
    const sanitizedData = Object.fromEntries(
      Object.entries(quantitativeData).filter(([_, value]) => value !== undefined)
    );

    // If no data to analyze, return empty
    if (Object.keys(sanitizedData).length === 0) {
      return '';
    }

    try {
      const data = await apiClient.post<{ response?: string }>(
        '/api/ai/analyze-quantitative',
        { quantitative_data: sanitizedData },
      );
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
    tradeEngineContext?: TradeEngineAIContext | null,
    onChunk?: (chunk: string) => void,
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

    const pythonBackendUrl = getPythonApiUrl();

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

    // Pass raw context to backend — backend assembles the full system prompt
    const context = {
      market_data: tradeEngineContext ?? null,
    };

    // Build messages array — no system message (backend owns prompt assembly)
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Add conversation history (last N messages to stay within token limits)
    if (chatHistory && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-MAX_CHAT_HISTORY_MESSAGES);
      messages.push(...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    }

    // Add current user message
    messages.push({ role: 'user', content: message });

    // Use backend AI proxy (keys kept server-side)
    if (pythonBackendUrl) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('Not authenticated. Please sign in to use the AI assistant.');
        }

        const chatUrl = new URL('/api/chat', pythonBackendUrl).toString();
        const timeout = getTimeoutForMessage(message);
        const streamTimeout = createStreamTimeout(timeout, message);

        try {
          const response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
              'Accept': 'text/event-stream',
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messages,
              user_id: userId,
              temperature: OPENAI_CHAT_TEMPERATURE,
              max_tokens: OPENAI_MAX_TOKENS,
              experience_level: experienceLevel ?? null,
              context,
              session_type: 'advisor',
            }),
            signal: streamTimeout.controller.signal,
          });

          const content = await consumeChatStream(response, onChunk, streamTimeout.resetForChunk);
          if (!content || typeof content !== 'string') {
            throw new Error('The AI returned an empty response.');
          }

          return content;
        } finally {
          streamTimeout.cancel();
        }
      } catch (error: unknown) {
        console.error('Error calling AI backend:', error);
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('The AI took too long to respond. Please try again.');
        }
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          throw new Error('Unable to reach the AI service. Please try again.');
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('The AI service is currently unavailable.');
      }
    }

    // Fallback response if backend is not configured
    throw new Error('The AI service is not configured. Please set VITE_PYTHON_API_URL to your backend AI proxy.');
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

    try {
      const data = await apiClient.post<{ title?: string }>(
        '/api/chat/title',
        { first_message: firstMessage },
        { skipRetry: true },
      );
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
    try {
      const pythonBackendUrl = getPythonApiUrl();
      if (!pythonBackendUrl) {
        throw new Error('The AI service is not configured. Please set VITE_PYTHON_API_URL to your backend AI proxy.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in to use the AI assistant.');
      }

      const chatUrl = new URL('/api/chat', pythonBackendUrl).toString();
      const timeout = getTimeoutForMessage(message);
      const streamTimeout = createStreamTimeout(timeout, message);

      try {
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, user_id: userId }),
          signal: streamTimeout.controller.signal,
        });

        const content = await consumeChatStream(response, undefined, streamTimeout.resetForChunk);
        return content || 'I apologize, but I encountered an error processing your request.';
      } finally {
        streamTimeout.cancel();
      }
    } catch (error) {
      console.error('Error calling Python API:', error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'The AI took too long to respond. Please try again.';
      }
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        return 'Unable to reach the AI service. Please try again.';
      }
      if (error instanceof Error) {
        return error.message;
      }
      return 'I apologize, but the AI service is currently unavailable. Please try again later.';
    }
  },

  // Example: Get live stock prices from Python backend
  async getStockPrice(symbol: string, source?: string): Promise<number> {
    try {
      const params = source ? `?source=${source}` : '';
      const data = await apiClient.get<{ price: number }>(`/api/stock-price/${symbol}${params}`);
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
  get baseUrl() {
    return getPythonApiUrl();
  },

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

// ---------------------------------------------------------------------------
// Admin API helpers
// ---------------------------------------------------------------------------

export interface SchedulerJob {
  id: string;
  name: string;
  schedule: string;
  last_run: string | null;
  status: string;
}

export interface JobRunLog {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: "success" | "error" | "skipped";
  records_processed: number | null;
  summary: string | null;
  error: string | null;
  created_at: string;
}

async function _getAdminAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated — please sign in again");
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export const adminApi = {
  async triggerRanking(): Promise<{ status: string }> {
    const headers = await _getAdminAuthHeaders();
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-ranking`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ status: string }>;
  },

  async triggerIntelligence(): Promise<{ status: string }> {
    const headers = await _getAdminAuthHeaders();
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-intelligence`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ status: string }>;
  },

  async triggerMemoryExtraction(): Promise<{ status: string }> {
    const headers = await _getAdminAuthHeaders();
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-memory-extraction`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ status: string }>;
  },

  async triggerMeridianRefresh(): Promise<{ status: string }> {
    const headers = await _getAdminAuthHeaders();
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-meridian-refresh`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ status: string }>;
  },

  async getSchedulerStatus(): Promise<{ jobs: SchedulerJob[] }> {
    const headers = await _getAdminAuthHeaders();
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/scheduler-status`, { headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ jobs: SchedulerJob[] }>;
  },

  async getJobRunLogs(jobName: string, limit = 10): Promise<{ logs: JobRunLog[] }> {
    const headers = await _getAdminAuthHeaders();
    const url = `${getPythonApiUrl()}/api/admin/job-run-logs?job_name=${encodeURIComponent(jobName)}&limit=${limit}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<{ logs: JobRunLog[] }>;
  },
};
