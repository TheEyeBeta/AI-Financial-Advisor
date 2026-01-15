import { Target, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTradeStatistics } from "@/hooks/use-data";

export function TradeStatistics() {
  const { data: stats, isLoading } = useTradeStatistics();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">Trade Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.totalTrades === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">Trade Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No trades yet. Start trading to see statistics!</div>
        </CardContent>
      </Card>
    );
  }

  const displayStats = [
    {
      label: "Win Rate",
      value: `${stats.winRate.toFixed(0)}%`,
      subtext: `${stats.winningTrades} of ${stats.totalTrades} trades`,
      icon: Target,
      trend: stats.winRate >= 50 ? "positive" : "negative",
    },
    {
      label: "Avg. Profit",
      value: `+$${Math.abs(stats.avgProfit).toFixed(0)}`,
      subtext: "per winning trade",
      icon: TrendingUp,
      trend: "positive",
    },
    {
      label: "Avg. Loss",
      value: `-$${stats.avgLoss.toFixed(0)}`,
      subtext: "per losing trade",
      icon: TrendingDown,
      trend: "negative",
    },
    {
      label: "Profit Factor",
      value: stats.profitFactor.toFixed(2),
      subtext: "gross profit/loss",
      icon: BarChart2,
      trend: stats.profitFactor >= 1 ? "positive" : "negative",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">Trade Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {displayStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border bg-muted/30 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{stat.label}</span>
                <stat.icon
                  className={`h-4 w-4 ${
                    stat.trend === "positive" ? "text-profit" : "text-loss"
                  }`}
                />
              </div>
              <div className="mt-2">
                <span
                  className={`text-2xl font-bold ${
                    stat.trend === "positive" ? "text-profit" : "text-loss"
                  }`}
                >
                  {stat.value}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{stat.subtext}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
