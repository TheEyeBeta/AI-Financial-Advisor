import { Target, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  {
    label: "Win Rate",
    value: "68%",
    subtext: "34 of 50 trades",
    icon: Target,
    trend: "positive",
  },
  {
    label: "Avg. Profit",
    value: "+$342",
    subtext: "per winning trade",
    icon: TrendingUp,
    trend: "positive",
  },
  {
    label: "Avg. Loss",
    value: "-$187",
    subtext: "per losing trade",
    icon: TrendingDown,
    trend: "negative",
  },
  {
    label: "Profit Factor",
    value: "2.14",
    subtext: "gross profit/loss",
    icon: BarChart2,
    trend: "positive",
  },
];

export function TradeStatistics() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">Trade Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
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
