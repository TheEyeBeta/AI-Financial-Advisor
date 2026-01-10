import { Download, Filter } from "lucide-react";
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

const trades = [
  {
    id: 1,
    symbol: "GOOGL",
    type: "LONG",
    action: "CLOSED",
    quantity: 12,
    entryPrice: 142.50,
    exitPrice: 156.80,
    entryDate: "2024-01-15",
    exitDate: "2024-01-22",
    pnl: 171.60,
  },
  {
    id: 2,
    symbol: "AMD",
    type: "LONG",
    action: "CLOSED",
    quantity: 30,
    entryPrice: 165.00,
    exitPrice: 158.20,
    entryDate: "2024-01-10",
    exitDate: "2024-01-18",
    pnl: -204.00,
  },
  {
    id: 3,
    symbol: "META",
    type: "LONG",
    action: "CLOSED",
    quantity: 8,
    entryPrice: 485.00,
    exitPrice: 512.30,
    entryDate: "2024-01-08",
    exitDate: "2024-01-16",
    pnl: 218.40,
  },
  {
    id: 4,
    symbol: "AMZN",
    type: "LONG",
    action: "CLOSED",
    quantity: 15,
    entryPrice: 178.50,
    exitPrice: 185.20,
    entryDate: "2024-01-05",
    exitDate: "2024-01-12",
    pnl: 100.50,
  },
  {
    id: 5,
    symbol: "NFLX",
    type: "LONG",
    action: "CLOSED",
    quantity: 5,
    entryPrice: 545.00,
    exitPrice: 532.80,
    entryDate: "2024-01-02",
    exitDate: "2024-01-08",
    pnl: -61.00,
  },
];

export function TradeHistory() {
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Trade History</h2>
          <p className="text-sm text-muted-foreground">
            {trades.length} closed trades • {winningTrades} wins • {trades.length - winningTrades} losses
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Filter
          </Button>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => {
                const isProfit = trade.pnl >= 0;
                const entryDate = new Date(trade.entryDate);
                const exitDate = new Date(trade.exitDate);
                const duration = Math.ceil((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

                return (
                  <TableRow key={trade.id}>
                    <TableCell className="font-medium">{trade.symbol}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{trade.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{trade.quantity}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono">${trade.entryPrice.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{trade.entryDate}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono">${trade.exitPrice.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{trade.exitDate}</div>
                    </TableCell>
                    <TableCell>{duration} days</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono font-medium ${isProfit ? "text-profit" : "text-loss"}`}>
                        {isProfit ? "+" : ""}${trade.pnl.toFixed(2)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <span className="text-sm text-muted-foreground">Total Realized P&L</span>
          <span className={`text-xl font-bold ${totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
            {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
