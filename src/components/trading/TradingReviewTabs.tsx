import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PerformanceCharts } from "@/components/trading/PerformanceCharts";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { TradeJournal } from "@/components/trading/TradeJournal";

export function TradingReviewTabs() {
  return (
    <Tabs defaultValue="performance" className="space-y-4">
      <TabsList className="grid w-full grid-cols-3 lg:w-auto">
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="history">Trade History</TabsTrigger>
        <TabsTrigger value="journal">Journal</TabsTrigger>
      </TabsList>

      <TabsContent value="performance" className="space-y-4">
        <PerformanceCharts />
      </TabsContent>
      <TabsContent value="history" className="space-y-4">
        <TradeHistory />
      </TabsContent>
      <TabsContent value="journal" className="space-y-4">
        <TradeJournal mode="journal" />
      </TabsContent>
    </Tabs>
  );
}
