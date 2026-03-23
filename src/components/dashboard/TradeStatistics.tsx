import { Target, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTradeStatistics } from "@/hooks/use-data";
import { cn } from "@/lib/utils";

export interface TradeStatisticsSummary {
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

interface TradeStatisticsProps {
  stats?: TradeStatisticsSummary;
  isLoading?: boolean;
}

const emptyStats: TradeStatisticsSummary = {
  winRate: 0,
  avgProfit: 0,
  avgLoss: 0,
  profitFactor: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
};

export function TradeStatistics({ stats: statsProp, isLoading: isLoadingProp }: TradeStatisticsProps = {}) {
  const { data: fallbackStats, isLoading: fallbackLoading } = useTradeStatistics();
  const stats = statsProp ?? fallbackStats ?? emptyStats;
  const isLoading = isLoadingProp ?? fallbackLoading;

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

  const hasTrades = stats.totalTrades > 0;

  const displayStats = [
    {
      label: "Win Rate",
      value: hasTrades ? `${stats.winRate.toFixed(0)}%` : "—",
      subtext: hasTrades ? `${stats.winningTrades}/${stats.totalTrades}` : "no trades",
      icon: Target,
      trend: hasTrades && stats.winRate >= 50 ? "positive" : "neutral",
    },
    {
      label: "Avg Profit",
      value: hasTrades ? `$${Math.abs(stats.avgProfit).toFixed(0)}` : "—",
      subtext: hasTrades ? "per win" : "no trades",
      icon: TrendingUp,
      trend: hasTrades ? "positive" : "neutral",
    },
    {
      label: "Avg Loss",
      value: hasTrades ? `$${stats.avgLoss.toFixed(0)}` : "—",
      subtext: hasTrades ? "per loss" : "no trades",
      icon: TrendingDown,
      trend: hasTrades ? "negative" : "neutral",
    },
    {
      label: "Profit Factor",
      value: hasTrades ? stats.profitFactor.toFixed(2) : "—",
      subtext: hasTrades ? "ratio" : "no trades",
      icon: BarChart2,
      trend: hasTrades && stats.profitFactor >= 1 ? "positive" : "neutral",
    },
  ];

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-4">Trade Statistics</p>
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
                    stat.trend === "positive" ? "text-profit/70" :
                    stat.trend === "negative" ? "text-loss/70" :
                    "text-muted-foreground/30",
                  )}
                />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-xl font-bold",
                    stat.trend === "positive" ? "text-profit" :
                    stat.trend === "negative" ? "text-loss" :
                    "text-muted-foreground/50",
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
