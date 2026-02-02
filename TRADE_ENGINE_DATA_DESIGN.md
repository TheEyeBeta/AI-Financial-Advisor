# Trade Engine Data Integration - Comprehensive Design Document

## Executive Summary

This document outlines the current state of Trade Engine data integration with the AI Financial Advisor and proposes a comprehensive enhancement to include all technical indicators and fundamental metrics for all 507 tracked tickers. The goal is to provide the AI with complete market intelligence, enabling detailed technical and fundamental analysis for any ticker the user queries.

---

## Current State Analysis

### Data Flow Architecture

```
Trade Engine Backend (TheEyeBetaLocal)
    ↓
REST API: /api/v1/ai/context
    ↓
Frontend: tradeEngineApi.getAIContext()
    ↓
Data Processing: getChatResponse() → eyeDataContext string
    ↓
OpenAI API: System prompt + eyeDataContext + chat history
```

### Current Data Structure

**TradeEngineAIContext** currently includes:
- `tracked_tickers: string[]` - 507 ticker symbols
- `ticker_snapshots: TradeEngineTickerSnapshot[]` - Limited subset with basic data
- `recent_signals: TradeEngineSignal[]` - 100 signals total (across all tickers, last 48h)
- `recent_news: Array` - Market news articles
- `summary: object` - Aggregated statistics

**TradeEngineTickerSnapshot** (Current - Limited):
```typescript
{
  ticker: string;
  last_price: number | null;
  price_change_pct: number | null;
  sma_10: number | null;      // Simple Moving Average 10-day
  sma_50: number | null;      // Simple Moving Average 50-day
  sma_200: number | null;     // Simple Moving Average 200-day
  rsi_14: number | null;      // Relative Strength Index (14-period)
  macd: number | null;        // MACD line only
  latest_signal: string | null;
  signal_strategy: string | null;
  signal_confidence: number | null;
  updated_at: string | null;
}
```

### Current Limitations

**Gap 1: Incomplete Indicator Coverage**
- ❌ No EMA (Exponential Moving Average)
- ❌ No volume data
- ❌ No fundamental metrics (PE ratio, market cap, etc.)
- ❌ Limited technical indicators (only RSI, MACD, 3 SMAs)
- ❌ No volatility indicators (Bollinger Bands, ATR)
- ❌ No additional momentum indicators (Stochastic, Williams %R, CCI)
- ❌ Incomplete MACD (only line, missing signal and histogram)

**Gap 2: Incomplete Ticker Coverage**
- ❌ Only tickers with snapshots are included (may be < 507)
- ❌ Tickers without recent signals may not appear
- ❌ Limited to first 20 tickers in context (recently increased from 15)

**Gap 3: Limited Signal Context**
- ❌ Only 100 signals total (not per ticker)
- ❌ Signals limited to last 48 hours
- ❌ No historical signal context

**Gap 4: Missing Fundamental Analysis**
- ❌ No PE ratio, P/B, P/S ratios
- ❌ No earnings data (EPS, EPS growth)
- ❌ No dividend information
- ❌ No market cap data

---

## Proposed Comprehensive Design

### Enhanced Data Structure

#### TradeEngineTickerSnapshot (Enhanced)

```typescript
export interface TradeEngineTickerSnapshot {
  // ============================================
  // BASIC PRICE DATA
  // ============================================
  ticker: string;
  last_price: number | null;
  price_change_pct: number | null;
  price_change_abs: number | null;
  high_52w: number | null;           // 52-week high
  low_52w: number | null;             // 52-week low
  updated_at: string | null;
  
  // ============================================
  // VOLUME DATA
  // ============================================
  volume: number | null;              // Current trading volume
  avg_volume_10d: number | null;     // 10-day average volume
  avg_volume_30d: number | null;     // 30-day average volume
  volume_ratio: number | null;        // current_volume / avg_volume (indicates unusual activity)
  
  // ============================================
  // SIMPLE MOVING AVERAGES (SMA)
  // ============================================
  sma_10: number | null;              // 10-day SMA
  sma_20: number | null;              // 20-day SMA
  sma_50: number | null;              // 50-day SMA
  sma_100: number | null;             // 100-day SMA
  sma_200: number | null;              // 200-day SMA (long-term trend)
  
  // ============================================
  // EXPONENTIAL MOVING AVERAGES (EMA)
  // ============================================
  ema_10: number | null;              // 10-day EMA
  ema_20: number | null;              // 20-day EMA
  ema_50: number | null;              // 50-day EMA
  ema_200: number | null;             // 200-day EMA
  
  // ============================================
  // MOMENTUM INDICATORS
  // ============================================
  rsi_14: number | null;              // RSI (14-period) - 0-100, <30 oversold, >70 overbought
  rsi_9: number | null;               // RSI (9-period) - shorter-term momentum
  stochastic_k: number | null;        // Stochastic %K - 0-100
  stochastic_d: number | null;        // Stochastic %D (signal line)
  williams_r: number | null;          // Williams %R - -100 to 0, < -80 oversold
  cci: number | null;                 // Commodity Channel Index - typically -100 to +100
  
  // ============================================
  // TREND INDICATORS
  // ============================================
  macd: number | null;                // MACD line (12 EMA - 26 EMA)
  macd_signal: number | null;         // MACD signal line (9 EMA of MACD)
  macd_histogram: number | null;      // MACD histogram (MACD - Signal)
  adx: number | null;                 // Average Directional Index - trend strength (0-100, >25 strong)
  
  // ============================================
  // VOLATILITY INDICATORS
  // ============================================
  bollinger_upper: number | null;     // Bollinger Band upper (SMA + 2 std dev)
  bollinger_middle: number | null;    // Bollinger Band middle (SMA)
  bollinger_lower: number | null;     // Bollinger Band lower (SMA - 2 std dev)
  atr: number | null;                  // Average True Range - volatility measure
  
  // ============================================
  // FUNDAMENTAL DATA
  // ============================================
  pe_ratio: number | null;             // Price-to-Earnings ratio
  forward_pe: number | null;          // Forward P/E (projected earnings)
  peg_ratio: number | null;           // P/E to Growth ratio
  price_to_book: number | null;       // P/B ratio
  price_to_sales: number | null;      // P/S ratio
  dividend_yield: number | null;      // Dividend yield percentage
  market_cap: number | null;           // Market capitalization (in dollars)
  eps: number | null;                  // Earnings Per Share
  eps_growth: number | null;           // EPS growth percentage
  revenue_growth: number | null;       // Revenue growth percentage
  
  // ============================================
  // SIGNAL DATA
  // ============================================
  latest_signal: string | null;        // 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY' | 'STRONG_SELL'
  signal_strategy: string | null;       // Strategy that generated signal (e.g., 'RSI_OVERSOLD')
  signal_confidence: number | null;     // 0.0 to 1.0 (confidence level)
  signal_timestamp: string | null;      // When signal was generated
  
  // ============================================
  // DERIVED METRICS
  // ============================================
  price_vs_sma_50: number | null;     // % above/below SMA 50
  price_vs_sma_200: number | null;     // % above/below SMA 200 (bullish/bearish indicator)
  price_vs_ema_50: number | null;     // % above/below EMA 50
  price_vs_ema_200: number | null;     // % above/below EMA 200
  price_vs_bollinger_middle: number | null; // % above/below Bollinger middle
  is_bullish: boolean | null;          // Price above SMA 200
  is_oversold: boolean | null;          // RSI < 30
  is_overbought: boolean | null;       // RSI > 70
}
```

#### Enhanced TradeEngineAIContext

```typescript
export interface TradeEngineAIContext {
  generated_at: string;
  engine_status: TradeEngineEngineStatus;
  
  // ALL 507 tracked tickers with comprehensive data
  // Length should always be 507 (even if some fields are null)
  tracked_tickers: string[];
  ticker_snapshots: TradeEngineTickerSnapshot[];
  
  // Recent trading signals (last 48 hours)
  recent_signals: TradeEngineSignal[];
  
  // Market news
  recent_news: Array<{
    headline: string;
    source: string | null;
    category: string | null;
    published_at: string;
    related_tickers: string | null;
  }>;
  
  // Enhanced summary statistics
  summary: {
    // Coverage metrics
    total_tracked_tickers: number;        // Always 507
    tickers_with_price_data: number;      // How many have valid price data
    tickers_with_indicators: number;      // How many have calculated indicators
    tickers_with_fundamentals: number;    // How many have PE ratio, etc.
    
    // Signal counts
    buy_signals_count: number;
    sell_signals_count: number;
    hold_signals_count: number;
    tickers_with_buy: string[];
    tickers_with_sell: string[];
    
    // Market health indicators
    average_rsi: number | null;
    average_pe_ratio: number | null;
    bullish_tickers: number;              // Price above SMA 200
    bearish_tickers: number;              // Price below SMA 200
    oversold_tickers: number;             // RSI < 30
    overbought_tickers: number;           // RSI > 70
    
    // Activity metrics
    signals_last_24h: number;
    news_count: number;
    high_volume_tickers: string[];       // Volume ratio > 1.5
  };
}
```

---

## AI Context Formatting Strategy

To manage token limits while providing comprehensive data, use a **4-tier approach**:

### Tier 1: Requested Ticker (Full Detail)

When user asks about a specific ticker (e.g., "NVDA"), show **ALL** indicators:

```
--- NVDA DETAILED ANALYSIS ---
Price: $125.50 (+2.3%, +$2.82)
52W Range: $95.20 - $145.30
Volume: 45.2M (1.8x avg) ← Unusual volume activity

Moving Averages:
  SMA 10: $123.20 | SMA 20: $121.50 | SMA 50: $120.50 | SMA 100: $118.20 | SMA 200: $115.30
  EMA 10: $124.10 | EMA 20: $122.80 | EMA 50: $119.90 | EMA 200: $116.50
  Price Position: +4.1% above SMA 50, +8.8% above SMA 200 (BULLISH trend)

Momentum:
  RSI(14): 65.2 (neutral, not overbought)
  RSI(9): 68.5 (short-term momentum)
  MACD: 0.45 | Signal: 0.32 | Hist: 0.13 (positive, bullish momentum)
  Stochastic: K=72.5, D=68.3
  Williams %R: -27.5
  CCI: 85.2

Volatility:
  Bollinger: Upper $128.50 | Middle $123.20 | Lower $117.90
  Price is near middle band (normal volatility)
  ATR: $2.15 (volatility measure)

Trend:
  ADX: 28.5 (strong trend)

Fundamentals:
  P/E: 28.5 (reasonable for tech)
  Forward P/E: 25.2 (improving)
  P/B: 12.3 | P/S: 8.7
  PEG: 1.85
  Dividend Yield: 0.15%
  Market Cap: $3.1T
  EPS: $4.40 | EPS Growth: 15.2%
  Revenue Growth: 12.8%

Price Position:
  vs SMA 50: +4.1%
  vs SMA 200: +8.8% (BULLISH)
  vs EMA 50: +4.7%
  vs EMA 200: +7.7% (BULLISH)
  vs Bollinger Middle: +1.9%

Signal: BUY (RSI_MOMENTUM, 78% confidence) @ 2025-01-XX 14:30:00
```

### Tier 2: Top 50 Active Tickers (Compact)

Show top 50 by volume with key metrics:

```
--- TOP 50 ACTIVE TICKERS (by volume) ---
AAPL  : $  185.20 | Vol: 52.3M (1.2x) | RSI: 58 | P/E: 28.5 | Signal: HOLD
TSLA  : $  245.80 | Vol: 48.1M (2.1x) | RSI: 72 | P/E: 45.2 | Signal: SELL
MSFT  : $  420.50 | Vol: 35.7M (0.9x) | RSI: 45 | P/E: 32.1 | Signal: BUY
...
```

### Tier 3: All Tickers with Signals (Signal Focus)

Show all tickers that have active signals:

```
--- ALL TICKERS WITH ACTIVE SIGNALS (23) ---
NVDA  : BUY        | Conf: 85% | Price: $125.50 | RSI: 65 | P/E: 28.5 | Strategy: RSI_MOMENTUM
AMD   : STRONG_BUY | Conf: 92% | Price: $142.30 | RSI: 45 | P/E: 32.1 | Strategy: MACD_CROSSOVER
AAPL  : SELL       | Conf: 68% | Price: $185.20 | RSI: 72 | P/E: 28.5 | Strategy: RSI_OVERBOUGHT
...
```

### Tier 4: Market Summary (Aggregated)

Summary statistics across all 507 tickers:

```
--- MARKET SUMMARY (ALL 507 TRACKED TICKERS) ---
Coverage:
  Tickers with price data: 507/507 (100%)
  Tickers with indicators: 485/507 (96%)
  Tickers with fundamentals: 420/507 (83%)

Market Health:
  Average RSI: 52.3 (neutral)
  Average P/E: 24.8
  Bullish (above SMA 200): 312 tickers (62%)
  Bearish (below SMA 200): 195 tickers (38%)
  Oversold (RSI < 30): 45 tickers
  Overbought (RSI > 70): 38 tickers

Activity:
  High Volume (ratio > 1.5): 67 tickers
  Active Signals (48h): 23 tickers
  Recent News: 15 articles
```

---

## Backend API Requirements

### Endpoint: `/api/v1/ai/context`

**Required Enhancements:**

1. **Return ALL 507 tickers** in `ticker_snapshots` array
   - Even if some fields are `null`, include the ticker
   - Ensures every tracked ticker is available to AI
   - Order by: requested ticker first (if specified), then by volume, then alphabetically

2. **Calculate ALL indicators** for each ticker:
   - All SMA periods (10, 20, 50, 100, 200)
   - All EMA periods (10, 20, 50, 200)
   - All momentum indicators (RSI 9, RSI 14, Stochastic, Williams %R, CCI)
   - Complete MACD (line, signal, histogram)
   - Volatility indicators (Bollinger Bands, ATR)
   - Trend indicators (ADX)

3. **Include fundamental data** where available:
   - PE ratios, P/B, P/S, PEG
   - Earnings data (EPS, growth)
   - Market cap, dividend yield
   - Revenue growth

4. **Calculate derived metrics:**
   - Price vs SMA/EMA percentages
   - Bullish/bearish flags
   - Oversold/overbought flags
   - Volume ratios

5. **Provide comprehensive summary statistics:**
   - Coverage metrics (how many tickers have each data type)
   - Market health indicators (bullish/bearish counts)
   - Activity metrics (high volume tickers)

---

## Implementation Phases

### Phase 1: Frontend Preparation ✅ COMPLETE

- ✅ Enhanced ticker extraction (multiple regex patterns)
- ✅ Fallback search in signals
- ✅ Prioritized requested ticker display
- ✅ Increased visibility limits (20 tickers, 12 signals)

### Phase 2: Frontend Context Formatting (Next)

**Tasks:**
- [ ] Update `TradeEngineTickerSnapshot` interface in `src/services/api.ts` with all new fields
- [ ] Implement tiered data presentation in `getChatResponse()` function
- [ ] Add full detail formatting for requested ticker (Tier 1)
- [ ] Add compact view for top 50 tickers (Tier 2)
- [ ] Add signal-focused view (Tier 3)
- [ ] Add comprehensive market summary (Tier 4)
- [ ] Handle null values gracefully (show "N/A" or omit field)

**Estimated Effort:** 2-3 hours

**Code Location:** `src/services/api.ts` → `getChatResponse()` → `eyeDataContext` building logic

### Phase 3: Backend API Enhancement (Future)

**Tasks:**
- [ ] Update Trade Engine API to return all 507 tickers
- [ ] Calculate all technical indicators (SMA, EMA, RSI, MACD, Stochastic, Williams %R, CCI, ADX, Bollinger, ATR)
- [ ] Integrate fundamental data source (Alpha Vantage, Yahoo Finance, or similar)
- [ ] Calculate derived metrics (price vs MA percentages, flags)
- [ ] Generate comprehensive summary statistics
- [ ] Optimize performance (caching, async processing, incremental updates)

**Estimated Effort:** 1-2 days (backend work)

**Backend Location:** `TheEyeBetaLocal` → `/api/v1/ai/context` endpoint

---

## Benefits of Comprehensive Design

### 1. Complete Coverage
- ✅ All 507 tickers always available to AI
- ✅ No ticker left behind (even if no recent signal)
- ✅ Comprehensive data for any ticker user queries

### 2. Rich Analysis
- ✅ AI can perform technical analysis with full indicator set
- ✅ AI can combine technical + fundamental analysis
- ✅ AI can identify patterns across multiple indicators
- ✅ AI can provide detailed explanations with specific numbers

### 3. User Experience
- ✅ Detailed analysis for requested tickers
- ✅ Market-wide insights from summary statistics
- ✅ Context-aware responses based on full data
- ✅ Professional-grade analysis

### 4. Scalability
- ✅ Tiered approach manages token limits efficiently
- ✅ Prioritizes most relevant data
- ✅ Still provides comprehensive market overview
- ✅ Can handle 507 tickers without overwhelming context

---

## Example AI Response with Full Data

**User:** "Tell me about NVDA"

**AI Context Includes:**
```
--- NVDA DETAILED ANALYSIS ---
Price: $125.50 (+2.3%, +$2.82)
52W Range: $95.20 - $145.30
Volume: 45.2M (1.8x avg) ← Unusual volume activity

Moving Averages:
  SMA 10: $123.20 | SMA 20: $121.50 | SMA 50: $120.50 | SMA 100: $118.20 | SMA 200: $115.30
  EMA 10: $124.10 | EMA 20: $122.80 | EMA 50: $119.90 | EMA 200: $116.50
  Price Position: +4.1% above SMA 50, +8.8% above SMA 200 (BULLISH trend)

Momentum:
  RSI(14): 65.2 (neutral, not overbought)
  RSI(9): 68.5 (short-term momentum)
  MACD: 0.45 | Signal: 0.32 | Hist: 0.13 (positive, bullish momentum)
  Stochastic: K=72.5, D=68.3
  Williams %R: -27.5
  CCI: 85.2

Volatility:
  Bollinger: Upper $128.50 | Middle $123.20 | Lower $117.90
  Price is near middle band (normal volatility)
  ATR: $2.15 (volatility measure)

Trend:
  ADX: 28.5 (strong trend)

Fundamentals:
  P/E: 28.5 (reasonable for tech)
  Forward P/E: 25.2 (improving)
  P/B: 12.3 | P/S: 8.7
  PEG: 1.85
  Dividend Yield: 0.15%
  Market Cap: $3.1T
  EPS: $4.40 | EPS Growth: 15.2%
  Revenue Growth: 12.8%

Signal: BUY (RSI_MOMENTUM, 78% confidence) @ 2025-01-XX 14:30:00
```

**AI Response:**
"According to The Eye, NVIDIA (NVDA) is currently trading at $125.50, up 2.3% today with unusually high volume (1.8x average). The stock shows strong bullish momentum with price 8.8% above its 200-day moving average, indicating a robust uptrend. The MACD is positive with a rising histogram (0.13), suggesting continued upward momentum. Volume is elevated at 1.8x the average, showing increased market interest. The RSI at 65.2 is in neutral territory, not yet overbought, which leaves room for further gains. The ADX of 28.5 indicates a strong trend is in place. Fundamentally, NVDA trades at a P/E of 28.5 with strong EPS growth of 15.2% and revenue growth of 12.8%, indicating healthy fundamentals. The Eye has generated a BUY signal with 78% confidence based on RSI momentum analysis. The stock is positioned well above both its 50-day and 200-day moving averages, suggesting the uptrend has strong support."

---

## Technical Indicator Reference

### Moving Averages
- **SMA (Simple Moving Average)**: Average price over N periods, equal weight to all periods
- **EMA (Exponential Moving Average)**: Weighted average, more responsive to recent prices, gives more weight to recent data

### Momentum Indicators
- **RSI (Relative Strength Index)**: 0-100 scale, <30 oversold, >70 overbought, measures speed and magnitude of price changes
- **Stochastic**: Measures momentum by comparing closing price to price range over N periods, 0-100 scale
- **Williams %R**: Momentum oscillator, -100 to 0 scale, < -80 oversold, > -20 overbought
- **CCI (Commodity Channel Index)**: Identifies cyclical trends, typically -100 to +100, outside indicates strong trend

### Trend Indicators
- **MACD**: Moving Average Convergence Divergence - trend and momentum indicator
  - MACD Line: 12 EMA - 26 EMA
  - Signal Line: 9 EMA of MACD line
  - Histogram: MACD - Signal (shows momentum strength)
- **ADX (Average Directional Index)**: Trend strength indicator, 0-100 scale, >25 indicates strong trend

### Volatility Indicators
- **Bollinger Bands**: Price volatility bands (SMA ± 2 standard deviations)
  - Upper Band: SMA + 2 std dev
  - Middle Band: SMA
  - Lower Band: SMA - 2 std dev
  - Price near upper = potentially overbought, near lower = potentially oversold
- **ATR (Average True Range)**: Volatility measure, higher ATR = more volatility

### Fundamental Metrics
- **P/E Ratio**: Price-to-Earnings (valuation metric, lower may indicate undervalued)
- **Forward P/E**: Projected P/E based on future earnings estimates
- **PEG Ratio**: P/E to Growth ratio (accounts for growth rate, <1 may indicate undervalued)
- **P/B Ratio**: Price-to-Book (asset valuation, <1 may indicate undervalued)
- **P/S Ratio**: Price-to-Sales (revenue valuation)
- **EPS**: Earnings Per Share (profitability per share)
- **Market Cap**: Total market value (shares outstanding × price)
- **Dividend Yield**: Annual dividend / price (income return)

---

## Data Quality Notes

### Null Handling
- All fields are `number | null` to handle missing data gracefully
- AI should interpret `null` as "data not available" not "zero"
- Backend should provide data for as many tickers/indicators as possible
- Frontend should omit null fields from context or show "N/A" when appropriate

### Data Freshness
- `updated_at` timestamp indicates when data was last refreshed
- AI should note if data is stale (>1 hour old)
- Real-time data preferred for active trading decisions
- Fundamental data may update less frequently (daily/weekly)

### Coverage Expectations
- **Price data**: Should be 100% (all 507 tickers)
- **Technical indicators**: Target 95%+ (may be lower for new tickers or insufficient history)
- **Fundamental data**: Target 80%+ (not all tickers have public financials, especially smaller caps)

### Performance Considerations
- Calculating all indicators for 507 tickers may be computationally expensive
- Consider caching indicator calculations
- Update indicators incrementally (only recalculate when new price data arrives)
- Fundamental data can be updated less frequently (daily batch updates)

---

## Next Steps

1. **Review this design** with backend team to confirm feasibility
2. **Implement Phase 2** (frontend context formatting) - can be done now
3. **Coordinate with backend** for Phase 3 (API enhancements)
4. **Test with real data** to validate token usage and AI responses
5. **Iterate** based on AI response quality and user feedback
6. **Monitor token usage** to ensure tiered approach keeps costs reasonable

---

## Questions & Considerations

1. **Token Limits**: Will comprehensive data exceed OpenAI token limits?
   - Solution: Tiered approach prioritizes most relevant data, full detail only for requested ticker
   - Estimated tokens: ~2000-3000 for full context (within limits)
   
2. **API Performance**: Can backend calculate all indicators for 507 tickers quickly?
   - Solution: Caching, async processing, incremental updates, parallel computation
   - Target: <5 seconds for full context generation
   
3. **Data Sources**: Where does fundamental data come from?
   - Solution: Integrate with financial data API (Alpha Vantage, Yahoo Finance, Polygon.io, etc.)
   - May require API key and rate limiting considerations
   
4. **Update Frequency**: How often should indicators be recalculated?
   - Solution: Real-time for prices, hourly for indicators, daily for fundamentals
   - Balance between freshness and performance

5. **Backward Compatibility**: How to handle old data structure?
   - Solution: Make all new fields optional (`| null`), gracefully handle missing fields
   - Frontend should work with partial data

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-XX  
**Author:** AI Assistant  
**Status:** Proposal - Ready for Implementation  
**EMA Periods:** 10, 20, 50, 200 (as specified)
