import { useState } from "react";
import {
  Trophy,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout/AppLayout";
import { useTopStocks } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import type { StockScore } from "@/services/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreBadge(score: number) {
  if (score >= 70) return "bg-profit/10 text-profit border-profit/30";
  if (score >= 50) return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
  return "bg-destructive/10 text-destructive border-destructive/30";
}

function scoreBar(score: number) {
  if (score >= 70) return "bg-profit";
  if (score >= 50) return "bg-yellow-500";
  return "bg-destructive";
}

function fmtPct(val: number | null, decimals = 1): string {
  if (val === null) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}%`;
}

function fmtPrice(val: number | null): string {
  if (val === null) return "—";
  return `$${val.toFixed(2)}`;
}

function fmtMult(val: number | null, decimals = 2): string {
  if (val === null) return "—";
  return val.toFixed(decimals) + "×";
}

// ── Score Bar Component ───────────────────────────────────────────────────────

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium", score >= 70 ? "text-profit" : score >= 50 ? "text-yellow-500" : "text-destructive")}>
          {score.toFixed(0)}
        </span>
      </div>
      <div className="relative h-1 rounded-full bg-muted/50">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", scoreBar(score))}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <div className="text-[9px] text-muted-foreground/50">{weight}</div>
    </div>
  );
}

// ── Breakdown Row ─────────────────────────────────────────────────────────────

function BreakdownRow({ stock }: { stock: StockScore }) {
  const b = stock.breakdown;
  const items: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "RSI (14)",
      value: b.rsi_14 !== null ? b.rsi_14.toFixed(1) : "—",
      positive: b.rsi_14 !== null && b.rsi_14 >= 50 && b.rsi_14 <= 70,
    },
    {
      label: "MACD",
      value: b.macd_above_signal === null ? "—" : b.macd_above_signal ? "Above signal" : "Below signal",
      positive: b.macd_above_signal === true,
    },
    {
      label: "Golden cross",
      value: b.golden_cross === null ? "—" : b.golden_cross ? "Yes (SMA50>SMA200)" : "No",
      positive: b.golden_cross === true,
    },
    {
      label: "Volume ratio",
      value: b.volume_ratio !== null ? fmtMult(b.volume_ratio) : "—",
      positive: b.volume_ratio !== null && b.volume_ratio > 1,
    },
    {
      label: "P/E ratio",
      value: b.pe_ratio !== null ? b.pe_ratio.toFixed(1) + "×" : "—",
      positive: b.pe_ratio !== null && b.pe_ratio > 0 && b.pe_ratio < 25,
    },
    {
      label: "EPS growth",
      value: fmtPct(b.eps_growth !== null ? b.eps_growth * 100 : null),
      positive: b.eps_growth !== null && b.eps_growth > 0,
    },
    {
      label: "Revenue growth",
      value: fmtPct(b.revenue_growth !== null ? b.revenue_growth * 100 : null),
      positive: b.revenue_growth !== null && b.revenue_growth > 0,
    },
    {
      label: "Signal",
      value:
        b.signal_confidence === null
          ? "—"
          : `${(b.signal_confidence * 100).toFixed(0)}% ${b.is_bullish ? "bullish" : "bearish"}`,
      positive: b.is_bullish === true,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/50">
      {items.map(({ label, value, positive }) => (
        <div key={label} className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground">{label}</p>
          <p
            className={cn(
              "text-xs font-medium",
              value === "—"
                ? "text-muted-foreground/50"
                : positive
                ? "text-profit"
                : "text-destructive"
            )}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Stock Card ────────────────────────────────────────────────────────────────

function StockCard({ stock, rank }: { stock: StockScore; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const pctColor =
    stock.price_change_pct === null
      ? "text-muted-foreground"
      : stock.price_change_pct >= 0
      ? "text-profit"
      : "text-loss";
  const PctIcon =
    stock.price_change_pct !== null && stock.price_change_pct >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card
      className={cn(
        "border-border/50 bg-card/50 backdrop-blur-sm transition-all animate-in fade-in duration-300",
        !stock.data_fresh && "opacity-70"
      )}
    >
      <CardContent className="pt-4 pb-3 px-4">
        {/* Top row: rank + ticker + composite */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-muted-foreground/60 tabular-nums w-5 shrink-0">
              #{rank}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground">{stock.ticker}</span>
                {!stock.data_fresh && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-yellow-500/40 text-yellow-500">
                    STALE
                  </Badge>
                )}
              </div>
              {stock.company_name && (
                <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                  {stock.company_name}
                </p>
              )}
            </div>
          </div>

          {/* Composite score badge */}
          <Badge
            variant="outline"
            className={cn("text-sm font-bold px-2.5 py-1 h-auto shrink-0", scoreBadge(stock.composite_score))}
          >
            {stock.composite_score.toFixed(0)}
          </Badge>
        </div>

        {/* Price row */}
        <div className="flex items-center gap-3 mt-2">
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {fmtPrice(stock.last_price)}
          </span>
          <div className={cn("flex items-center gap-0.5 text-xs font-medium", pctColor)}>
            <PctIcon className="h-3 w-3" />
            {fmtPct(stock.price_change_pct)}
          </div>
        </div>

        {/* Composite score bar */}
        <div className="mt-3 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground font-medium">Composite</span>
            <span className={cn("font-semibold", stock.composite_score >= 70 ? "text-profit" : stock.composite_score >= 50 ? "text-yellow-500" : "text-destructive")}>
              {stock.composite_score.toFixed(1)} / 100
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50">
            <div
              className={cn("h-full rounded-full transition-all", scoreBar(stock.composite_score))}
              style={{ width: `${Math.min(100, stock.composite_score)}%` }}
            />
          </div>
        </div>

        {/* Dimension scores */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          <ScoreBar label="Momentum" score={stock.momentum_score} weight="25%" />
          <ScoreBar label="Technical" score={stock.technical_score} weight="30%" />
          <ScoreBar label="Fundamental" score={stock.fundamental_score} weight="25%" />
          <ScoreBar
            label={stock.has_ml_data ? "ML Signal" : "ML Signal (–)"}
            score={stock.ml_score ?? 50}
            weight={stock.has_ml_data ? "20%" : "redistributed"}
          />
        </div>

        {/* Expand/collapse breakdown */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 h-6 text-[11px] text-muted-foreground gap-1 hover:text-foreground"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide details" : "Show details"}
        </Button>

        {expanded && <BreakdownRow stock={stock} />}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const LIMIT_OPTIONS = [20, 50, 100] as const;
const MIN_SCORE_OPTIONS = [0, 40, 60] as const;

const TopStocks = () => {
  const [limit, setLimit] = useState<number>(20);
  const [minScore, setMinScore] = useState<number>(0);

  const { data, isLoading, error, refetch, isRefetching } = useTopStocks(limit, minScore);

  const stocks = data?.stocks ?? [];
  const hasStaleData = data?.hasStaleData ?? false;
  const hasMlData = data?.hasMlData ?? false;
  const totalScored = data?.totalScored ?? 0;

  return (
    <AppLayout title="Top Stocks">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Top Stocks</h1>
              <p className="text-sm text-muted-foreground">
                Composite ranking across momentum, technical, fundamental &amp; ML signals
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Limit toggle */}
            <div className="flex rounded-lg border border-border/50 p-1 bg-muted/30">
              {LIMIT_OPTIONS.map(n => (
                <Button
                  key={n}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs rounded-md transition-all",
                    limit === n && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                  onClick={() => setLimit(n)}
                >
                  Top {n}
                </Button>
              ))}
            </div>

            {/* Min score toggle */}
            <div className="flex rounded-lg border border-border/50 p-1 bg-muted/30">
              {MIN_SCORE_OPTIONS.map(s => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs rounded-md transition-all",
                    minScore === s && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                  onClick={() => setMinScore(s)}
                >
                  {s === 0 ? "All" : `≥${s}`}
                </Button>
              ))}
            </div>

            {/* Refresh */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
            >
              <RefreshCw className={cn("h-3 w-3", (isLoading || isRefetching) && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Info bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground animate-in fade-in duration-300">
          {!isLoading && totalScored > 0 && (
            <span>
              Showing <span className="text-foreground font-medium">{stocks.length}</span> of{" "}
              <span className="text-foreground font-medium">{totalScored}</span> ranked stocks
            </span>
          )}

          {hasStaleData && (
            <Badge
              variant="outline"
              className="gap-1 text-[10px] border-yellow-500/40 text-yellow-500"
            >
              <AlertTriangle className="h-3 w-3" />
              Some data may be stale (&gt;24h)
            </Badge>
          )}

          {!isLoading && !hasMlData && stocks.length > 0 && (
            <Badge
              variant="outline"
              className="gap-1 text-[10px] border-muted-foreground/30 text-muted-foreground"
            >
              <Info className="h-3 w-3" />
              ML signals unavailable — weight redistributed
            </Badge>
          )}
        </div>

        {/* Scoring methodology note */}
        <div className="text-[11px] text-muted-foreground/60 space-x-3 animate-in fade-in duration-300">
          <span>Scores 0–100 (min-max normalized across universe).</span>
          <span>Not financial advice. Past signals do not guarantee future results.</span>
        </div>

        {/* Content */}
        {error ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300">
            <CardContent className="py-12 text-center">
              <div className="p-3 rounded-full bg-destructive/10 mx-auto mb-4 w-fit">
                <Trophy className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-destructive font-medium">Error loading stock rankings</p>
              <p className="text-xs text-muted-foreground mt-2 max-w-sm mx-auto">
                {error instanceof Error ? error.message : "Failed to fetch stock data."}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="border-border/50 bg-card/50">
                <CardContent className="pt-4 pb-3 px-4 space-y-3">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-6 w-12 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                  <div className="grid grid-cols-2 gap-2">
                    {[...Array(4)].map((_, j) => (
                      <Skeleton key={j} className="h-8 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300">
            <CardContent className="py-12 text-center">
              <div className="p-3 rounded-full bg-muted mx-auto mb-4 w-fit">
                <Trophy className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No stocks match the current filters</p>
              <p className="text-xs text-muted-foreground mt-2">
                {minScore > 0
                  ? `Try lowering the minimum score threshold (currently ≥${minScore}).`
                  : "No stock data is available. Make sure the Trade Engine is running."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {stocks.map((stock, index) => (
              <StockCard key={stock.ticker} stock={stock} rank={index + 1} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default TopStocks;
