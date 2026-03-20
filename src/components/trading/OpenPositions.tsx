import { TrendingUp, TrendingDown, X, Briefcase, DollarSign, Activity, Wifi, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOpenPositions, useDeletePosition } from "@/hooks/use-data";
import { useTradeEngineConnection } from "@/hooks/use-trade-engine";
import type { OpenPosition } from "@/types/database";
import { cn } from "@/lib/utils";

export function OpenPositions() {
  const { data: positions = [], isLoading } = useOpenPositions();
  const deletePosition = useDeletePosition();
  
  const { isConnected, isConnecting } = useTradeEngineConnection();
  const displayPositions = positions;

  const calculatePnL = (position: OpenPosition) => {
    const currentPrice = position.current_price ?? position.entry_price;
    const pnl = (currentPrice - position.entry_price) * position.quantity;
    const pnlPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
    return { pnl, pnlPercent };
  };

  const totalValue = displayPositions.reduce(
    (sum, pos) => sum + (pos.current_price ?? pos.entry_price) * pos.quantity,
    0
  );
  const totalPnL = displayPositions.reduce(
    (sum, pos) => sum + calculatePnL(pos).pnl,
    0
  );

  const handleClosePosition = async (id: string) => {
    if (confirm('Are you sure you want to close this position?')) {
      try {
        await deletePosition.mutateAsync(id);
      } catch (error) {
        console.error('Error closing position:', error);
        alert('Failed to close position. Please try again.');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-48 bg-muted/30 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Market Value</span>
            </div>
            <div className="text-xl font-bold">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Unrealized P&L</span>
            </div>
            <div className={cn("text-xl font-bold", totalPnL >= 0 ? "text-profit" : "text-loss")}>
              {totalPnL >= 0 ? "+" : ""}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Positions</span>
              </div>
              {/* Live connection indicator */}
              <div className="flex items-center gap-1">
                {isConnected ? (
                  <Wifi className="h-3 w-3 text-profit" />
                ) : isConnecting ? (
                  <Wifi className="h-3 w-3 text-yellow-500 animate-pulse" />
                ) : (
                  <WifiOff className="h-3 w-3 text-muted-foreground/50" />
                )}
                <span className={cn(
                  "text-[9px] uppercase tracking-wide",
                  isConnected ? "text-profit" : isConnecting ? "text-yellow-500" : "text-muted-foreground/50"
                )}>
                  {isConnected ? "Live" : isConnecting ? "..." : "Offline"}
                </span>
              </div>
            </div>
            <div className="text-xl font-bold">{positions.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Positions List */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          {displayPositions.length === 0 ? (
            <div className="py-12 text-center">
              <Briefcase className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No open positions</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Start trading to see your holdings here</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {displayPositions.map((position, index) => {
                const { pnl, pnlPercent } = calculatePnL(position);
                const isProfit = pnl >= 0;
                const currentPrice = position.current_price ?? position.entry_price;
                const hasMarkedPrice = position.current_price !== null && position.current_price !== undefined;

                return (
                  <div 
                    key={position.id} 
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors animate-in fade-in"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">{position.symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{position.symbol}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/5">
                            {position.type}
                          </Badge>
                          {hasMarkedPrice && (
                            <span className="flex items-center gap-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-profit" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground/60 mt-0.5">
                          {position.quantity} shares @ ${position.entry_price.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <div className={cn(
                          "text-sm font-mono transition-colors",
                          hasMarkedPrice && "text-foreground"
                        )}>
                          ${currentPrice.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50 flex items-center justify-end gap-1">
                          <span>{hasMarkedPrice ? "snapshot" : "entry"}</span>
                        </div>
                      </div>
                      
                      <div className="text-right min-w-[80px]">
                        <div className={cn("flex items-center justify-end gap-1 text-sm font-medium", isProfit ? "text-profit" : "text-loss")}>
                          {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          <span className="font-mono">{isProfit ? "+" : ""}${pnl.toFixed(2)}</span>
                        </div>
                        <div className={cn("text-[10px]", isProfit ? "text-profit/70" : "text-loss/70")}>
                          {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
                        </div>
                      </div>
                      
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleClosePosition(position.id)}
                        disabled={deletePosition.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
