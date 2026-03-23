import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useTradeJournal } from "@/hooks/use-data";
import { stockSnapshotsApi } from "@/services/stock-snapshots-api";
import { buildPaperTradingLedger } from "@/lib/paper-trading-ledger";

function getSymbols(symbols: string[]) {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))).sort();
}

export function usePaperTradingLedger() {
  const { userId } = useAuth();
  const { data: journalEntries = [], isLoading: isJournalLoading } = useTradeJournal();
  const [now, setNow] = useState(() => new Date());

  const symbols = useMemo(
    () => getSymbols(journalEntries.map((entry) => entry.symbol)),
    [journalEntries],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const { data: snapshots = [], isLoading: isSnapshotsLoading } = useQuery({
    queryKey: ["paper-trading-ledger-snapshots", symbols],
    queryFn: async () => {
      if (symbols.length === 0) return [];

      try {
        return await stockSnapshotsApi.getByTickers(symbols);
      } catch (error) {
        console.warn("[paper-trading-ledger] Failed to load stock snapshots:", error);
        return [];
      }
    },
    enabled: symbols.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
  });

  const ledger = useMemo(() => {
    const snapshotPriceBySymbol = new Map(
      snapshots
        .filter((snapshot) => typeof snapshot.last_price === "number")
        .map((snapshot) => [snapshot.ticker.toUpperCase(), snapshot.last_price as number]),
    );

    return buildPaperTradingLedger(journalEntries, {
      userId: userId ?? undefined,
      snapshotPriceBySymbol,
      asOfDate: format(now, "yyyy-MM-dd"),
    });
  }, [journalEntries, now, snapshots, userId]);

  return {
    ...ledger,
    journalEntries,
    isLoading: isJournalLoading || (symbols.length > 0 && isSnapshotsLoading),
    isJournalLoading,
  };
}
