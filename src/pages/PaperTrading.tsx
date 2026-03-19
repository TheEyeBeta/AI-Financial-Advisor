import { AppLayout } from "@/components/layout/AppLayout";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { useAuth } from "@/hooks/use-auth";
import { PaperTradingOverview } from "@/components/trading/PaperTradingOverview";
import { TradingReviewTabs } from "@/components/trading/TradingReviewTabs";
import { TradeEngineStatus } from "@/components/trading/TradeEngineStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PaperTrading = () => {
  const { userProfile } = useAuth();
  const heading = userProfile?.first_name
    ? `${userProfile.first_name}, run your paper trading desk`
    : "Run your paper trading desk";
  const sectionAnimation = "animate-in fade-in slide-in-from-bottom-2 duration-300";

  return (
    <AppLayout title="Paper Trading">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between animate-in fade-in duration-300">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
            <p className="text-sm text-muted-foreground/70 mt-0.5 max-w-2xl">
              Monitor account health, simulate trades, and review outcomes from one portfolio cockpit.
            </p>
          </div>
          <TradeEngineStatus compact showSignals={false} />
        </div>

        <div className={sectionAnimation} style={{ animationDelay: '50ms' }}>
          <PaperTradingOverview />
        </div>

        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.05fr_1.4fr]">
          <Card className={`${sectionAnimation} border-border/50 bg-card/50 backdrop-blur-sm`} style={{ animationDelay: '100ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Trade Ticket</CardTitle>
              <p className="text-sm text-muted-foreground">
                Enter a simulated BUY or SELL, then optionally capture your rationale before saving.
              </p>
            </CardHeader>
            <CardContent>
              <TradeJournal mode="workspace" />
            </CardContent>
          </Card>

          <div className={sectionAnimation} style={{ animationDelay: '150ms' }}>
            <OpenPositions />
          </div>
        </div>

        <section className={`${sectionAnimation} space-y-3`} style={{ animationDelay: '200ms' }}>
          <div>
            <h2 className="text-lg font-semibold">Review & Learn</h2>
            <p className="text-sm text-muted-foreground">
              Analyze performance, inspect execution history, and revisit your trade journal in one place.
            </p>
          </div>
          <TradingReviewTabs />
        </section>
      </div>
    </AppLayout>
  );
};

export default PaperTrading;
