import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PerformanceCharts } from "@/components/trading/PerformanceCharts";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { TradeJournal } from "@/components/trading/TradeJournal";
import type { OpenPosition, PortfolioHistory, Trade, TradeJournalEntry } from "@/types/database";

interface TradingReviewTabsProps {
  journalEntries: TradeJournalEntry[];
  isJournalLoading: boolean;
  openPositions: OpenPosition[];
  closedTrades: Trade[];
  portfolioHistory: PortfolioHistory[];
  isLedgerLoading?: boolean;
}

export function TradingReviewTabs({
  journalEntries,
  isJournalLoading,
  openPositions,
  closedTrades,
  portfolioHistory,
  isLedgerLoading = false,
}: TradingReviewTabsProps) {
  return (
    <Tabs defaultValue="performance" className="space-y-4">
      <TabsList className="grid w-full grid-cols-3 lg:w-auto">
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="history">Trade History</TabsTrigger>
        <TabsTrigger value="journal">Journal</TabsTrigger>
      </TabsList>

      <TabsContent value="performance" className="space-y-4">
        <PerformanceCharts
          positions={openPositions}
          trades={closedTrades}
          portfolioHistory={portfolioHistory}
          isLoading={isLedgerLoading}
        />
      </TabsContent>
      <TabsContent value="history" className="space-y-4">
        <TradeHistory trades={closedTrades} isLoading={isLedgerLoading} />
      </TabsContent>
      <TabsContent value="journal" className="space-y-4">
        <TradeJournal
          mode="journal"
          journalEntries={journalEntries}
          isJournalLoading={isJournalLoading}
          openPositions={openPositions}
        />
      </TabsContent>
    </Tabs>
  );
}
