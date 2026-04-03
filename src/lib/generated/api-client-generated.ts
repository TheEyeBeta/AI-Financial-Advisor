/**
 * Type-safe API client generated from the OpenAPI spec.
 *
 * This wraps the shared `apiClient` from `@/lib/api-client` with method
 * signatures derived from `docs/openapi.json`.  Only Python backend endpoints
 * are covered here — Supabase-backed services stay in their own modules.
 *
 * **Do not hand-edit** — regenerate with `npm run generate:api-types`.
 */

import { apiClient } from '@/lib/api-client';
import type { components, operations } from './api-types';

// ─── Re-export schema types for convenience ─────────────────────────────────

export type ChatRequest = components['schemas']['ChatRequest'];
export type ChatTitleRequest = components['schemas']['ChatTitleRequest'];
export type MeridianOnboardRequest = components['schemas']['MeridianOnboardRequest'];
export type QuantitativeAnalysisRequest = components['schemas']['QuantitativeAnalysisRequest'];
export type AIContextResponse = components['schemas']['AIContextResponse'];
export type RankingResponse = components['schemas']['RankingResponse'];
export type TradingSignal = components['schemas']['TradingSignal'];
export type TickerSnapshot = components['schemas']['TickerSnapshot'];
export type StockScore = components['schemas']['StockScore'];
export type EngineStatus = components['schemas']['EngineStatus'];

// ─── Helper: extract 200 JSON body type from an operation ───────────────────

type JsonBody<Op> = Op extends { responses: { 200: { content: { 'application/json': infer B } } } }
  ? B
  : unknown;

// ─── Typed client ───────────────────────────────────────────────────────────

/** Search the web via the backend proxy. */
export function searchWeb(
  query: string,
  maxResults?: number,
): Promise<JsonBody<operations['search_web_api_search_get']>> {
  const params = new URLSearchParams({ query });
  if (maxResults !== undefined) params.set('max_results', String(maxResults));
  return apiClient.get(`/api/search?${params}`);
}

/** Send a chat message to the AI advisor. */
export function chatCompletion(
  body: ChatRequest,
): Promise<JsonBody<operations['chat_completion_api_chat_post']>> {
  return apiClient.post('/api/chat', body, { skipRetry: true });
}

/** Generate a short title for a chat conversation. */
export function chatTitle(
  body: ChatTitleRequest,
): Promise<JsonBody<operations['chat_title_api_chat_title_post']>> {
  return apiClient.post('/api/chat/title', body, { skipRetry: true });
}

/** Analyse quantitative data via the AI backend. */
export function analyzeQuantitative(
  body: QuantitativeAnalysisRequest,
): Promise<JsonBody<operations['analyze_quantitative_data_api_ai_analyze_quantitative_post']>> {
  return apiClient.post('/api/ai/analyze-quantitative', body);
}

/** Onboard a user into the Meridian planning system. */
export function meridianOnboard(
  body: MeridianOnboardRequest,
): Promise<JsonBody<operations['meridian_onboard_api_meridian_onboard_post']>> {
  return apiClient.post('/api/meridian/onboard', body);
}

/** Fetch comprehensive AI context (ticker snapshots, signals, news). */
export function getAIContext(
  options?: operations['get_ai_context_api_v1_ai_context_get']['parameters']['query'],
): Promise<AIContextResponse> {
  const params = new URLSearchParams();
  if (options?.include_news !== undefined) params.set('include_news', String(options.include_news));
  if (options?.news_limit !== undefined) params.set('news_limit', String(options.news_limit));
  if (options?.signals_hours !== undefined) params.set('signals_hours', String(options.signals_hours));
  if (options?.source) params.set('source', options.source);
  const qs = params.toString();
  return apiClient.get(`/api/v1/ai/context${qs ? `?${qs}` : ''}`, { skipRetry: true });
}

/** Fetch recent trading signals. */
export function getSignals(
  options?: operations['get_signals_api_v1_ai_signals_get']['parameters']['query'],
): Promise<TradingSignal[]> {
  const params = new URLSearchParams();
  if (options?.ticker) params.set('ticker', options.ticker);
  if (options?.signal_type) params.set('signal_type', options.signal_type);
  if (options?.hours !== undefined) params.set('hours', String(options.hours));
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.source) params.set('source', options.source);
  const qs = params.toString();
  return apiClient.get(`/api/v1/ai/signals${qs ? `?${qs}` : ''}`, { skipRetry: true });
}

/** Get Trade Engine / DataAPI connection status. */
export function getEngineStatus(
  source?: string,
): Promise<JsonBody<operations['get_engine_status_api_v1_engine_status_get']>> {
  const qs = source ? `?source=${source}` : '';
  return apiClient.get(`/api/v1/engine/status${qs}`, { skipRetry: true });
}

/** Get the last known price for a ticker. */
export function getStockPrice(
  ticker: string,
  source?: string,
): Promise<JsonBody<operations['get_stock_price_api_stock_price__ticker__get']>> {
  const qs = source ? `?source=${source}` : '';
  return apiClient.get(`/api/stock-price/${encodeURIComponent(ticker)}${qs}`);
}

/** Get stocks ranked by composite score. */
export function getStockRanking(
  options?: operations['get_stock_ranking_api_stocks_ranking_get']['parameters']['query'],
): Promise<RankingResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.min_score !== undefined) params.set('min_score', String(options.min_score));
  const qs = params.toString();
  return apiClient.get(`/api/stocks/ranking${qs ? `?${qs}` : ''}`);
}

/** Get news articles (stub — frontend should use Supabase directly). */
export function getNews(
  options?: { limit?: number; cursor?: string | null },
): Promise<JsonBody<operations['get_news_api_news_get']>> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.cursor) params.set('cursor', options.cursor);
  const qs = params.toString();
  return apiClient.get(`/api/news${qs ? `?${qs}` : ''}`, { skipRetry: true });
}

/** Backend health check (no auth required). */
export function healthCheck(): Promise<JsonBody<operations['health_check_health_get']>> {
  return apiClient.get('/health', { skipAuth: true, skipRetry: true });
}
