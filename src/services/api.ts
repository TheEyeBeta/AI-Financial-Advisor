import { supabase } from '@/lib/supabase';
import { getPythonApiUrl } from '@/lib/env';
import { apiClient, ApiError } from '@/lib/api-client';
import { createStockSnapshotsApi, type StockSnapshotQuery } from '@/services/stock-cache';
import { createStreamTimeout, getTimeoutForMessage } from '@/services/chat-api';
import type { TradeEngineAIContext } from '@/services/trade-engine-api';
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
  stability_score: number | null;
  technical_score: number;
  fundamental_score: number;
  risk_score: number;
  quality_score: number;
  ml_score: number | null;
  has_ml_data: boolean;
  dimensions_bullish: number;
  momentum_20d_pct: number | null;
  volatility_20d: number | null;
  hard_filter_passed: boolean | null;
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

// Absolute ceiling on a single stream — independent of the per-chunk idle
// timeout in chat-api.ts. Protects against an upstream that keeps the
// connection alive with a steady drip of whitespace tokens or a model loop.
// Set above the longest tier cap (120s) so it only fires on genuinely stuck
// streams, not on legitimately long deep-analysis responses.
export const STREAM_WALL_CLOCK_TIMEOUT_MS = 180_000;

export async function consumeChatStream(
  response: Response,
  onChunk?: (chunk: string) => void,
  onChunkReceived?: () => void,
  wallClockTimeoutMs: number = STREAM_WALL_CLOCK_TIMEOUT_MS,
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

  // Hard deadline that fires even if chunks keep arriving. We resolve a
  // sentinel promise on expiry and Promise.race it against each read.
  let wallClockExpired = false;
  let wallClockReject: ((err: Error) => void) | null = null;
  const wallClockPromise = new Promise<never>((_, reject) => {
    wallClockReject = reject;
  });
  const wallClockId =
    wallClockTimeoutMs > 0
      ? setTimeout(() => {
          wallClockExpired = true;
          void reader.cancel().catch(() => {
            /* reader may already be released */
          });
          wallClockReject?.(new Error('Stream exceeded maximum duration. Please try again.'));
        }, wallClockTimeoutMs)
      : null;

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
      const { value, done } = await Promise.race([reader.read(), wallClockPromise]);
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
    if (wallClockId !== null) {
      clearTimeout(wallClockId);
    }
    reader.releaseLock();
  }

  if (wallClockExpired) {
    throw new Error('Stream exceeded maximum duration. Please try again.');
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

async function _getAdminAuthHeaders(idempotencyKey?: string): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated — please sign in again");
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

function _adminIdempotencyKey(action: string): string {
  return `${action}-${crypto.randomUUID()}`;
}

export interface AdminJobResponse {
  status: string;
  job_id?: string;
  job_type?: string;
  duplicate?: boolean;
  correlation_id?: string;
  limit?: number;
}

export const adminApi = {
  async triggerRanking(): Promise<AdminJobResponse> {
    const headers = await _getAdminAuthHeaders(_adminIdempotencyKey("ranking"));
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-ranking`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<AdminJobResponse>;
  },

  async triggerIntelligence(): Promise<AdminJobResponse> {
    const headers = await _getAdminAuthHeaders(_adminIdempotencyKey("intelligence"));
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-intelligence`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<AdminJobResponse>;
  },

  async triggerMemoryExtraction(): Promise<AdminJobResponse> {
    const headers = await _getAdminAuthHeaders(_adminIdempotencyKey("memory-extraction"));
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-memory-extraction`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<AdminJobResponse>;
  },

  async triggerMeridianRefresh(): Promise<AdminJobResponse> {
    const headers = await _getAdminAuthHeaders(_adminIdempotencyKey("meridian-refresh"));
    const resp = await fetch(`${getPythonApiUrl()}/api/admin/trigger-meridian-refresh`, { method: "POST", headers });
    if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
    return resp.json() as Promise<AdminJobResponse>;
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
