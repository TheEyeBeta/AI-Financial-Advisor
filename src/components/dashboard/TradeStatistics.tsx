import { Target, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTradeStatistics } from "@/hooks/use-data";
import { cn } from "@/lib/utils";

export function TradeStatistics() {
  const { data: stats, isLoading } = useTradeStatistics();

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-5 pb-4">
          <div className="h-4 w-24 bg-muted/50 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.totalTrades === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="py-10 text-center">
          <BarChart2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No trades yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Statistics appear after your first trade</p>
        </CardContent>
      </Card>
    );
  }

  const displayStats = [
    {
      label: "Win Rate",
      value: `${stats.winRate.toFixed(0)}%`,
      subtext: `${stats.winningTrades}/${stats.totalTrades}`,
      icon: Target,
      trend: stats.winRate >= 50 ? "positive" : "negative",
    },
    {
      label: "Avg Profit",
      value: `$${Math.abs(stats.avgProfit).toFixed(0)}`,
      subtext: "per win",
      icon: TrendingUp,
      trend: "positive",
    },
    {
      label: "Avg Loss",
      value: `$${stats.avgLoss.toFixed(0)}`,
      subtext: "per loss",
      icon: TrendingDown,
      trend: "negative",
    },
    {
      label: "Profit Factor",
      value: stats.profitFactor.toFixed(2),
      subtext: "ratio",
      icon: BarChart2,
      trend: stats.profitFactor >= 1 ? "positive" : "negative",
    },
  ];

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-4">Statistics</p>
        <div className="grid grid-cols-2 gap-3">
          {displayStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-muted/30 p-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground/70">{stat.label}</span>
                <stat.icon
                  className={cn(
                    "h-3.5 w-3.5",
                    stat.trend === "positive" ? "text-profit/70" : "text-loss/70"
                  )}
                />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-xl font-bold",
                    stat.trend === "positive" ? "text-profit" : "text-loss"
                  )}
                >
                  {stat.value}
                </span>
                <span className="text-[10px] text-muted-foreground/50">{stat.subtext}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
