import { AppLayout } from "@/components/layout/AppLayout";
import { PortfolioPerformance } from "@/components/dashboard/PortfolioPerformance";
import { TradeStatistics } from "@/components/dashboard/TradeStatistics";
import { MarketOverview } from "@/components/dashboard/MarketOverview";
import { OpenPositions } from "@/components/trading/OpenPositions";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { useAuth } from "@/hooks/use-auth";
import { useOpenPositions, useClosedTrades, usePortfolioHistory } from "@/hooks/use-data";
import { DollarSign, TrendingUp, BarChart2, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const Dashboard = () => {
  const { userProfile } = useAuth();
  const { data: positions = [] } = useOpenPositions();
  const { data: closedTrades = [] } = useClosedTrades();
  const { data: portfolioHistory = [] } = usePortfolioHistory();

  const greeting = userProfile?.first_name
    ? `Welcome back, ${userProfile.first_name}`
    : "Welcome back";

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? "morning" : currentHour < 18 ? "afternoon" : "evening";
  const sectionAnimation = "animate-in fade-in slide-in-from-bottom-2 duration-300";

  // Calculate quick summary stats
  const totalPositions = positions.length;
  const totalTrades = closedTrades.length;
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const latestValue = portfolioHistory.length > 0
    ? portfolioHistory[portfolioHistory.length - 1]?.value || 0
    : 0;

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
            <PortfolioPerformance />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '150ms' }}>
            <TradeStatistics />
          </div>
          <div className={sectionAnimation} style={{ animationDelay: '200ms' }}>
            <MarketOverview />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '250ms' }}>
            <OpenPositions />
          </div>
          <div className={`lg:col-span-2 ${sectionAnimation}`} style={{ animationDelay: '300ms' }}>
            <TradeHistory />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
