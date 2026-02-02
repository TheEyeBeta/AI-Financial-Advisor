import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { PerformanceCharts } from "@/components/trading/PerformanceCharts";

const PaperTrading = () => {
  return (
    <AppLayout title="Paper Trading">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <h1 className="text-2xl font-semibold text-foreground">Paper Trading</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            Practice trading with virtual money, risk-free
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="positions" className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '50ms' }}>
          <TabsList className="mb-5 inline-flex h-9 bg-muted/40 p-1 rounded-lg">
            <TabsTrigger 
              value="positions" 
              className="text-xs px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all"
            >
              Positions
            </TabsTrigger>
            <TabsTrigger 
              value="history" 
              className="text-xs px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all"
            >
              History
            </TabsTrigger>
            <TabsTrigger 
              value="journal" 
              className="text-xs px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all"
            >
              Journal
            </TabsTrigger>
            <TabsTrigger 
              value="performance" 
              className="text-xs px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all"
            >
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="w-full animate-in fade-in duration-200">
            <OpenPositions />
          </TabsContent>

          <TabsContent value="history" className="w-full animate-in fade-in duration-200">
            <TradeHistory />
          </TabsContent>

          <TabsContent value="journal" className="w-full animate-in fade-in duration-200">
            <TradeJournal />
          </TabsContent>

          <TabsContent value="performance" className="w-full animate-in fade-in duration-200">
            <PerformanceCharts />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default PaperTrading;
