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
import { useClosedTrades } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";

export function TradeHistory() {
  const { data: trades = [], isLoading } = useClosedTrades();
  
  const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Loading trade history...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
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
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Qty</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Entry</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Exit</TableHead>
                  <TableHead className="hidden lg:table-cell">Duration</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No closed trades yet. Start trading to see your history here!
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => {
                  const isProfit = (trade.pnl || 0) >= 0;
                  const entryDate = parseISO(trade.entry_date);
                  const exitDate = trade.exit_date ? parseISO(trade.exit_date) : null;
                  const duration = exitDate
                    ? Math.ceil((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                  return (
                    <TableRow key={trade.id}>
                      <TableCell className="font-medium">
                        <div>
                          <div>{trade.symbol}</div>
                          <div className="text-xs text-muted-foreground md:hidden">
                            Qty {trade.quantity} • Entry ${trade.entry_price.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground lg:hidden md:block">
                            Exit {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : "N/A"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{trade.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono hidden md:table-cell">{trade.quantity}</TableCell>
                      <TableCell className="text-right hidden md:table-cell">
                        <div className="font-mono">${trade.entry_price.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{format(entryDate, "yyyy-MM-dd")}</div>
                      </TableCell>
                      <TableCell className="text-right hidden lg:table-cell">
                        {trade.exit_price ? (
                          <>
                            <div className="font-mono">${trade.exit_price.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">
                              {exitDate ? format(exitDate, "yyyy-MM-dd") : "N/A"}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground">N/A</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {duration > 0 ? `${duration} days` : "N/A"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono font-medium ${isProfit ? "text-profit" : "text-loss"}`}>
                          {isProfit ? "+" : ""}${(trade.pnl || 0).toFixed(2)}
                        </span>
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
