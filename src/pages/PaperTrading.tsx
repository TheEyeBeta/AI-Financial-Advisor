import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { PerformanceCharts } from "@/components/trading/PerformanceCharts";

const PaperTrading = () => {
  return (
    <AppLayout title="Paper Trading">
      <Tabs defaultValue="positions" className="w-full">
        <TabsList className="mb-6 grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="positions">Open Positions</TabsTrigger>
          <TabsTrigger value="history">Trade History</TabsTrigger>
          <TabsTrigger value="journal">Trade Journal</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="positions">
          <OpenPositions />
        </TabsContent>

        <TabsContent value="history">
          <TradeHistory />
        </TabsContent>

        <TabsContent value="journal">
          <TradeJournal />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceCharts />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

export default PaperTrading;
