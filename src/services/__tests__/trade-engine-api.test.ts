import { describe, expect, it } from 'vitest';
import { isTradeEngineContextUsable, type TradeEngineAIContext } from '../trade-engine-api';

const baseContext: TradeEngineAIContext = {
  generated_at: '2026-04-24T00:00:00Z',
  engine_status: {
    is_running: false,
    engine_started_at: null,
    last_price_tick: null,
    last_news_poll: null,
    total_ticks_processed: 0,
    total_news_fetched: 0,
    active_workers: {},
  },
  tracked_tickers: ['AAPL'],
  ticker_snapshots: [{ ticker: 'AAPL', last_price: 100 }],
  recent_signals: [],
  recent_news: [],
  summary: {
    total_tracked_tickers: 1,
    tickers_with_data: 1,
    tickers_with_indicators: null,
    tickers_with_fundamentals: null,
    buy_signals_count: 0,
    sell_signals_count: 0,
    hold_signals_count: 0,
    tickers_with_buy: [],
    tickers_with_sell: [],
    average_rsi: null,
    average_pe_ratio: null,
    bullish_tickers: null,
    bearish_tickers: null,
    oversold_tickers: null,
    overbought_tickers: null,
    signals_last_24h: 0,
    news_count: 0,
    high_volume_tickers: null,
  },
  data_available: true,
  availability_status: 'ok',
};

describe('isTradeEngineContextUsable', () => {
  it('accepts contexts with ticker data', () => {
    expect(isTradeEngineContextUsable(baseContext)).toBe(true);
  });

  it('rejects empty unavailable contexts', () => {
    expect(
      isTradeEngineContextUsable({
        ...baseContext,
        tracked_tickers: [],
        ticker_snapshots: [],
        data_available: false,
        availability_status: 'unavailable',
      }),
    ).toBe(false);
  });

  it('rejects null', () => {
    expect(isTradeEngineContextUsable(null)).toBe(false);
  });
});
