import { Card, CardContent } from "@/components/ui/card";
import { useMemo } from "react";
import { Activity, DollarSign, LineChart, Trophy, Wallet } from "lucide-react";
import { useTradeEngineConnection } from "@/hooks/use-trade-engine";
import { cn } from "@/lib/utils";
import type { OpenPosition, PortfolioHistory, Trade } from "@/types/database";

interface PaperTradingOverviewProps {
  positions: OpenPosition[];
  trades: Trade[];
  portfolioHistory: PortfolioHistory[];
  isLoading?: boolean;
}

function formatCurrency(value: number) {
  const absoluteValue = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${value < 0 ? '-' : ''}$${absoluteValue}`;
}

export function PaperTradingOverview({
  positions,
  trades,
  portfolioHistory,
  isLoading = false,
}: PaperTradingOverviewProps) {
  const { isConnected } = useTradeEngineConnection();

  const summary = useMemo(() => {
    const markedPositions = positions.map((position) => {
      const snapshotPrice = position.current_price ?? position.entry_price;
      return {
        ...position,
        markedPrice: snapshotPrice,
        marketValue: snapshotPrice * position.quantity,
        unrealizedPnL: (snapshotPrice - position.entry_price) * position.quantity,
      };
    });

    const marketValue = markedPositions.reduce((sum, position) => sum + position.marketValue, 0);
    const unrealizedPnL = markedPositions.reduce((sum, position) => sum + position.unrealizedPnL, 0);
    const realizedPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    const totalReturn = unrealizedPnL + realizedPnL;
    const accountValue = portfolioHistory[portfolioHistory.length - 1]?.value ?? marketValue;
    const openCostBasis = positions.reduce((sum, position) => sum + position.entry_price * position.quantity, 0);
    const closedTradeCostBasis = trades.reduce((sum, trade) => sum + trade.entry_price * trade.quantity, 0);
    const fallbackBaseValue = openCostBasis + closedTradeCostBasis;
    const baseValue = portfolioHistory[0]?.value ?? fallbackBaseValue;
    const totalReturnPct = baseValue > 0 ? (totalReturn / baseValue) * 100 : 0;
    const wins = trades.filter((trade) => (trade.pnl || 0) > 0).length;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    return {
      marketValue,
      accountValue,
      unrealizedPnL,
      realizedPnL,
      totalReturn,
      totalReturnPct,
      openPositions: positions.length,
      winRate,
      tradesCount: trades.length,
      hasSnapshotPrices: markedPositions.some((position) => position.current_price !== null && position.current_price !== undefined),
    };
  }, [portfolioHistory, positions, trades]);

  const cards = [
    {
      label: 'Portfolio Value',
      value: formatCurrency(summary.accountValue),
      helper: summary.hasSnapshotPrices ? 'Account value with live marks' : 'Account value using journal prices',
      icon: Wallet,
    },
    {
      label: 'Total Return',
      value: formatCurrency(summary.totalReturn),
      helper: `${summary.totalReturnPct >= 0 ? '+' : ''}${summary.totalReturnPct.toFixed(2)}% vs funded capital`,
      icon: LineChart,
      accent: summary.totalReturn >= 0 ? 'text-profit' : 'text-loss',
    },
    {
      label: 'P&L Split',
      value: `${formatCurrency(summary.realizedPnL)} / ${formatCurrency(summary.unrealizedPnL)}`,
      helper: 'Realized / Unrealized',
      icon: Activity,
    },
    {
      label: 'Execution Score',
      value: summary.tradesCount > 0 ? `${summary.winRate.toFixed(0)}% win rate` : `${summary.openPositions} open positions`,
      helper: summary.tradesCount > 0 ? `${summary.tradesCount} closed trades recorded` : 'No completed trades yet',
      icon: Trophy,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((index) => (
          <Card key={index} className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="h-28 animate-pulse" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="pt-4 pb-3 space-y-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span>{card.label}</span>
              </div>
              <div className={cn('text-xl font-bold leading-tight', card.accent)}>{card.value}</div>
              <div className="text-xs text-muted-foreground/60">{card.helper}</div>
            </CardContent>
          </Card>
        );
      })}
      <Card className="border-border/50 bg-card/60 backdrop-blur-sm md:col-span-2 xl:col-span-4">
        <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            <span>
              One workspace now anchors the account snapshot, execution flow, and review panels so the page reads as a portfolio cockpit instead of separate widgets.
            </span>
          </div>
          <div className={cn(
            'font-medium',
            isConnected ? 'text-profit' : 'text-muted-foreground'
          )}>
            {isConnected ? 'Live feed connected' : summary.hasSnapshotPrices ? 'Prices from latest snapshots' : 'Using entry prices'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
