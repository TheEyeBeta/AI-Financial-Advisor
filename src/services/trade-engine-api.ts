import { getPythonApiUrl } from '@/lib/env';
import { apiClient, ApiError } from '@/lib/api-client';

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
  ticker: string;
  company_name: string | null;
  last_price: number | null;
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
  atr: number | null;
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
  latest_signal: string | null;
  signal_strategy: string | null;
  signal_confidence: number | null;
  signal_timestamp: string | null;
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
    total_tracked_tickers: number;
    tickers_with_data: number;
    tickers_with_indicators: number | null;
    tickers_with_fundamentals: number | null;
    buy_signals_count: number;
    sell_signals_count: number;
    hold_signals_count: number;
    tickers_with_buy: string[];
    tickers_with_sell: string[];
    average_rsi: number | null;
    average_pe_ratio: number | null;
    bullish_tickers: number | null;
    bearish_tickers: number | null;
    oversold_tickers: number | null;
    overbought_tickers: number | null;
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

export const tradeEngineApi = {
  get baseUrl() {
    return getPythonApiUrl();
  },

  async getNews(limit: number = 15, cursor?: string): Promise<{ items: TradeEngineNewsItem[]; next_cursor: string | null }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.append('cursor', cursor);

    try {
      const data = await apiClient.get<{ items: TradeEngineNewsItem[]; next_cursor: string | null; message?: string }>(
        `/api/news?${params}`,
        { skipRetry: true },
      );
      if (data.items && data.items.length === 0 && data.message) {
        console.log('Backend news endpoint is a stub, using Supabase instead');
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        console.warn('News endpoint not available, using Supabase news table instead');
      } else {
        const isCspOrNetwork = error instanceof TypeError && error.message === 'Failed to fetch';
        if (isCspOrNetwork) {
          console.warn('[TradeEngine] News fetch blocked (CSP or network). Falling back to Supabase. Backend URL:', this.baseUrl);
        } else {
          console.warn('[TradeEngine] Failed to fetch news from backend, using Supabase instead:', error);
        }
      }
      return { items: [], next_cursor: null };
    }
  },

  async getTechnicalIndicators(ticker: string, date?: string): Promise<TradeEngineTechnicalIndicators> {
    const params = date ? `?date=${date}` : '';
    return apiClient.get<TradeEngineTechnicalIndicators>(`/api/v1/indicators/${ticker}/technical${params}`);
  },

  async getPriceData(ticker: string, startDate?: string, endDate?: string, limit: number = 100): Promise<TradeEnginePriceData[]> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    return apiClient.get<TradeEnginePriceData[]>(`/api/v1/charting/${ticker}/prices?${params}`);
  },

  async getTickers(activeOnly: boolean = true): Promise<Array<{ ticker_id: number; ticker: string; name: string }>> {
    return apiClient.get(`/api/v1/tickers?active_only=${activeOnly}`);
  },

  async healthCheck(): Promise<{ status: string; healthy: boolean }> {
    try {
      return await apiClient.get<{ status: string; healthy: boolean }>('/health', { skipAuth: true, skipRetry: true });
    } catch {
      return { status: 'error', healthy: false };
    }
  },

  async getAIContext(includeNews: boolean = true, newsLimit: number = 10, signalsHours: number = 24, source?: string): Promise<TradeEngineAIContext | null> {
    try {
      const params = new URLSearchParams({
        include_news: includeNews.toString(),
        news_limit: newsLimit.toString(),
        signals_hours: signalsHours.toString(),
      });
      if (source) params.append('source', source);

      return await apiClient.get<TradeEngineAIContext>(`/api/v1/ai/context?${params}`, { skipRetry: true });
    } catch (error) {
      if (error instanceof ApiError) {
        console.log('[TradeEngine] AI context endpoint not available, using Supabase fallback');
      } else {
        console.log('[TradeEngine] AI context fetch failed, using Supabase fallback:', error);
      }
      return null;
    }
  },

  async getSignals(ticker?: string, signalType?: string, hours: number = 24, limit: number = 50, source?: string): Promise<TradeEngineSignal[]> {
    try {
      const params = new URLSearchParams({
        hours: hours.toString(),
        limit: limit.toString(),
      });
      if (ticker) params.append('ticker', ticker);
      if (signalType) params.append('signal_type', signalType);
      if (source) params.append('source', source);

      return await apiClient.get<TradeEngineSignal[]>(`/api/v1/ai/signals?${params}`, { skipRetry: true });
    } catch (error) {
      if (error instanceof ApiError) {
        console.log('[TradeEngine] Signals endpoint not available');
      } else {
        console.log('[TradeEngine] Signals fetch failed:', error);
      }
      return [];
    }
  },

  async getPortfolioSummary(): Promise<TradeEnginePortfolioSummary> {
    return apiClient.get<TradeEnginePortfolioSummary>('/api/v1/ai/portfolio');
  },

  async getTickerDetails(ticker: string): Promise<TradeEngineTickerDetails> {
    return apiClient.get<TradeEngineTickerDetails>(`/api/v1/ai/ticker/${ticker}`);
  },
};
