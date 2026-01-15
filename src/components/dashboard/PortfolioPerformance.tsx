import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolioHistory } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";

export function PortfolioPerformance() {
  const { data: portfolioHistory = [], isLoading } = usePortfolioHistory();

  // Transform data for chart (group by month and format)
  const portfolioData = portfolioHistory.map((entry) => ({
    date: format(parseISO(entry.date), "MMM"),
    value: entry.value,
    fullDate: entry.date,
  })).sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());

  if (isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Portfolio Performance</CardTitle>
          <DollarSign className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (portfolioData.length === 0) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Portfolio Performance</CardTitle>
          <DollarSign className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No portfolio data available. Start trading to see your performance!</div>
        </CardContent>
      </Card>
    );
  }

  const currentValue = portfolioData[portfolioData.length - 1].value;
  const startValue = portfolioData[0].value;
  const totalReturn = currentValue - startValue;
  const percentReturn = ((totalReturn / startValue) * 100).toFixed(2);
  const isPositive = totalReturn >= 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Portfolio Performance</CardTitle>
        <DollarSign className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-baseline gap-4">
          <div>
            <span className="text-3xl font-bold">${currentValue.toLocaleString()}</span>
            <span className="ml-2 text-sm text-muted-foreground">Total Value</span>
          </div>
          <div className={`flex items-center gap-1 ${isPositive ? "text-profit" : "text-loss"}`}>
            {isPositive ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span className="font-medium">
              {isPositive ? "+" : ""}${totalReturn.toLocaleString()} ({percentReturn}%)
            </span>
            <span className="text-xs text-muted-foreground">YTD</span>
          </div>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={portfolioData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
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
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, "Value"]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--chart-1))"
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
