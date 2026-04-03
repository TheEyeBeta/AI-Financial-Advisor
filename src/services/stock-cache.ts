import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

import type { Database, StockSnapshot } from '@/types/database';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

type CacheableStockSnapshot = {
  ticker: string;
  company_name?: string | null;
};

export type StockSnapshotQuery = PostgrestFilterBuilder<
  Database['market']['Tables']['stock_snapshots']['Row'],
  Database['market']['Tables']['stock_snapshots']['Row'],
  StockSnapshot[],
  'stock_snapshots',
  unknown
>;

export function createStockCache<T extends CacheableStockSnapshot>() {
  return {
    tickers: new Map<string, CacheEntry<T>>(),
    companyNames: new Map<string, CacheEntry<T | null>>(),
    mainList: null as CacheEntry<T[]> | null,
    initialized: false,
    TTL_MS: 5 * 60 * 1000,
    PRELOAD_COUNT: 60,

    isExpired(timestamp: number): boolean {
      return Date.now() - timestamp > this.TTL_MS;
    },

    getTicker(ticker: string): T | null {
      const entry = this.tickers.get(ticker.toUpperCase());
      if (entry && !this.isExpired(entry.timestamp)) {
        console.log('[Cache] Hit for ticker:', ticker);
        return entry.data;
      }
      return null;
    },

    setTicker(ticker: string, data: T): void {
      this.tickers.set(ticker.toUpperCase(), { data, timestamp: Date.now() });
    },

    getCompanyName(name: string): T | null | undefined {
      const entry = this.companyNames.get(name.toLowerCase());
      if (entry && !this.isExpired(entry.timestamp)) {
        console.log('[Cache] Hit for company name:', name);
        return entry.data;
      }
      return undefined;
    },

    setCompanyName(name: string, data: T | null): void {
      this.companyNames.set(name.toLowerCase(), { data, timestamp: Date.now() });
    },

    getMainList(): T[] | null {
      if (this.mainList && !this.isExpired(this.mainList.timestamp)) {
        console.log('[Cache] Hit for main stock list');
        return this.mainList.data;
      }
      return null;
    },

    setMainList(data: T[]): void {
      const timestamp = Date.now();
      this.mainList = { data, timestamp };

      data.forEach((snapshot) => {
        this.tickers.set(snapshot.ticker.toUpperCase(), { data: snapshot, timestamp });
        if (snapshot.company_name) {
          this.companyNames.set(snapshot.company_name.toLowerCase(), { data: snapshot, timestamp });
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
}

export function createStockSnapshotsApi(queryFactory: () => StockSnapshotQuery) {
  const stockCache = createStockCache<StockSnapshot>();

  return {
    async initializeCache(): Promise<void> {
      if (stockCache.initialized && stockCache.mainList && !stockCache.isExpired(stockCache.mainList.timestamp)) {
        console.log('[Cache] Already initialized and valid');
        return;
      }

      console.log('[Cache] Initializing - loading first', stockCache.PRELOAD_COUNT, 'stocks...');

      const { data, error } = await queryFactory()
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(stockCache.PRELOAD_COUNT);

      if (error) {
        console.error('[Cache] Failed to initialize:', error);
        throw error;
      }

      stockCache.setMainList(data || []);
      stockCache.initialized = true;
      console.log('[Cache] Initialization complete -', data?.length || 0, 'stocks cached');
    },

    getCacheStats() {
      return stockCache.getStats();
    },

    clearCache(): void {
      stockCache.clear();
    },

    async getAll(limit?: number): Promise<StockSnapshot[]> {
      const cached = stockCache.getMainList();
      if (cached) {
        return limit ? cached.slice(0, limit) : cached;
      }

      console.log('[Cache] Miss for main list - fetching from database');
      const fetchLimit = Math.max(limit || 0, stockCache.PRELOAD_COUNT);

      const { data, error } = await queryFactory()
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(fetchLimit);

      if (error) throw error;

      const result = data || [];
      stockCache.setMainList(result);

      return limit ? result.slice(0, limit) : result;
    },

    async getByTicker(ticker: string): Promise<StockSnapshot | null> {
      const cached = stockCache.getTicker(ticker);
      if (cached) {
        return cached;
      }

      console.log('[Cache] Miss for ticker:', ticker, '- fetching from database');
      const { data, error } = await queryFactory()
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        stockCache.setTicker(ticker, data);
      }

      return data;
    },

    async getByCompanyName(companyName: string): Promise<StockSnapshot | null> {
      const cached = stockCache.getCompanyName(companyName);
      if (cached !== undefined) {
        return cached;
      }

      console.log('[Cache] Miss for company name:', companyName, '- fetching from database');
      const { data, error } = await queryFactory()
        .select('*')
        .ilike('company_name', `%${companyName}%`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        stockCache.setCompanyName(companyName, null);
        return null;
      }

      stockCache.setCompanyName(companyName, data);
      stockCache.setTicker(data.ticker, data);
      return data;
    },

    async getByTickers(tickers: string[]): Promise<StockSnapshot[]> {
      const results: StockSnapshot[] = [];
      const tickersToFetch: string[] = [];

      for (const ticker of tickers) {
        const cached = stockCache.getTicker(ticker);
        if (cached) {
          results.push(cached);
        } else {
          tickersToFetch.push(ticker.toUpperCase());
        }
      }

      if (tickersToFetch.length === 0) {
        console.log('[Cache] All', tickers.length, 'tickers found in cache');
        return results;
      }

      console.log('[Cache] Fetching', tickersToFetch.length, 'missing tickers from database');
      const { data, error } = await queryFactory()
        .select('*')
        .in('ticker', tickersToFetch)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      if (data) {
        data.forEach((snapshot) => {
          stockCache.setTicker(snapshot.ticker, snapshot);
          results.push(snapshot);
        });
      }

      return results;
    },

    async getWithSignals(limit?: number): Promise<StockSnapshot[]> {
      let filteredQuery = queryFactory()
        .select('*')
        .not('latest_signal', 'is', null)
        .order('signal_timestamp', { ascending: false });

      if (limit) {
        filteredQuery = filteredQuery.limit(limit);
      }

      const { data, error } = await filteredQuery;

      if (error) throw error;

      if (data) {
        data.forEach((snapshot) => {
          stockCache.setTicker(snapshot.ticker, snapshot);
        });
      }

      return data || [];
    },

    async getRecentlyUpdated(hours: number = 24, limit?: number): Promise<StockSnapshot[]> {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);

      let filteredQuery = queryFactory()
        .select('*')
        .gte('updated_at', cutoffTime.toISOString())
        .order('updated_at', { ascending: false });

      if (limit) {
        filteredQuery = filteredQuery.limit(limit);
      }

      const { data, error } = await filteredQuery;

      if (error) throw error;

      return data || [];
    },
  };
}
