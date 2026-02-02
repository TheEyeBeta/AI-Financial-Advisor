import { Download, Filter, History, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClosedTrades } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

export function TradeHistory() {
  const { data: trades = [], isLoading } = useClosedTrades();
  
  const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-muted/30 rounded-lg animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground/70">
            {trades.length} trades · {winningTrades} wins · {trades.length - winningTrades} losses
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
            <Filter className="h-3 w-3" />
            Filter
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </div>
      </div>

      {/* Trades List */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          {trades.length === 0 ? (
            <div className="py-12 text-center">
              <History className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No trade history</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Closed trades will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {trades.map((trade, index) => {
                const isProfit = (trade.pnl || 0) >= 0;
                const entryDate = parseISO(trade.entry_date);
                const exitDate = trade.exit_date ? parseISO(trade.exit_date) : null;
                const duration = exitDate
                  ? Math.ceil((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
                  : 0;

                return (
                  <div 
                    key={trade.id} 
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors animate-in fade-in"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center",
                        isProfit ? "bg-profit/10" : "bg-loss/10"
                      )}>
                        {isProfit ? (
                          <TrendingUp className="h-4 w-4 text-profit" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-loss" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{trade.symbol}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {trade.type}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground/60 mt-0.5">
                          {trade.quantity} @ ${trade.entry_price.toFixed(2)} → ${trade.exit_price?.toFixed(2) || 'N/A'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <div className="text-xs text-muted-foreground/70">
                          {format(entryDate, "MMM d")} → {exitDate ? format(exitDate, "MMM d") : 'N/A'}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50">
                          {duration > 0 ? `${duration}d` : 'same day'}
                        </div>
                      </div>
                      
                      <div className="text-right min-w-[70px]">
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

      {/* Total P&L */}
      {trades.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center justify-between py-3 px-4">
            <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Total Realized P&L</span>
            <span className={cn("text-lg font-bold", totalPnL >= 0 ? "text-profit" : "text-loss")}>
              {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
