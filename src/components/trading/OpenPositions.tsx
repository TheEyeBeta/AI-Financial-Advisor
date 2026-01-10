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

const positions = [
  {
    id: 1,
    symbol: "AAPL",
    name: "Apple Inc.",
    quantity: 25,
    entryPrice: 178.50,
    currentPrice: 185.20,
    type: "LONG",
  },
  {
    id: 2,
    symbol: "MSFT",
    name: "Microsoft Corp",
    quantity: 15,
    entryPrice: 420.00,
    currentPrice: 415.80,
    type: "LONG",
  },
  {
    id: 3,
    symbol: "NVDA",
    name: "NVIDIA Corp",
    quantity: 10,
    entryPrice: 875.00,
    currentPrice: 920.50,
    type: "LONG",
  },
  {
    id: 4,
    symbol: "TSLA",
    name: "Tesla Inc.",
    quantity: 8,
    entryPrice: 245.00,
    currentPrice: 238.75,
    type: "LONG",
  },
];

export function OpenPositions() {
  const calculatePnL = (position: typeof positions[0]) => {
    const pnl = (position.currentPrice - position.entryPrice) * position.quantity;
    const pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    return { pnl, pnlPercent };
  };

  const totalValue = positions.reduce(
    (sum, pos) => sum + pos.currentPrice * pos.quantity,
    0
  );
  const totalPnL = positions.reduce(
    (sum, pos) => sum + calculatePnL(pos).pnl,
    0
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
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
          <CardTitle>Current Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
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
              {positions.map((position) => {
                const { pnl, pnlPercent } = calculatePnL(position);
                const isProfit = pnl >= 0;

                return (
                  <TableRow key={position.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{position.symbol}</div>
                        <div className="text-xs text-muted-foreground">{position.name}</div>
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
                      ${position.entryPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${position.currentPrice.toFixed(2)}
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
                      <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive">
                        <X className="h-4 w-4 mr-1" />
                        Close
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
