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
import { usePortfolioHistory, useClosedTrades } from "@/hooks/use-data";
import { format, parseISO, startOfWeek, eachWeekOfInterval, subMonths, eachMonthOfInterval } from "date-fns";
import { useMemo } from "react";

export function PerformanceCharts() {
  const { data: portfolioHistory = [], isLoading: portfolioLoading } = usePortfolioHistory();
  const { data: trades = [], isLoading: tradesLoading } = useClosedTrades();

  // Calculate equity curve from portfolio history (group by week)
  const equityData = useMemo(() => {
    if (portfolioHistory.length === 0) return [];
    
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
    
    return Object.entries(weeklyData).map(([date, value], index) => ({
      date: `Week ${index + 1}`,
      value,
      fullDate: date,
    }));
  }, [portfolioHistory]);

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

  if (portfolioLoading || tradesLoading) {
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
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
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
