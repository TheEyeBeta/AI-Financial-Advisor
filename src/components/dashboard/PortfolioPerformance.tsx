import { TrendingUp, TrendingDown, LineChart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOpenPositions, usePortfolioHistory } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PortfolioPerformance() {
  const { data: portfolioHistory = [], isLoading } = usePortfolioHistory();
  const { data: openPositions = [] } = useOpenPositions();
  const navigate = useNavigate();

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
            <span className="text-3xl font-bold tracking-tight">${currentValue.toLocaleString()}</span>
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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? "hsl(var(--profit))" : "hsl(var(--loss))"} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={isPositive ? "hsl(var(--profit))" : "hsl(var(--loss))"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
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
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border) / 0.5)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={isPositive ? "hsl(var(--profit))" : "hsl(var(--loss))"}
                strokeWidth={2}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
