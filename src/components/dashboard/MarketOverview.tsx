import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMarketIndices, useTrendingStocks } from "@/hooks/use-data";

export function MarketOverview() {
  const { data: indices = [], isLoading: indicesLoading } = useMarketIndices();
  const { data: trending = [], isLoading: trendingLoading } = useTrendingStocks();

  if (indicesLoading || trendingLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Market Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading market data...</div>
        </CardContent>
      </Card>
    );
  }
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
          {indices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No market data available. This data can be populated by your Python backend.</div>
          ) : (
            indices.map((index) => {
              const changeStr = `${index.is_positive ? "+" : ""}${index.change_percent.toFixed(2)}%`;
              return (
                <div
                  key={index.symbol}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <span className="font-medium">{index.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{index.symbol}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-medium">{index.value.toLocaleString()}</div>
                    <div
                      className={`flex items-center justify-end gap-1 text-sm ${
                        index.is_positive ? "text-profit" : "text-loss"
                      }`}
                    >
                      {index.is_positive ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {changeStr}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 border-t pt-4">
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">Trending</h4>
          {trending.length === 0 ? (
            <div className="text-xs text-muted-foreground">No trending stocks available.</div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {trending.map((stock) => {
                const changeStr = `${stock.change_percent >= 0 ? "+" : ""}${stock.change_percent.toFixed(1)}%`;
                return (
                  <Badge
                    key={stock.symbol}
                    variant="secondary"
                    className="cursor-pointer hover:bg-secondary/80"
                  >
                    {stock.symbol}
                    <span
                      className={`ml-1 ${
                        stock.change_percent >= 0 ? "text-profit" : "text-loss"
                      }`}
                    >
                      {changeStr}
                    </span>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
