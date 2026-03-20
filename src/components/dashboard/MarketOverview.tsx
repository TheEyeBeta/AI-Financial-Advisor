import { TrendingUp, TrendingDown, Activity, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useMarketIndices, useTrendingStocks } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export function MarketOverview() {
  const { data: indices = [], isLoading: indicesLoading } = useMarketIndices();
  const { data: trending = [], isLoading: trendingLoading } = useTrendingStocks();
  const navigate = useNavigate();

  if (indicesLoading || trendingLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-5 pb-4">
          <div className="h-4 w-24 bg-muted/50 rounded animate-pulse mb-4" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="pt-5 pb-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Markets</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              A quick snapshot of major indexes and trending stocks so users can see the market tone before reviewing their portfolio.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-profit">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-profit" />
            </span>
            Open
          </div>
        </div>
        
        <div className="space-y-2">
          {indices.length === 0 ? (
            <div className="py-6 text-center">
              <Activity className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60">No market data</p>
            </div>
          ) : (
            indices.map((index) => {
              const changeStr = `${index.is_positive ? "+" : ""}${index.change_percent.toFixed(2)}%`;
              return (
                <div
                  key={index.symbol}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{index.symbol}</span>
                    <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">
                      {index.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm">{index.value.toLocaleString()}</span>
                    <div
                      className={cn(
                        "flex items-center gap-0.5 text-xs font-medium min-w-[60px] justify-end",
                        index.is_positive ? "text-profit" : "text-loss"
                      )}
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

        {trending.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mb-2">Trending</p>
            <div className="flex gap-1.5 flex-wrap">
              {trending.map((stock) => {
                const isUp = stock.change_percent >= 0;
                const changeStr = `${isUp ? "+" : ""}${stock.change_percent.toFixed(1)}%`;
                return (
                  <div
                    key={stock.symbol}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 text-xs"
                  >
                    <span className="font-medium">{stock.symbol}</span>
                    <span className={cn("text-[10px]", isUp ? "text-profit" : "text-loss")}>
                      {changeStr}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => navigate("/top-stocks")}
          >
            Explore market movers
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
