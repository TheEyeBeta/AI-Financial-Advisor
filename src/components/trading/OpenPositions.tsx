import { TrendingUp, TrendingDown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useOpenPositions, useDeletePosition } from "@/hooks/use-data";
import { pythonApi } from "@/services/api";
import { useEffect, useState } from "react";
import type { OpenPosition } from "@/types/database";

export function OpenPositions() {
  const { data: positions = [], isLoading } = useOpenPositions();
  const deletePosition = useDeletePosition();
  const [updatedPositions, setUpdatedPositions] = useState<OpenPosition[]>([]);

  // Update current prices from Python backend or use stored prices
  useEffect(() => {
    const updatePrices = async () => {
      if (positions.length === 0) return;
      
      const updated = await Promise.all(
        positions.map(async (pos) => {
          try {
            const currentPrice = await pythonApi.getStockPrice(pos.symbol);
            return { ...pos, current_price: currentPrice };
          } catch (error) {
            // Fallback to stored price if API fails
            console.error(`Error fetching price for ${pos.symbol}:`, error);
            return pos;
          }
        })
      );
      
      setUpdatedPositions(updated);
    };

    updatePrices();
    // Refresh prices every 30 seconds
    const interval = setInterval(updatePrices, 30000);
    return () => clearInterval(interval);
  }, [positions]);

  const displayPositions = updatedPositions.length > 0 ? updatedPositions : positions;

  const calculatePnL = (position: OpenPosition) => {
    const currentPrice = position.current_price || position.entry_price;
    const pnl = (currentPrice - position.entry_price) * position.quantity;
    const pnlPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
    return { pnl, pnlPercent };
  };

  const totalValue = displayPositions.reduce(
    (sum, pos) => sum + (pos.current_price || pos.entry_price) * pos.quantity,
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
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Loading positions...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Market Value</div>
            <div className="text-2xl font-bold">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Unrealized P&L</div>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
              {totalPnL >= 0 ? "+" : ""}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Open Positions</div>
            <div className="text-2xl font-bold">{positions.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Current Holdings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayPositions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No open positions. Start trading to see your positions here!
                  </TableCell>
                </TableRow>
              ) : (
                displayPositions.map((position) => {
                  const { pnl, pnlPercent } = calculatePnL(position);
                  const isProfit = pnl >= 0;
                  const currentPrice = position.current_price || position.entry_price;

                  return (
                    <TableRow key={position.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{position.symbol}</div>
                          <div className="text-xs text-muted-foreground">{position.name || position.symbol}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-primary/10">
                          {position.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {position.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${position.entry_price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${currentPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`flex items-center justify-end gap-1 ${isProfit ? "text-profit" : "text-loss"}`}>
                          {isProfit ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          <span className="font-mono font-medium">
                            {isProfit ? "+" : ""}${pnl.toFixed(2)}
                          </span>
                          <span className="text-xs">({pnlPercent.toFixed(2)}%)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={() => handleClosePosition(position.id)}
                          disabled={deletePosition.isPending}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Close
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
