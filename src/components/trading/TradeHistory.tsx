import { Download, Filter, History, TrendingDown, TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useClosedTrades } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/database";

interface TradeHistoryProps {
  trades?: Trade[];
  isLoading?: boolean;
}

function sortTradesLatestFirst(trades: Trade[]) {
  return [...trades].sort((a, b) => {
    const primaryDateA = a.exit_date ?? a.entry_date;
    const primaryDateB = b.exit_date ?? b.entry_date;
    return primaryDateB.localeCompare(primaryDateA);
  });
}

export function TradeHistory({ trades: tradesProp, isLoading: isLoadingProp }: TradeHistoryProps = {}) {
  const { data: fallbackTrades = [], isLoading: fallbackLoading } = useClosedTrades();
  const trades = tradesProp ?? fallbackTrades;
  const isLoading = isLoadingProp ?? fallbackLoading;
  const visibleTrades = sortTradesLatestFirst(trades).slice(0, 5);

  const winningTrades = visibleTrades.filter((trade) => (trade.pnl || 0) > 0).length;
  const totalPnL = visibleTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 rounded-lg bg-muted/30 animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground/70">
            {visibleTrades.length} closed trades - {winningTrades} wins - {visibleTrades.length - winningTrades} losses
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Filter className="h-3 w-3" />
            Filter
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-0">
          {visibleTrades.length === 0 ? (
            <div className="py-12 text-center">
              <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No trade history</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Closed trades will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {visibleTrades.map((trade, index) => {
                const isProfit = (trade.pnl || 0) >= 0;
                const entryDate = parseISO(trade.entry_date);
                const exitDate = trade.exit_date ? parseISO(trade.exit_date) : null;
                const duration = exitDate
                  ? Math.ceil((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
                  : 0;

                return (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between p-4 transition-colors hover:bg-muted/30 animate-in fade-in"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg",
                          isProfit ? "bg-profit/10" : "bg-loss/10",
                        )}
                      >
                        {isProfit ? (
                          <TrendingUp className="h-4 w-4 text-profit" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-loss" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{trade.symbol}</span>
                          <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
                            {trade.type}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground/60">
                          {trade.quantity} @ ${trade.entry_price.toFixed(2)} -&gt; ${trade.exit_price?.toFixed(2) || "N/A"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="hidden text-right sm:block">
                        <div className="text-xs text-muted-foreground/70">
                          {format(entryDate, "MMM d, yyyy")} -&gt; {exitDate ? format(exitDate, "MMM d, yyyy") : "N/A"}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50">
                          {duration > 0 ? `${duration}d` : "same day"}
                        </div>
                      </div>

                      <div className="min-w-[70px] text-right">
                        <div className={cn("text-sm font-mono font-medium", isProfit ? "text-profit" : "text-loss")}>
                          {isProfit ? "+" : ""}${(trade.pnl || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {visibleTrades.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground/70">Total Realized P&amp;L</span>
            <span className={cn("text-lg font-bold", totalPnL >= 0 ? "text-profit" : "text-loss")}>
              {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
