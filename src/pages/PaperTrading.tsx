import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { useAuth } from "@/hooks/use-auth";
import { PaperTradingOverview } from "@/components/trading/PaperTradingOverview";
import { TradingReviewTabs } from "@/components/trading/TradingReviewTabs";
import { TradeEngineStatus } from "@/components/trading/TradeEngineStatus";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePaperTradingLedger } from "@/hooks/use-paper-trading-ledger";
import { cn } from "@/lib/utils";

const PaperTrading = () => {
  const { userProfile } = useAuth();
  const [isTradeTicketOpen, setIsTradeTicketOpen] = useState(false);
  const {
    journalEntries,
    isJournalLoading,
    isLoading,
    openPositions,
    closedTrades,
    portfolioHistory,
  } = usePaperTradingLedger();
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

        <div className={sectionAnimation} style={{ animationDelay: "50ms" }}>
          <PaperTradingOverview
            positions={openPositions}
            trades={closedTrades}
            portfolioHistory={portfolioHistory}
            isLoading={isLoading}
          />
        </div>

        <section className={`${sectionAnimation} space-y-3`} style={{ animationDelay: "100ms" }}>
          <div>
            <h2 className="text-lg font-semibold">Review & Learn</h2>
            <p className="text-sm text-muted-foreground">
              Analyze performance, inspect execution history, and revisit your trade journal in one place.
            </p>
          </div>
          <TradingReviewTabs
            journalEntries={journalEntries}
            isJournalLoading={isJournalLoading}
            openPositions={openPositions}
            closedTrades={closedTrades}
            portfolioHistory={portfolioHistory}
            isLedgerLoading={isLoading}
          />
        </section>

        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.05fr_1.4fr]">
          <Collapsible
            open={isTradeTicketOpen}
            onOpenChange={setIsTradeTicketOpen}
            className={sectionAnimation}
            style={{ animationDelay: "150ms" }}
          >
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
                <div>
                  <CardTitle className="text-base">Trade Ticket</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Log a simulated BUY. Close positions later from the journal.
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5">
                    {isTradeTicketOpen ? "Collapse" : "Open Ticket"}
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform duration-200", isTradeTicketOpen && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <CardContent>
                  <TradeJournal
                    mode="workspace"
                    openPositions={openPositions}
                    journalEntries={journalEntries}
                  />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <div className={sectionAnimation} style={{ animationDelay: "200ms" }}>
            <OpenPositions positions={openPositions} isLoading={isLoading} allowClose={false} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default PaperTrading;
