import { Card, CardContent } from "@/components/ui/card";
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
import { format, parseISO, startOfWeek } from "date-fns";
import { useMemo } from "react";
import { TrendingUp, TrendingDown, Activity, PieChart as PieChartIcon, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function PerformanceCharts() {
  const { data: portfolioHistory = [], isLoading: portfolioLoading } = usePortfolioHistory();
  const { data: trades = [], isLoading: tradesLoading } = useClosedTrades();
  const { data: positions = [], isLoading: positionsLoading } = useOpenPositions();
  const hasMissingLatestPrice = positions.some((pos) => pos.current_price === null);

  const currentPortfolioValue = useMemo<number | null>(() => {
    if (hasMissingLatestPrice && positions.length > 0) {
      return null;
    }

    return positions.reduce((sum, pos) => {
      return sum + ((pos.current_price as number) * pos.quantity);
    }, 0);
  }, [positions, hasMissingLatestPrice]);

  const totalCostBasis = useMemo(() => {
    return positions.reduce((sum, pos) => sum + (pos.entry_price * pos.quantity), 0);
  }, [positions]);

  // Calculate equity curve
  const equityData = useMemo(() => {
    const data: Array<{ date: string; value: number; fullDate: string; isLive?: boolean }> = [];

    if (portfolioHistory.length > 0) {
      const sorted = [...portfolioHistory].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const weeklyData: Record<string, number> = {};
      sorted.forEach(entry => {
        const date = parseISO(entry.date);
        const weekStart = format(startOfWeek(date), 'MMM d');
        weeklyData[weekStart] = entry.value;
      });

      Object.entries(weeklyData).forEach(([date, value], index) => {
        data.push({ date: `W${index + 1}`, value, fullDate: date });
      });
    }

    if (positions.length > 0 && currentPortfolioValue !== null) {
      data.push({ date: 'Now', value: currentPortfolioValue, fullDate: format(new Date(), 'MMM d'), isLive: true });
    }

    return data;
  }, [portfolioHistory, currentPortfolioValue, positions.length]);

  // Calculate win/loss distribution
  const winLossData = useMemo(() => {
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    const losses = trades.filter(t => (t.pnl || 0) <= 0).length;
    return [
      { name: "Wins", value: wins, fill: "hsl(var(--profit))" },
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
      if (!monthly[month]) monthly[month] = { profit: 0, loss: 0 };
      if (trade.pnl > 0) monthly[month].profit += trade.pnl;
      else monthly[month].loss += trade.pnl;
    });

    return Object.entries(monthly).map(([month, data]) => ({
      month, profit: data.profit, loss: data.loss,
    })).slice(-6);
  }, [trades]);

  // Calculate portfolio stats
  const portfolioStats = useMemo(() => {
    const currentValue = currentPortfolioValue;
    const unrealizedPnL = currentPortfolioValue === null && positions.length > 0
      ? null
      : positions.reduce((sum, pos) => {
          const currentPrice = pos.current_price as number;
          return sum + ((currentPrice - pos.entry_price) * pos.quantity);
        }, 0);
    const realizedPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    const totalReturn = unrealizedPnL === null ? null : unrealizedPnL + realizedPnL;
    const percentReturn = totalReturn === null
      ? null
      : totalCostBasis > 0
        ? ((totalReturn / totalCostBasis) * 100)
        : 0;

    return {
      currentValue,
      totalReturn,
      percentReturn,
      unrealizedPnL,
      realizedPnL,
      totalPnL: totalReturn,
      hasMissingLatestPrice,
    };
  }, [currentPortfolioValue, positions, trades, totalCostBasis, hasMissingLatestPrice]);

  if (portfolioLoading || tradesLoading || positionsLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn("h-48 bg-muted/30 rounded-xl animate-pulse", i <= 2 && "lg:col-span-1", i > 2 && "lg:col-span-1")} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Portfolio Value</span>
            </div>
            <div className="text-2xl font-bold">
              {portfolioStats.currentValue === null
                ? 'N/A'
                : `$${portfolioStats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
            {portfolioStats.totalReturn !== null ? (
              <div className={cn("flex items-center gap-1 text-sm mt-1", portfolioStats.totalReturn >= 0 ? 'text-profit' : 'text-loss')}>
                {portfolioStats.totalReturn >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                <span>
                  {portfolioStats.totalReturn >= 0 ? '+' : ''}${portfolioStats.totalReturn.toFixed(2)} ({(portfolioStats.percentReturn || 0).toFixed(2)}%)
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground/60 mt-1">N/A (latest price unavailable)</div>
            )}
            {positions.length > 0 && !portfolioStats.hasMissingLatestPrice && (
              <div className="text-[10px] text-muted-foreground/50 mt-1">Synced from Supabase snapshots</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">P&amp;L Breakdown</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Realized</span>
                <span className={cn("font-mono font-medium", portfolioStats.realizedPnL >= 0 ? 'text-profit' : 'text-loss')}>
                  {portfolioStats.realizedPnL >= 0 ? '+' : ''}${portfolioStats.realizedPnL.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Unrealized</span>
                {portfolioStats.unrealizedPnL === null ? (
                  <span className="font-mono font-medium text-muted-foreground/60">N/A</span>
                ) : (
                  <span className={cn("font-mono font-medium", portfolioStats.unrealizedPnL >= 0 ? 'text-profit' : 'text-loss')}>
                    {portfolioStats.unrealizedPnL >= 0 ? '+' : ''}${portfolioStats.unrealizedPnL.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex justify-between pt-1.5 border-t border-border/30">
                <span className="font-medium">Total</span>
                {portfolioStats.totalPnL === null ? (
                  <span className="font-mono font-bold text-muted-foreground/60">N/A</span>
                ) : (
                  <span className={cn("font-mono font-bold", portfolioStats.totalPnL >= 0 ? 'text-profit' : 'text-loss')}>
                    {portfolioStats.totalPnL >= 0 ? '+' : ''}${portfolioStats.totalPnL.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equity Curve */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Equity Curve</span>
            {positions.length > 0 && (
              <span className="text-[10px] text-muted-foreground/50">(Live)</span>
            )}
          </div>
          <div className="h-[180px]">
            {equityData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
                Start trading to see your equity curve
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData}>
                  <defs>
                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground) / 0.3)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground) / 0.3)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorEquity)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Win/Loss & Monthly */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <PieChartIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Win/Loss</span>
            </div>
            <div className="h-[140px]">
              {winLossData.every(d => d.value === 0) ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
                  No trades yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={winLossData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2} dataKey="value">
                      {winLossData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "8px", fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            {winLossData.some(d => d.value > 0) && (
              <div className="flex justify-center gap-4 text-[10px] mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-profit" />
                  <span className="text-muted-foreground">Wins ({winLossData[0].value})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-loss" />
                  <span className="text-muted-foreground">Losses ({winLossData[1].value})</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Monthly P&amp;L</span>
            </div>
            <div className="h-[140px]">
              {monthlyData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
                  No monthly data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground) / 0.3)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground) / 0.3)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={35} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "8px", fontSize: "11px" }} />
                    <Bar dataKey="profit" fill="hsl(var(--profit))" radius={[3, 3, 0, 0]} name="Profit" />
                    <Bar dataKey="loss" fill="hsl(var(--loss))" radius={[3, 3, 0, 0]} name="Loss" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
