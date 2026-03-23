import { AppLayout } from "@/components/layout/AppLayout";
import { PortfolioPerformance } from "@/components/dashboard/PortfolioPerformance";
import { TradeStatistics } from "@/components/dashboard/TradeStatistics";
import { MarketOverview } from "@/components/dashboard/MarketOverview";
import { AcademyProgress } from "@/components/dashboard/AcademyProgress";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { useAuth } from "@/hooks/use-auth";
import { useMemo } from "react";
import { usePaperTradingLedger } from "@/hooks/use-paper-trading-ledger";
import { DollarSign, TrendingUp, BarChart2, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TradeStatisticsSummary } from "@/components/dashboard/TradeStatistics";

const Dashboard = () => {
  const { userProfile } = useAuth();
  const {
    openPositions,
    closedTrades,
    portfolioHistory,
    accountValue,
    realizedPnl,
    isLoading,
  } = usePaperTradingLedger();

  const greeting = userProfile?.first_name
    ? `Welcome back, ${userProfile.first_name}`
    : "Welcome back";

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? "morning" : currentHour < 18 ? "afternoon" : "evening";
  const sectionAnimation = "animate-in fade-in slide-in-from-bottom-2 duration-300";

  // Calculate quick summary stats
  const totalPositions = openPositions.length;
  const totalTrades = closedTrades.length;
  const totalPnL = realizedPnl;
  const openPositionsValue = openPositions.reduce(
    (sum, pos) => sum + ((pos.current_price || pos.entry_price) * pos.quantity),
    0
  );
  const latestValue = portfolioHistory.length > 0
    ? portfolioHistory[portfolioHistory.length - 1]?.value || accountValue
    : accountValue || openPositionsValue;

  const tradeStatistics = useMemo<TradeStatisticsSummary>(() => {
    const winningTrades = closedTrades.filter((trade) => (trade.pnl || 0) > 0);
    const losingTrades = closedTrades.filter((trade) => (trade.pnl || 0) <= 0);
    const avgProfit = winningTrades.length > 0
      ? winningTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl || 0), 0) / losingTrades.length
      : 0;

    return {
      winRate: totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0,
      avgProfit,
      avgLoss,
      profitFactor: avgLoss > 0 ? Math.abs(avgProfit) / avgLoss : 0,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
    };
  }, [closedTrades, totalTrades]);

  const quickStats = [
    {
      label: "Portfolio Value",
      value: latestValue > 0 ? `$${latestValue.toLocaleString()}` : "—",
      icon: DollarSign,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Open Positions",
      value: totalPositions.toString(),
      icon: Briefcase,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      label: "Closed Trades",
      value: totalTrades.toString(),
      icon: BarChart2,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      label: "Realized P&L",
      value: totalTrades > 0 ? `${totalPnL >= 0 ? "+" : ""}$${totalPnL.toFixed(2)}` : "—",
      icon: TrendingUp,
      color: totalPnL >= 0 ? "text-profit" : "text-loss",
      bgColor: totalPnL >= 0 ? "bg-profit/10" : "bg-loss/10",
    },
  ];

  return (
    <AppLayout title="Dashboard">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <h1 className="text-2xl font-semibold text-foreground">{greeting}</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            Good {timeOfDay}. Here's your portfolio at a glance.
          </p>
        </div>

        {/* Quick Summary Stats */}
        <div className={`grid gap-3 grid-cols-2 lg:grid-cols-4 ${sectionAnimation}`} style={{ animationDelay: '50ms' }}>
          {quickStats.map((stat) => (
            <Card key={stat.label} className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", stat.bgColor)}>
                    <stat.icon className={cn("h-3.5 w-3.5", stat.color)} />
                  </div>
                  <span className="text-[11px] text-muted-foreground/70 uppercase tracking-wide">{stat.label}</span>
                </div>
                <span className={cn("text-xl font-bold", stat.color)}>{stat.value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '100ms' }}>
            <PortfolioPerformance
              portfolioHistory={portfolioHistory}
              openPositions={openPositions}
              isLoading={isLoading}
            />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '150ms' }}>
            <TradeStatistics stats={tradeStatistics} isLoading={isLoading} />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '200ms' }}>
            <MarketOverview />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '250ms' }}>
            <AcademyProgress />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '300ms' }}>
            <OpenPositions positions={openPositions} isLoading={isLoading} allowClose={false} />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '350ms' }}>
            <TradeHistory trades={closedTrades} isLoading={isLoading} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
