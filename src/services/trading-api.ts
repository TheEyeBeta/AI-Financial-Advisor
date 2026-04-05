import { supabase } from '@/lib/supabase';
import { stockSnapshotsApi } from '@/services/stock-snapshots-api';
import type {
  OpenPosition,
  PortfolioHistory,
  Trade,
  TradeJournalEntry,
} from '@/types/database';

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

export const positionsApi = {
  async getAll(userId: string): Promise<OpenPosition[]> {
    const { data, error } = await supabase
      .schema('trading')
      .from('open_positions')
      .select('*')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false });

    if (error) throw error;

    const positions = data || [];
    if (positions.length === 0) {
      return positions;
    }

    const uniqueSymbols = Array.from(
      new Set(
        positions
          .map((position) => position.symbol?.trim().toUpperCase())
          .filter((symbol): symbol is string => Boolean(symbol)),
      ),
    );

    if (uniqueSymbols.length === 0) {
      return positions;
    }

    try {
      const snapshots = await stockSnapshotsApi.getByTickers(uniqueSymbols);
      const snapshotPriceByTicker = new Map(
        snapshots
          .filter((snapshot) => typeof snapshot.last_price === 'number')
          .map((snapshot) => [snapshot.ticker.toUpperCase(), snapshot.last_price as number]),
      );

      return positions.map((position) => {
        const normalizedSymbol = position.symbol.trim().toUpperCase();
        const snapshotPrice = snapshotPriceByTicker.get(normalizedSymbol);

        return snapshotPrice !== undefined
          ? { ...position, symbol: normalizedSymbol, current_price: snapshotPrice }
          : { ...position, symbol: normalizedSymbol, current_price: null };
      });
    } catch (snapshotError) {
      console.warn('[positionsApi.getAll] Failed to hydrate position prices from stock snapshots:', snapshotError);
      return positions;
    }
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

    const { error } = await supabase
      .schema('trading')
      .from('open_positions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
  },
};

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
    const winningTrades = trades.filter((trade) => (trade.pnl ?? 0) > 0);
    const losingTrades = trades.filter((trade) => (trade.pnl ?? 0) < 0);

    const avgProfit = winningTrades.length > 0
      ? winningTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl ?? 0), 0) / losingTrades.length
      : 0;

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
