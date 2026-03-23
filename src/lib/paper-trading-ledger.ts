import { format } from "date-fns";
import type {
  OpenPosition,
  PortfolioHistory,
  Trade,
  TradeJournalEntry,
} from "@/types/database";

type SnapshotPriceBySymbol = Map<string, number>;

type OpenLot = {
  id: string;
  user_id: string;
  symbol: string;
  quantity: number;
  entry_price: number;
  entry_date: string;
  created_at: string | null;
  updated_at: string | null;
};

type HistoryPoint = {
  date: string;
  value: number;
  cash: number;
  marketValue: number;
  investedCapital: number;
  totalPnl: number;
  realizedPnl: number;
};

export interface PaperTradingLedger {
  sortedJournalEntries: TradeJournalEntry[];
  openPositions: OpenPosition[];
  closedTrades: Trade[];
  allTrades: Trade[];
  portfolioHistory: PortfolioHistory[];
  historyPoints: HistoryPoint[];
  cashBalance: number;
  investedCapital: number;
  marketValue: number;
  accountValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  winRate: number;
  hasSnapshotPrices: boolean;
  errors: string[];
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function toTradeDateIso(date: string) {
  return new Date(`${date}T12:00:00.000Z`).toISOString();
}

function compareNullableIso(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a.localeCompare(b);
}

export function compareTradeJournalEntries(a: TradeJournalEntry, b: TradeJournalEntry) {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;

  const byCreatedAt = compareNullableIso(a.created_at, b.created_at);
  if (byCreatedAt !== 0) return byCreatedAt;

  if (a.type !== b.type) {
    return a.type === "BUY" ? -1 : 1;
  }

  return a.id.localeCompare(b.id);
}

function toPortfolioHistory(points: HistoryPoint[], userId: string) {
  return points.map((point) => ({
    id: `${userId}-${point.date}`,
    user_id: userId,
    date: point.date,
    value: Number(point.value.toFixed(2)),
    created_at: null,
  }));
}

function buildCurrentPrice(
  symbol: string,
  entryPrice: number,
  lastTradePriceBySymbol: Map<string, number>,
  snapshotPriceBySymbol: SnapshotPriceBySymbol,
) {
  return snapshotPriceBySymbol.get(symbol)
    ?? lastTradePriceBySymbol.get(symbol)
    ?? entryPrice;
}

export function buildPaperTradingLedger(
  journalEntries: TradeJournalEntry[],
  options?: {
    userId?: string;
    snapshotPriceBySymbol?: SnapshotPriceBySymbol;
    asOfDate?: string;
  },
): PaperTradingLedger {
  const snapshotPriceBySymbol = options?.snapshotPriceBySymbol ?? new Map<string, number>();
  const asOfDate = options?.asOfDate ?? format(new Date(), "yyyy-MM-dd");
  const sortedJournalEntries = [...journalEntries]
    .map((entry) => ({ ...entry, symbol: normalizeSymbol(entry.symbol) }))
    .sort(compareTradeJournalEntries);
  const userId = options?.userId ?? sortedJournalEntries[0]?.user_id ?? "";

  const openLots: OpenLot[] = [];
  const openedTrades: Trade[] = [];
  const closedTrades: Trade[] = [];
  const historyByDate = new Map<string, HistoryPoint>();
  const lastTradePriceBySymbol = new Map<string, number>();
  const errors: string[] = [];

  let cashBalance = 0;
  let investedCapital = 0;
  let realizedPnl = 0;
  let currentDate: string | null = null;

  const recordHistoryPoint = (date: string) => {
    const marketValue = openLots.reduce((sum, lot) => {
      const markPrice = lastTradePriceBySymbol.get(lot.symbol) ?? lot.entry_price;
      return sum + (markPrice * lot.quantity);
    }, 0);
    const accountValue = cashBalance + marketValue;
    historyByDate.set(date, {
      date,
      value: Number(accountValue.toFixed(2)),
      cash: Number(cashBalance.toFixed(2)),
      marketValue: Number(marketValue.toFixed(2)),
      investedCapital: Number(investedCapital.toFixed(2)),
      totalPnl: Number((accountValue - investedCapital).toFixed(2)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
    });
  };

  for (const entry of sortedJournalEntries) {
    if (currentDate != null && entry.date !== currentDate) {
      recordHistoryPoint(currentDate);
    }
    currentDate = entry.date;

    const symbol = normalizeSymbol(entry.symbol);
    const quantity = entry.quantity;
    const price = entry.price;

    if (!symbol) {
      errors.push(`Skipped journal entry ${entry.id} because the symbol was empty.`);
      continue;
    }

    if (quantity <= 0 || price <= 0) {
      errors.push(`Skipped ${symbol} ${entry.type} on ${entry.date} because quantity or price was invalid.`);
      continue;
    }

    if (entry.type === "BUY") {
      const positionCost = quantity * price;

      if (cashBalance < positionCost) {
        investedCapital += positionCost - cashBalance;
        cashBalance = positionCost;
      }

      cashBalance -= positionCost;
      lastTradePriceBySymbol.set(symbol, price);
      openLots.push({
        id: entry.id,
        user_id: entry.user_id,
        symbol,
        quantity,
        entry_price: price,
        entry_date: toTradeDateIso(entry.date),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      });

      openedTrades.push({
        id: entry.id,
        user_id: entry.user_id,
        symbol,
        type: "LONG",
        action: "OPENED",
        quantity,
        entry_price: price,
        exit_price: null,
        entry_date: toTradeDateIso(entry.date),
        exit_date: null,
        pnl: null,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      });

      continue;
    }

    const availableLots = openLots.filter((lot) => lot.symbol === symbol && lot.quantity > 0);
    const availableQuantity = availableLots.reduce((sum, lot) => sum + lot.quantity, 0);

    if (availableQuantity < quantity) {
      errors.push(
        `Skipped ${symbol} SELL on ${entry.date}: tried to sell ${quantity} shares with only ${availableQuantity} available.`,
      );
      lastTradePriceBySymbol.set(symbol, price);
      continue;
    }

    let remainingToSell = quantity;
    let soldQuantity = 0;
    let costBasis = 0;
    let oldestEntryDate = availableLots[0]?.entry_date ?? toTradeDateIso(entry.date);

    for (const lot of availableLots) {
      if (remainingToSell <= 0) break;

      const quantityFromLot = Math.min(lot.quantity, remainingToSell);
      soldQuantity += quantityFromLot;
      costBasis += quantityFromLot * lot.entry_price;
      oldestEntryDate = oldestEntryDate < lot.entry_date ? oldestEntryDate : lot.entry_date;
      lot.quantity -= quantityFromLot;
      remainingToSell -= quantityFromLot;
    }

    const proceeds = soldQuantity * price;
    const pnl = proceeds - costBasis;
    cashBalance += proceeds;
    realizedPnl += pnl;
    lastTradePriceBySymbol.set(symbol, price);

    closedTrades.push({
      id: entry.id,
      user_id: entry.user_id,
      symbol,
      type: "LONG",
      action: "CLOSED",
      quantity: soldQuantity,
      entry_price: soldQuantity > 0 ? costBasis / soldQuantity : price,
      exit_price: price,
      entry_date: oldestEntryDate,
      exit_date: toTradeDateIso(entry.date),
      pnl: Number(pnl.toFixed(2)),
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  }

  if (currentDate != null) {
    recordHistoryPoint(currentDate);
  }

  const remainingLots = openLots.filter((lot) => lot.quantity > 0);
  const openPositions: OpenPosition[] = remainingLots.map((lot) => {
    const currentPrice = buildCurrentPrice(
      lot.symbol,
      lot.entry_price,
      lastTradePriceBySymbol,
      snapshotPriceBySymbol,
    );

    return {
      id: lot.id,
      user_id: lot.user_id,
      symbol: lot.symbol,
      name: lot.symbol,
      quantity: lot.quantity,
      entry_price: lot.entry_price,
      current_price: Number(currentPrice.toFixed(2)),
      type: "LONG",
      entry_date: lot.entry_date,
      created_at: lot.created_at,
      updated_at: lot.updated_at,
    };
  });

  const marketValue = openPositions.reduce((sum, position) => {
    const currentPrice = position.current_price ?? position.entry_price;
    return sum + (currentPrice * position.quantity);
  }, 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => {
    const currentPrice = position.current_price ?? position.entry_price;
    return sum + ((currentPrice - position.entry_price) * position.quantity);
  }, 0);
  const accountValue = cashBalance + marketValue;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalReturnPct = investedCapital > 0 ? (totalPnl / investedCapital) * 100 : 0;
  const wins = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const historyPoints = Array.from(historyByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const currentPoint: HistoryPoint = {
    date: asOfDate,
    value: Number(accountValue.toFixed(2)),
    cash: Number(cashBalance.toFixed(2)),
    marketValue: Number(marketValue.toFixed(2)),
    investedCapital: Number(investedCapital.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
  };

  if (historyPoints.length > 0) {
    const lastPoint = historyPoints[historyPoints.length - 1];
    if (lastPoint.date === asOfDate) {
      historyPoints[historyPoints.length - 1] = currentPoint;
    } else {
      historyPoints.push(currentPoint);
    }
  } else if (journalEntries.length > 0) {
    historyPoints.push(currentPoint);
  }

  return {
    sortedJournalEntries,
    openPositions,
    closedTrades,
    allTrades: [...openedTrades, ...closedTrades].sort((a, b) => {
      const primaryDateA = a.exit_date ?? a.entry_date;
      const primaryDateB = b.exit_date ?? b.entry_date;
      return primaryDateA.localeCompare(primaryDateB);
    }),
    portfolioHistory: toPortfolioHistory(historyPoints, userId),
    historyPoints,
    cashBalance: Number(cashBalance.toFixed(2)),
    investedCapital: Number(investedCapital.toFixed(2)),
    marketValue: Number(marketValue.toFixed(2)),
    accountValue: Number(accountValue.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    winRate: closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0,
    hasSnapshotPrices: openPositions.some((position) => position.current_price != null),
    errors,
  };
}
