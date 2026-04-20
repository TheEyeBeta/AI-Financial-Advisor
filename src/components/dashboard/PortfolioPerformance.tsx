import { TrendingUp, TrendingDown, LineChart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOpenPositions, usePortfolioHistory, useTrades } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { OpenPosition, PortfolioHistory } from "@/types/database";

interface PortfolioPerformanceProps {
  portfolioHistory?: PortfolioHistory[];
  openPositions?: OpenPosition[];
  isLoading?: boolean;
}

export function PortfolioPerformance({
  portfolioHistory: portfolioHistoryProp,
  openPositions: openPositionsProp,
  isLoading: isLoadingProp,
}: PortfolioPerformanceProps = {}) {
  const { data: fallbackPortfolioHistory = [], isLoading: isPortfolioHistoryLoading } = usePortfolioHistory();
  const { data: fallbackOpenPositions = [], isLoading: isOpenPositionsLoading } = useOpenPositions();
  const navigate = useNavigate();
  const { data: allTrades = [] } = useTrades();
  const closedTrades = allTrades
    .filter(t => t.action === 'CLOSED' && t.pnl !== null)
    .map(t => ({
      label: t.symbol,
      pnl: t.pnl as number,
      date: t.exit_date,
      entry_date: t.entry_date,
      exit_date: t.exit_date,
    }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const portfolioHistory = portfolioHistoryProp ?? fallbackPortfolioHistory;
  const openPositions = openPositionsProp ?? fallbackOpenPositions;
  const isLoading = isLoadingProp ?? (isPortfolioHistoryLoading || isOpenPositionsLoading);

  // Transform data for chart (group by month and format)
  const portfolioData = portfolioHistory.map((entry) => ({
    date: format(parseISO(entry.date), "MMM dd"),
    value: entry.value,
    fullDate: entry.date,
  })).sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());

  const openPositionsValue = openPositions.reduce(
    (sum, position) => sum + ((position.current_price || position.entry_price) * position.quantity),
    0
  );

  const fallbackData = openPositionsValue > 0
    ? [{
        date: "Now",
        value: openPositionsValue,
        fullDate: new Date().toISOString(),
      }]
    : [];

  const displayData = portfolioData.length > 0 ? portfolioData : fallbackData;

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="h-8 w-32 bg-muted/50 rounded animate-pulse" />
              <div className="h-4 w-24 bg-muted/30 rounded mt-2 animate-pulse" />
            </div>
          </div>
          <div className="h-[200px] bg-muted/20 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (displayData.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="py-10 text-center">
          <LineChart className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No portfolio history yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 mb-4">
            Open a position to start tracking your portfolio performance
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/paper-trading')}
          >
            Start Trading
          </Button>
        </CardContent>
      </Card>
    );
  }

  const currentValue = displayData[displayData.length - 1].value;
  const startValue = displayData[0].value;
  const totalReturn = currentValue - startValue;
  const percentReturn = ((totalReturn / startValue) * 100).toFixed(2);
  const isPositive = totalReturn >= 0;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <CardContent className="pt-5 pb-4">
        {/* Value Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-1">Portfolio Performance</p>
            <span className="text-3xl font-bold tracking-tight">
              ${currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground/60">
                {totalReturn >= 0 ? "+" : ""}${totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2 })} all time
              </span>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${
            isPositive
              ? "bg-profit/10 text-profit"
              : "bg-loss/10 text-loss"
          }`}>
            {isPositive ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            <span>{isPositive ? "+" : ""}{percentReturn}%</span>
          </div>
        </div>

        {/* Chart */}
        <div className="h-[200px] w-full -mx-2">
          {closedTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">Close your first trade to see performance</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={closedTrades}>
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground) / 0.3)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground) / 0.3)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={55}
                  tickFormatter={(v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border) / 0.5)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelFormatter={(label) => label}
                  formatter={(value: number, _name: string, props: { payload?: { entry_date?: string | null; exit_date?: string | null } }) => {
                    const entry = props.payload;
                    const entryDate = entry?.entry_date ? format(parseISO(entry.entry_date), "MMM d, yyyy") : '—';
                    const exitDate = entry?.exit_date ? format(parseISO(entry.exit_date), "MMM d, yyyy") : '—';
                    return [
                      `${value >= 0 ? '+' : ''}$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                      `${entryDate} → ${exitDate}`,
                    ];
                  }}
                />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {closedTrades.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.pnl >= 0 ? '#1D9E75' : '#E24B4A'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
