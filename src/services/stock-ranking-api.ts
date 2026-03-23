import { getPythonApiUrl, isLocalBackendUrl } from '@/lib/env';
import { apiClient } from '@/lib/api-client';
import { stockSnapshotsApi } from '@/services/stock-snapshots-api';
import type { StockSnapshot } from '@/types/database';

export interface StockScore {
  ticker: string;
  company_name: string | null;
  last_price: number | null;
  price_change_pct: number | null;
  updated_at: string | null;
  composite_score: number;
  smoothed_score: number;
  rank_tier: string;
  conviction: string;
  momentum_score: number;
  technical_score: number;
  fundamental_score: number;
  risk_score: number;
  quality_score: number;
  ml_score: number | null;
  has_ml_data: boolean;
  dimensions_bullish: number;
  tier_held_cycles: number;
  breakdown: {
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
    volume_ratio: number | null;
    price_vs_sma_50: number | null;
    price_vs_sma_200: number | null;
    price_vs_ema_50: number | null;
    fifty_two_week_position: number | null;
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

const HORIZON_WEIGHTS = {
  short: {
    with_ml: { momentum: 0.25, technical: 0.28, fundamental: 0.07, risk: 0.10, quality: 0.05, ml: 0.25 },
    without_ml: { momentum: 0.32, technical: 0.35, fundamental: 0.10, risk: 0.13, quality: 0.10 },
  },
  long: {
    with_ml: { momentum: 0.07, technical: 0.08, fundamental: 0.35, risk: 0.15, quality: 0.22, ml: 0.13 },
    without_ml: { momentum: 0.08, technical: 0.10, fundamental: 0.40, risk: 0.18, quality: 0.24 },
  },
  balanced: {
    with_ml: { momentum: 0.15, technical: 0.20, fundamental: 0.25, risk: 0.12, quality: 0.10, ml: 0.18 },
    without_ml: { momentum: 0.19, technical: 0.24, fundamental: 0.31, risk: 0.14, quality: 0.12 },
  },
} as const;

const SUPABASE_FALLBACK_LIMIT = 500;
const DATA_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

function toNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number = 0, max: number = 100): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: Array<number | null | undefined>, fallback: number = 50): number {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function scoreBoolean(
  value: boolean | null | undefined,
  positive: number = 100,
  negative: number = 20,
  unknown: number = 50,
): number {
  if (value === true) return positive;
  if (value === false) return negative;
  return unknown;
}

function relativeStrengthScore(value: number | null, multiplier: number = 500): number | null {
  if (value === null) return null;
  return clamp(50 + value * multiplier);
}

function volumeRatioScore(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 2.5) return 100;
  if (value >= 1) return clamp(50 + (value - 1) * 33.3);
  return clamp(30 + value * 20);
}

function growthScore(value: number | null): number | null {
  if (value === null) return null;
  return clamp(50 + value * 500);
}

function profitabilityScore(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 0) return 15;
  return clamp(60 + Math.min(value, 5) * 8);
}

function valuationScore(value: number | null, idealMax: number, cautionMax: number): number | null {
  if (value === null) return null;
  if (value <= 0) return 15;
  if (value <= idealMax) return 100;
  if (value <= cautionMax) {
    return clamp(100 - ((value - idealMax) / Math.max(cautionMax - idealMax, 1)) * 55);
  }
  return clamp(45 - ((value - cautionMax) / Math.max(cautionMax, 1)) * 25);
}

function dividendYieldScore(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 0) return 35;
  const yieldPct = value * 100;
  if (yieldPct <= 2) return clamp(55 + yieldPct * 15);
  if (yieldPct <= 5) return 90;
  if (yieldPct <= 8) return 70;
  return 45;
}

function marketCapScore(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  if (value >= 1e12) return 100;
  if (value >= 2e11) return 90;
  if (value >= 5e10) return 80;
  if (value >= 1e10) return 68;
  if (value >= 2e9) return 55;
  return 40;
}

function distanceRiskScore(value: number | null): number | null {
  if (value === null) return null;
  return clamp(100 - Math.abs(value) * 350);
}

function rsiMomentumScore(rsi: number | null): number | null {
  if (rsi === null) return null;
  if (rsi >= 50 && rsi <= 65) return 100;
  if (rsi > 65 && rsi <= 70) return 90;
  if (rsi >= 45 && rsi < 50) return 80;
  if (rsi > 70 && rsi <= 80) return clamp(90 - (rsi - 70) * 6);
  if (rsi >= 30 && rsi < 45) return clamp(40 + ((rsi - 30) / 15) * 40);
  if (rsi < 30) return clamp((rsi / 30) * 40);
  return clamp(30 - (rsi - 80) * 3);
}

function rsiRiskScore(rsi: number | null): number | null {
  if (rsi === null) return null;
  if (rsi >= 40 && rsi <= 60) return 100;
  if ((rsi >= 30 && rsi < 40) || (rsi > 60 && rsi <= 70)) return 70;
  if (rsi < 30) return clamp(30 + rsi);
  return clamp(100 - (rsi - 70) * 3.5);
}

function adxTrendScore(adx: number | null): number | null {
  if (adx === null) return null;
  if (adx >= 40) return 100;
  if (adx >= 25) return 70 + ((adx - 25) / 15) * 30;
  if (adx >= 15) return 40 + ((adx - 15) / 10) * 30;
  return clamp((adx / 15) * 40);
}

function stochasticScore(k: number | null, d: number | null): number | null {
  if (k === null) return null;
  let score = 50;
  if (k >= 20 && k <= 80) {
    score = 60 + (Math.min(k, 60) - 20);
  } else if (k < 20) {
    score = 45;
  } else {
    score = 30;
  }
  if (d !== null && k > d) {
    score = Math.min(100, score + 10);
  }
  return clamp(score);
}

function williamsRScore(value: number | null): number | null {
  if (value === null) return null;
  const normalized = value + 100;
  if (normalized >= 20 && normalized <= 80) {
    return 60 + ((normalized - 20) / 60) * 30;
  }
  if (normalized < 20) return 40;
  return 25;
}

function cciScore(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 50 && value <= 150) return 80 + ((value - 50) / 100) * 20;
  if (value >= 0 && value < 50) return 50 + value;
  if (value >= -100 && value < 0) return clamp(50 + value / 2);
  if (value > 150) return clamp(100 - (value - 150) / 2, 10);
  return clamp(20 + (value + 200) / 5);
}

function getBollingerPosition(snapshot: StockSnapshot): number | null {
  const upper = toNumber(snapshot.bollinger_upper);
  const lower = toNumber(snapshot.bollinger_lower);
  const price = toNumber(snapshot.last_price);

  if (upper === null || lower === null || price === null || upper <= lower) {
    return null;
  }

  return clamp((price - lower) / (upper - lower), 0, 1);
}

function bollingerScore(position: number | null): number | null {
  if (position === null) return null;
  return clamp(100 - Math.abs(position - 0.6) * 160);
}

function get52WeekPosition(snapshot: StockSnapshot): number | null {
  const high = toNumber(snapshot.high_52w);
  const low = toNumber(snapshot.low_52w);
  const price = toNumber(snapshot.last_price);

  if (high === null || low === null || price === null || high <= low) {
    return null;
  }

  return clamp((price - low) / (high - low), 0, 1);
}

function latestSignalScore(signal: string | null): number | null {
  switch (signal) {
    case 'STRONG_BUY':
      return 100;
    case 'BUY':
      return 82;
    case 'HOLD':
      return 55;
    case 'SELL':
      return 25;
    case 'STRONG_SELL':
      return 10;
    default:
      return null;
  }
}

function mlSignalScore(snapshot: StockSnapshot): number | null {
  const confidence = toNumber(snapshot.signal_confidence);
  if (confidence === null) return null;

  if (snapshot.is_bullish === true) return clamp(confidence * 100);
  if (snapshot.is_bullish === false) return clamp((1 - confidence) * 100);
  return 50;
}

function isDataFresh(snapshot: StockSnapshot): boolean {
  const timestamp = snapshot.updated_at || snapshot.synced_at;
  if (!timestamp) return false;

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;

  return Date.now() - parsed <= DATA_FRESHNESS_WINDOW_MS;
}

function getBreakdown(snapshot: StockSnapshot): StockScore['breakdown'] {
  const macd = toNumber(snapshot.macd);
  const macdSignal = toNumber(snapshot.macd_signal);
  const sma50 = toNumber(snapshot.sma_50);
  const sma200 = toNumber(snapshot.sma_200);

  return {
    rsi_14: toNumber(snapshot.rsi_14),
    rsi_9: toNumber(snapshot.rsi_9),
    macd_above_signal: macd !== null && macdSignal !== null ? macd > macdSignal : null,
    macd_histogram: toNumber(snapshot.macd_histogram),
    golden_cross: sma50 !== null && sma200 !== null ? sma50 > sma200 : null,
    adx: toNumber(snapshot.adx),
    stochastic_k: toNumber(snapshot.stochastic_k),
    stochastic_d: toNumber(snapshot.stochastic_d),
    williams_r: toNumber(snapshot.williams_r),
    cci: toNumber(snapshot.cci),
    bollinger_position: getBollingerPosition(snapshot),
    volume_ratio: toNumber(snapshot.volume_ratio),
    price_vs_sma_50: toNumber(snapshot.price_vs_sma_50),
    price_vs_sma_200: toNumber(snapshot.price_vs_sma_200),
    price_vs_ema_50: toNumber(snapshot.price_vs_ema_50),
    fifty_two_week_position: get52WeekPosition(snapshot),
    pe_ratio: toNumber(snapshot.pe_ratio),
    forward_pe: toNumber(snapshot.forward_pe),
    peg_ratio: toNumber(snapshot.peg_ratio),
    price_to_book: toNumber(snapshot.price_to_book),
    price_to_sales: toNumber(snapshot.price_to_sales),
    eps: toNumber(snapshot.eps),
    eps_growth: toNumber(snapshot.eps_growth),
    revenue_growth: toNumber(snapshot.revenue_growth),
    dividend_yield: toNumber(snapshot.dividend_yield),
    market_cap: toNumber(snapshot.market_cap),
    signal_confidence: toNumber(snapshot.signal_confidence),
    is_bullish: typeof snapshot.is_bullish === 'boolean' ? snapshot.is_bullish : null,
    signal_strategy: snapshot.signal_strategy,
  };
}

function getRankTier(compositeScore: number): string {
  if (compositeScore >= 80) return 'Strong Buy';
  if (compositeScore >= 65) return 'Buy';
  if (compositeScore >= 45) return 'Hold';
  if (compositeScore >= 30) return 'Underperform';
  return 'Sell';
}

function getConviction(dimensionsBullish: number, compositeScore: number): string {
  if (dimensionsBullish >= 5 && compositeScore >= 70) return 'High';
  if (dimensionsBullish >= 3 && compositeScore >= 50) return 'Medium';
  return 'Low';
}

// ── EMA Smoothing + Tier Hysteresis (mirrors backend stabilization) ─────────

const EMA_ALPHA = 0.3;

const TIER_ORDER = ['Sell', 'Underperform', 'Hold', 'Buy', 'Strong Buy'];
const TIER_THRESHOLDS_UP: Record<string, number> = {
  'Strong Buy': 83,
  Buy: 68,
  Hold: 48,
  Underperform: 33,
};
const TIER_THRESHOLDS_DOWN: Record<string, number> = {
  'Strong Buy': 77,
  Buy: 62,
  Hold: 42,
  Underperform: 27,
};

interface PrevScoreData {
  score: number;
  tier: string;
  cycles: number;
}

// Previous smoothed scores per horizon (persists across React Query refetches within session)
const _prevScores: Record<string, Record<string, PrevScoreData>> = {};

function tierIndex(tier: string): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : 2; // default Hold
}

function getRankTierWithHysteresis(score: number, prevTier: string | null): string {
  const rawTier = getRankTier(score);
  if (prevTier === null) return rawTier;

  const rawIdx = tierIndex(rawTier);
  const prevIdx = tierIndex(prevTier);

  if (rawIdx === prevIdx) return prevTier;

  // Attempting upgrade
  if (rawIdx > prevIdx) {
    const upThreshold = TIER_THRESHOLDS_UP[rawTier];
    if (upThreshold !== undefined && score < upThreshold) return prevTier;
    return rawTier;
  }

  // Attempting downgrade
  const downThreshold = TIER_THRESHOLDS_DOWN[prevTier];
  if (downThreshold !== undefined && score > downThreshold) return prevTier;
  return rawTier;
}

function stabilizeScores(rawScores: StockScore[], horizon: Horizon): StockScore[] {
  const prev = _prevScores[horizon] || {};
  const stabilized: StockScore[] = [];

  for (const s of rawScores) {
    const prevData = prev[s.ticker];
    const prevSmoothed = prevData?.score ?? null;
    const prevTier = prevData?.tier ?? null;
    const prevCycles = prevData?.cycles ?? 0;

    // Layer 1: EMA smoothing
    const smoothed =
      prevSmoothed !== null
        ? Math.round((EMA_ALPHA * s.composite_score + (1 - EMA_ALPHA) * prevSmoothed) * 10) / 10
        : s.composite_score;

    // Layer 3: Tier hysteresis
    const tier = getRankTierWithHysteresis(smoothed, prevTier);
    const cycles = tier === prevTier ? prevCycles + 1 : 1;
    const conviction = getConviction(s.dimensions_bullish, smoothed);

    stabilized.push({
      ...s,
      smoothed_score: smoothed,
      rank_tier: tier,
      conviction,
      tier_held_cycles: cycles,
    });
  }

  // Update previous scores
  const newPrev: Record<string, PrevScoreData> = {};
  for (const s of stabilized) {
    newPrev[s.ticker] = { score: s.smoothed_score, tier: s.rank_tier, cycles: s.tier_held_cycles };
  }
  _prevScores[horizon] = newPrev;

  return stabilized;
}

function buildScore(snapshot: StockSnapshot, horizon: Horizon): StockScore {
  const breakdown = getBreakdown(snapshot);

  const technicalScore = average([
    rsiMomentumScore(breakdown.rsi_14),
    scoreBoolean(breakdown.macd_above_signal, 90, 25),
    breakdown.macd_histogram !== null ? clamp(50 + breakdown.macd_histogram * 20) : null,
    scoreBoolean(breakdown.golden_cross, 95, 25),
    adxTrendScore(breakdown.adx),
    stochasticScore(breakdown.stochastic_k, breakdown.stochastic_d),
    williamsRScore(breakdown.williams_r),
    cciScore(breakdown.cci),
    bollingerScore(breakdown.bollinger_position),
  ]);

  const momentumScore = average([
    volumeRatioScore(breakdown.volume_ratio),
    relativeStrengthScore(breakdown.price_vs_sma_50),
    relativeStrengthScore(breakdown.price_vs_sma_200),
    relativeStrengthScore(breakdown.price_vs_ema_50),
    breakdown.fifty_two_week_position !== null ? breakdown.fifty_two_week_position * 100 : null,
    latestSignalScore(snapshot.latest_signal),
  ]);

  const fundamentalScore = average([
    valuationScore(breakdown.pe_ratio, 22, 40),
    valuationScore(breakdown.forward_pe, 18, 32),
    valuationScore(breakdown.peg_ratio, 1.5, 3),
    valuationScore(breakdown.price_to_book, 3, 8),
    valuationScore(breakdown.price_to_sales, 4, 10),
    profitabilityScore(breakdown.eps),
    growthScore(breakdown.eps_growth),
    growthScore(breakdown.revenue_growth),
    dividendYieldScore(breakdown.dividend_yield),
  ]);

  const riskScore = average([
    rsiRiskScore(breakdown.rsi_14),
    snapshot.is_overbought === null ? null : snapshot.is_overbought ? 10 : 85,
    snapshot.is_oversold === null ? null : snapshot.is_oversold ? 35 : 75,
    distanceRiskScore(breakdown.price_vs_sma_200),
    marketCapScore(breakdown.market_cap),
  ]);

  const qualityScore = average([
    marketCapScore(breakdown.market_cap),
    profitabilityScore(breakdown.eps),
    growthScore(breakdown.eps_growth),
    growthScore(breakdown.revenue_growth),
    scoreBoolean(breakdown.is_bullish, 85, 35),
    dividendYieldScore(breakdown.dividend_yield),
  ]);

  const mlScore = mlSignalScore(snapshot);
  const hasMlData = mlScore !== null;
  const weights = hasMlData ? HORIZON_WEIGHTS[horizon].with_ml : HORIZON_WEIGHTS[horizon].without_ml;

  const compositeScore = hasMlData
    ? momentumScore * weights.momentum
      + technicalScore * weights.technical
      + fundamentalScore * weights.fundamental
      + riskScore * weights.risk
      + qualityScore * weights.quality
      + (mlScore ?? 0) * weights.ml
    : momentumScore * weights.momentum
      + technicalScore * weights.technical
      + fundamentalScore * weights.fundamental
      + riskScore * weights.risk
      + qualityScore * weights.quality;

  const dimensionScores = [momentumScore, technicalScore, fundamentalScore, riskScore, qualityScore];
  if (hasMlData && mlScore !== null) {
    dimensionScores.push(mlScore);
  }

  const dimensionsBullish = dimensionScores.filter((score) => score >= 60).length;

  return {
    ticker: snapshot.ticker,
    company_name: snapshot.company_name,
    last_price: toNumber(snapshot.last_price),
    price_change_pct: toNumber(snapshot.price_change_pct),
    updated_at: snapshot.updated_at,
    composite_score: Math.round(compositeScore * 10) / 10,
    smoothed_score: Math.round(compositeScore * 10) / 10, // will be overwritten by stabilizeScores
    rank_tier: getRankTier(compositeScore),
    conviction: getConviction(dimensionsBullish, compositeScore),
    momentum_score: Math.round(momentumScore * 10) / 10,
    technical_score: Math.round(technicalScore * 10) / 10,
    fundamental_score: Math.round(fundamentalScore * 10) / 10,
    risk_score: Math.round(riskScore * 10) / 10,
    quality_score: Math.round(qualityScore * 10) / 10,
    ml_score: mlScore !== null ? Math.round(mlScore * 10) / 10 : null,
    has_ml_data: hasMlData,
    dimensions_bullish: dimensionsBullish,
    tier_held_cycles: 0, // will be overwritten by stabilizeScores
    breakdown,
    data_fresh: isDataFresh(snapshot),
  };
}

async function getSupabaseRanking(options: TopStocksOptions = {}): Promise<TopStocksResult> {
  const { limit = 20, minScore = 0, horizon = 'balanced' } = options;
  const snapshots = await stockSnapshotsApi.getAll(SUPABASE_FALLBACK_LIMIT);
  const rawScores = snapshots.map((snapshot) => buildScore(snapshot, horizon));

  // Apply EMA smoothing + tier hysteresis (mirrors backend stabilization)
  const allScores = stabilizeScores(rawScores, horizon);

  const rankedScores = allScores
    .filter((score) => score.smoothed_score >= minScore)
    .sort((left, right) => right.smoothed_score - left.smoothed_score)
    .slice(0, limit);

  return {
    stocks: rankedScores,
    hasStaleData: allScores.some((score) => !score.data_fresh),
    hasMlData: allScores.some((score) => score.has_ml_data),
    totalScored: allScores.length,
    horizon,
  };
}

export const stockRankingApi = {
  async getRanking(options: TopStocksOptions = {}, source?: string): Promise<TopStocksResult> {
    const { limit = 20, minScore = 0, horizon = 'balanced' } = options;
    const backendUrl = getPythonApiUrl();
    const shouldUseSupabaseDirectly = !import.meta.env.PROD && isLocalBackendUrl(backendUrl);

    if (shouldUseSupabaseDirectly) {
      return getSupabaseRanking({ limit, minScore, horizon });
    }

    const params = new URLSearchParams({
      limit: String(limit),
      min_score: String(minScore),
      horizon,
    });
    if (source) params.append('source', source);

    try {
      const data = await apiClient.get<{
        stocks: StockScore[];
        has_stale_data: boolean;
        has_ml_data: boolean;
        total_scored: number;
        horizon: Horizon;
      }>(`/api/stocks/ranking?${params}`);

      return {
        stocks: data.stocks,
        hasStaleData: data.has_stale_data,
        hasMlData: data.has_ml_data,
        totalScored: data.total_scored,
        horizon: data.horizon,
      };
    } catch (error) {
      console.warn('[StockRanking] Backend ranking unavailable, falling back to Supabase snapshots.', error);
      return getSupabaseRanking({ limit, minScore, horizon });
    }
  },
};
