import { AppLayout } from "@/components/layout/AppLayout";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { PerformanceCharts } from "@/components/trading/PerformanceCharts";
import { useAuth } from "@/hooks/use-auth";

const PaperTrading = () => {
  const { userProfile } = useAuth();
  const heading = userProfile?.first_name
    ? `${userProfile.first_name}, ready to trade?`
    : "Ready to trade?";
  const sectionAnimation = "animate-in fade-in slide-in-from-bottom-2 duration-300";

  return (
    <AppLayout title="Paper Trading">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            Practice trading with virtual money and sharpen your execution.
          </p>
        </div>

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '50ms' }}>
            <OpenPositions />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '100ms' }}>
            <TradeHistory />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '150ms' }}>
            <TradeJournal />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '200ms' }}>
            <PerformanceCharts />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default PaperTrading;
