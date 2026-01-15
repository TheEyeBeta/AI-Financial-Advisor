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
        <TabsList className="mb-4 sm:mb-6 grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
          <TabsTrigger value="positions" className="text-xs sm:text-sm">
            Open Positions
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm">
            Trade History
          </TabsTrigger>
          <TabsTrigger value="journal" className="text-xs sm:text-sm">
            Trade Journal
          </TabsTrigger>
          <TabsTrigger value="performance" className="text-xs sm:text-sm">
            Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="w-full">
          <OpenPositions />
        </TabsContent>

        <TabsContent value="history" className="w-full">
          <TradeHistory />
        </TabsContent>

        <TabsContent value="journal" className="w-full">
          <TradeJournal />
        </TabsContent>

        <TabsContent value="performance" className="w-full">
          <PerformanceCharts />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

export default PaperTrading;
