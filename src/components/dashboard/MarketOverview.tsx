import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const indices = [
  { name: "S&P 500", symbol: "SPX", value: "5,234.18", change: "+1.24%", positive: true },
  { name: "NASDAQ", symbol: "IXIC", value: "16,742.39", change: "+1.58%", positive: true },
  { name: "DOW JONES", symbol: "DJI", value: "39,087.38", change: "+0.87%", positive: true },
  { name: "RUSSELL 2000", symbol: "RUT", value: "2,089.45", change: "-0.32%", positive: false },
];

const trending = [
  { symbol: "NVDA", name: "NVIDIA", change: "+4.2%" },
  { symbol: "TSLA", name: "Tesla", change: "-2.1%" },
  { symbol: "AAPL", name: "Apple", change: "+0.8%" },
];

export function MarketOverview() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Market Overview</CardTitle>
        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
          <Activity className="mr-1 h-3 w-3" />
          Market Open
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {indices.map((index) => (
            <div
              key={index.symbol}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <span className="font-medium">{index.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{index.symbol}</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-medium">{index.value}</div>
                <div
                  className={`flex items-center justify-end gap-1 text-sm ${
                    index.positive ? "text-profit" : "text-loss"
                  }`}
                >
                  {index.positive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {index.change}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t pt-4">
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">Trending</h4>
          <div className="flex gap-2">
            {trending.map((stock) => (
              <Badge
                key={stock.symbol}
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80"
              >
                {stock.symbol}
                <span
                  className={`ml-1 ${
                    stock.change.startsWith("+") ? "text-profit" : "text-loss"
                  }`}
                >
                  {stock.change}
                </span>
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
