import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolioHistory, useClosedTrades, useOpenPositions } from "@/hooks/use-data";
import { format, parseISO, startOfWeek, eachWeekOfInterval, subMonths, eachMonthOfInterval } from "date-fns";
import { useMemo, useEffect, useState } from "react";
import { pythonApi } from "@/services/api";
import type { OpenPosition } from "@/types/database";

export function PerformanceCharts() {
  const { data: portfolioHistory = [], isLoading: portfolioLoading } = usePortfolioHistory();
  const { data: trades = [], isLoading: tradesLoading } = useClosedTrades();
  const { data: positions = [], isLoading: positionsLoading } = useOpenPositions();
  const [livePositions, setLivePositions] = useState<OpenPosition[]>([]);
  const [currentPortfolioValue, setCurrentPortfolioValue] = useState<number | null>(null);

  // Fetch live prices for open positions
  useEffect(() => {
    const updateLivePrices = async () => {
      if (positions.length === 0) {
        setLivePositions([]);
        return;
      }
      
      try {
        const updated = await Promise.all(
          positions.map(async (pos) => {
            try {
              const currentPrice = await pythonApi.getStockPrice(pos.symbol);
              return { ...pos, current_price: currentPrice };
            } catch (error) {
              console.error(`Error fetching price for ${pos.symbol}:`, error);
              return pos; // Fallback to stored price
            }
          })
        );
        
        setLivePositions(updated);
        
        // Calculate current portfolio value
        // This should match "Total Market Value" from OpenPositions
        // Simply sum of (current_price * quantity) for all open positions
        const totalMarketValue = updated.reduce((sum, pos) => {
          const currentPrice = pos.current_price || pos.entry_price;
          return sum + (currentPrice * pos.quantity);
        }, 0);
        
        setCurrentPortfolioValue(totalMarketValue);
      } catch (error) {
        console.error('Error updating live prices:', error);
      }
    };

    updateLivePrices();
    // Refresh prices every 30 seconds
    const interval = setInterval(updateLivePrices, 30000);
    return () => clearInterval(interval);
  }, [positions, portfolioHistory]);

  // Calculate equity curve from portfolio history (group by week) + current live value
  const equityData = useMemo(() => {
    const data: Array<{ date: string; value: number; fullDate: string; isLive?: boolean }> = [];
    
    if (portfolioHistory.length > 0) {
      const sorted = [...portfolioHistory].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      // Group by week
      const weeklyData: Record<string, number> = {};
      sorted.forEach(entry => {
        const date = parseISO(entry.date);
        const weekStart = format(startOfWeek(date), 'MMM d');
        weeklyData[weekStart] = entry.value;
      });
      
      Object.entries(weeklyData).forEach(([date, value], index) => {
        data.push({
          date: `Week ${index + 1}`,
          value,
          fullDate: date,
        });
      });
    }
    
    // Add current live value if available
    if (currentPortfolioValue !== null) {
      const today = new Date();
      const weekStart = format(startOfWeek(today), 'MMM d');
      data.push({
        date: 'Now',
        value: currentPortfolioValue,
        fullDate: weekStart,
        isLive: true,
      });
    }
    
    return data;
  }, [portfolioHistory, currentPortfolioValue]);

  // Calculate win/loss distribution
  const winLossData = useMemo(() => {
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    const losses = trades.filter(t => (t.pnl || 0) <= 0).length;
    
    return [
      { name: "Wins", value: wins, fill: "hsl(var(--chart-2))" },
      { name: "Losses", value: losses, fill: "hsl(var(--loss))" },
    ];
  }, [trades]);

  // Calculate monthly performance
  const monthlyData = useMemo(() => {
    if (trades.length === 0) return [];
    
    const monthly: Record<string, { profit: number; loss: number }> = {};
    
    trades.forEach(trade => {
      if (!trade.exit_date || !trade.pnl) return;
      
      const month = format(parseISO(trade.exit_date), 'MMM');
      if (!monthly[month]) {
        monthly[month] = { profit: 0, loss: 0 };
      }
      
      if (trade.pnl > 0) {
        monthly[month].profit += trade.pnl;
      } else {
        monthly[month].loss += trade.pnl;
      }
    });
    
    return Object.entries(monthly).map(([month, data]) => ({
      month,
      profit: data.profit,
      loss: data.loss,
    })).slice(-6); // Last 6 months
  }, [trades]);

  // Simple sector grouping (for now, based on symbols - can be enhanced)
  const sectorData = useMemo(() => {
    if (trades.length === 0) return [];
    
    const sectorMap: Record<string, number> = {};
    
    trades.forEach(trade => {
      if (!trade.pnl) return;
      
      // Simple sector mapping (can be enhanced with actual sector data)
      const symbol = trade.symbol;
      let sector = 'Other';
      
      if (['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AMD'].includes(symbol)) {
        sector = 'Tech';
      } else if (['JPM', 'BAC', 'GS', 'MS'].includes(symbol)) {
        sector = 'Finance';
      } else if (['JNJ', 'PFE', 'UNH'].includes(symbol)) {
        sector = 'Healthcare';
      } else if (['AMZN', 'WMT', 'TGT'].includes(symbol)) {
        sector = 'Consumer';
      } else if (['XOM', 'CVX'].includes(symbol)) {
        sector = 'Energy';
      }
      
      sectorMap[sector] = (sectorMap[sector] || 0) + (trade.pnl || 0);
    });
    
    return Object.entries(sectorMap).map(([sector, pnl]) => ({
      sector,
      pnl: Math.round(pnl * 100) / 100,
    })).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  // Calculate portfolio stats with live data
  const portfolioStats = useMemo(() => {
    // Current portfolio value = Total Market Value (same as OpenPositions)
    const currentValue = currentPortfolioValue ?? 0;
    
    // Calculate total cost basis (what was paid for all open positions)
    const totalCostBasis = livePositions.reduce((sum, pos) => {
      return sum + (pos.entry_price * pos.quantity);
    }, 0);
    
    // Calculate unrealized P&L from live positions
    const unrealizedPnL = livePositions.reduce((sum, pos) => {
      const currentPrice = pos.current_price || pos.entry_price;
      const pnl = (currentPrice - pos.entry_price) * pos.quantity;
      return sum + pnl;
    }, 0);
    
    // Calculate realized P&L from closed trades
    const realizedPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    
    // Total return = current value - cost basis (or use first portfolio_history entry if available)
    const baseValue = portfolioHistory.length > 0 
      ? portfolioHistory[0].value 
      : totalCostBasis; // Fallback to cost basis if no history
    const totalReturn = currentValue - baseValue;
    const percentReturn = baseValue > 0 ? ((totalReturn / baseValue) * 100) : 0;
    
    return {
      baseValue,
      currentValue,
      totalReturn,
      percentReturn,
      unrealizedPnL,
      realizedPnL,
      totalPnL: unrealizedPnL + realizedPnL,
      totalCostBasis,
    };
  }, [portfolioHistory, currentPortfolioValue, livePositions, trades]);

  if (portfolioLoading || tradesLoading || positionsLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Loading performance data...</div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
      {/* Portfolio Value Summary Cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Current Portfolio Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            ${portfolioStats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-sm mt-1 ${portfolioStats.totalReturn >= 0 ? 'text-profit' : 'text-loss'}`}>
            {portfolioStats.totalReturn >= 0 ? '+' : ''}${portfolioStats.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
            ({portfolioStats.percentReturn >= 0 ? '+' : ''}{portfolioStats.percentReturn.toFixed(2)}%)
          </div>
          {currentPortfolioValue !== null && (
            <div className="text-xs text-muted-foreground mt-1">Live prices • Updates every 30s</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">P&L Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Realized P&L:</span>
              <span className={`text-sm font-medium ${portfolioStats.realizedPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
                {portfolioStats.realizedPnL >= 0 ? '+' : ''}${portfolioStats.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Unrealized P&L:</span>
              <span className={`text-sm font-medium ${portfolioStats.unrealizedPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
                {portfolioStats.unrealizedPnL >= 0 ? '+' : ''}${portfolioStats.unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-sm font-semibold">Total P&L:</span>
              <span className={`text-sm font-bold ${portfolioStats.totalPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
                {portfolioStats.totalPnL >= 0 ? '+' : ''}${portfolioStats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Equity Curve {currentPortfolioValue !== null && <span className="text-xs text-muted-foreground font-normal">(Live)</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {equityData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No portfolio history available. Start trading to see your equity curve!
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, "Equity"]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#colorEquity)"
                  strokeDasharray={equityData[equityData.length - 1]?.isLive ? "5 5" : "0"}
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Win/Loss Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {winLossData.every(d => d.value === 0) ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No trades yet. Start trading to see win/loss distribution!
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                <Pie
                  data={winLossData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={false}
                >
                  {winLossData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>
          {winLossData.some(d => d.value > 0) && (
            <div className="mt-2 flex justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-chart-2" />
                <span>Wins ({winLossData[0].value})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-loss" />
                <span>Losses ({winLossData[1].value})</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>P&L by Sector</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {sectorData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No sector data available yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectorData} layout="vertical">
                <XAxis
                  type="number"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <YAxis
                  dataKey="sector"
                  type="category"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`$${value}`, "P&L"]}
                />
                <Bar dataKey="pnl" radius={4}>
                  {sectorData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.pnl >= 0 ? "hsl(var(--chart-2))" : "hsl(var(--loss))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Monthly Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {monthlyData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No monthly performance data available yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                <XAxis
                  dataKey="month"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="profit" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Profit" />
                <Bar dataKey="loss" fill="hsl(var(--loss))" radius={[4, 4, 0, 0]} name="Loss" />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
