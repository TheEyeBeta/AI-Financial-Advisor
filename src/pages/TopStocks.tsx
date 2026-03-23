import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Lock,
  RefreshCw,
  Shield,
  Star,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTopStocks } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import type { StockScore, Horizon } from "@/services/stock-ranking-api";

const EMPTY_VALUE = "-";

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreBadge(score: number) {
  if (score >= 70) return "border-profit/30 bg-profit/10 text-profit";
  if (score >= 50) return "border-yellow-500/30 bg-yellow-500/10 text-yellow-500";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

function scoreBar(score: number) {
  if (score >= 70) return "bg-profit";
  if (score >= 50) return "bg-yellow-500";
  return "bg-destructive";
}

function tierBadge(tier: string) {
  switch (tier) {
    case "Strong Buy":
      return "border-profit/40 bg-profit/15 text-profit";
    case "Buy":
      return "border-profit/25 bg-profit/10 text-profit";
    case "Hold":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-500";
    case "Underperform":
      return "border-orange-500/30 bg-orange-500/10 text-orange-500";
    case "Sell":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function convictionBadge(conviction: string) {
  switch (conviction) {
    case "High":
      return "border-profit/25 bg-profit/10 text-profit";
    case "Medium":
      return "border-yellow-500/25 bg-yellow-500/10 text-yellow-500";
    default:
      return "border-border/50 bg-muted/50 text-muted-foreground";
  }
}

function stabilityLabel(cycles: number): { text: string; className: string } | null {
  if (cycles < 3) return null;
  if (cycles >= 18) {
    return { text: "Stable 3h+", className: "border-profit/30 bg-profit/10 text-profit" };
  }
  if (cycles >= 6) {
    return {
      text: `Stable ${Math.round((cycles * 10) / 60)}h+`,
      className: "border-profit/25 bg-profit/5 text-profit/80",
    };
  }
  return {
    text: "Holding",
    className: "border-border/50 bg-muted/30 text-muted-foreground",
  };
}

function fmtPct(value: number | null, decimals = 1): string {
  if (value === null) return EMPTY_VALUE;
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null) return EMPTY_VALUE;
  return `$${value.toFixed(2)}`;
}

function fmtMult(value: number | null, decimals = 2): string {
  if (value === null) return EMPTY_VALUE;
  return `${value.toFixed(decimals)}x`;
}

function fmtNum(value: number | null, decimals = 1): string {
  if (value === null) return EMPTY_VALUE;
  return value.toFixed(decimals);
}

function fmtCap(value: number | null): string {
  if (value === null) return EMPTY_VALUE;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

// ── Dimension weights per horizon (must match backend) ────────────────────────

const HORIZON_WEIGHTS: Record<
  Horizon,
  {
    momentum: string;
    technical: string;
    fundamental: string;
    risk: string;
    quality: string;
    ml: string;
  }
> = {
  short: {
    momentum: "25%",
    technical: "28%",
    fundamental: "7%",
    risk: "10%",
    quality: "5%",
    ml: "25%",
  },
  long: {
    momentum: "7%",
    technical: "8%",
    fundamental: "35%",
    risk: "15%",
    quality: "22%",
    ml: "13%",
  },
  balanced: {
    momentum: "15%",
    technical: "20%",
    fundamental: "25%",
    risk: "12%",
    quality: "10%",
    ml: "18%",
  },
};

const HORIZON_LABELS: Record<Horizon, { label: string; description: string }> = {
  short: {
    label: "Short-term",
    description: "Swing trading over days to weeks with more weight on momentum, technicals, and ML signals.",
  },
  long: {
    label: "Long-term",
    description: "Buy-and-hold ranking for months to years with more weight on fundamentals, quality, and risk.",
  },
  balanced: {
    label: "Balanced",
    description: "Middle-ground ranking for position trades with a more even blend across all dimensions.",
  },
};

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-border/60 bg-background/70 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ── Score Bar Component ───────────────────────────────────────────────────────

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: string }) {
  return (
    <div className="rounded-[16px] border border-border/60 bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-foreground/80">{label}</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            score >= 70
              ? "text-profit"
              : score >= 50
                ? "text-yellow-500"
                : "text-destructive",
          )}
        >
          {score.toFixed(0)}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-muted/60">
        <div
          className={cn("h-full rounded-full transition-all", scoreBar(score))}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">{weight}</p>
    </div>
  );
}

// ── Breakdown Section ─────────────────────────────────────────────────────────

function BreakdownRow({ stock }: { stock: StockScore }) {
  const b = stock.breakdown;

  const technicalItems: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "RSI (14)",
      value: b.rsi_14 !== null ? b.rsi_14.toFixed(1) : "—",
      positive: b.rsi_14 !== null && b.rsi_14 >= 40 && b.rsi_14 <= 70,
    },
    {
      label: "RSI (9)",
      value: b.rsi_9 !== null ? b.rsi_9.toFixed(1) : "—",
      positive: b.rsi_9 !== null && b.rsi_9 >= 40 && b.rsi_9 <= 70,
    },
    {
      label: "MACD",
      value: b.macd_above_signal === null ? "—" : b.macd_above_signal ? "Above signal" : "Below signal",
      positive: b.macd_above_signal === true,
    },
    {
      label: "MACD Hist.",
      value: b.macd_histogram !== null ? fmtNum(b.macd_histogram, 3) : "—",
      positive: b.macd_histogram !== null && b.macd_histogram > 0,
    },
    {
      label: "Golden Cross",
      value: b.golden_cross === null ? "—" : b.golden_cross ? "Yes (SMA50>200)" : "No",
      positive: b.golden_cross === true,
    },
    {
      label: "ADX",
      value: b.adx !== null ? fmtNum(b.adx) : "—",
      positive: b.adx !== null && b.adx >= 25,
    },
    {
      label: "Stochastic K/D",
      value:
        b.stochastic_k !== null && b.stochastic_d !== null
          ? `${fmtNum(b.stochastic_k)}/${fmtNum(b.stochastic_d)}`
          : "—",
      positive: b.stochastic_k !== null && b.stochastic_k > (b.stochastic_d ?? 0) && b.stochastic_k < 80,
    },
    {
      label: "Williams %R",
      value: b.williams_r !== null ? fmtNum(b.williams_r) : "—",
      positive: b.williams_r !== null && b.williams_r > -80 && b.williams_r < -20,
    },
    {
      label: "CCI",
      value: b.cci !== null ? fmtNum(b.cci) : "—",
      positive: b.cci !== null && b.cci > 0 && b.cci < 200,
    },
    {
      label: "BB Position",
      value: b.bollinger_position !== null ? `${(b.bollinger_position * 100).toFixed(0)}%` : "—",
      positive: b.bollinger_position !== null && b.bollinger_position >= 0.4 && b.bollinger_position <= 0.8,
    },
  ];

  const momentumItems: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "Volume ratio",
      value: b.volume_ratio !== null ? fmtMult(b.volume_ratio) : "—",
      positive: b.volume_ratio !== null && b.volume_ratio > 1,
    },
    {
      label: "vs SMA 50",
      value: b.price_vs_sma_50 !== null ? fmtPct(b.price_vs_sma_50 * 100) : "—",
      positive: b.price_vs_sma_50 !== null && b.price_vs_sma_50 > 0,
    },
    {
      label: "vs SMA 200",
      value: b.price_vs_sma_200 !== null ? fmtPct(b.price_vs_sma_200 * 100) : "—",
      positive: b.price_vs_sma_200 !== null && b.price_vs_sma_200 > 0,
    },
    {
      label: "52W Position",
      value: b.fifty_two_week_position !== null ? `${(b.fifty_two_week_position * 100).toFixed(0)}%` : "—",
      positive: b.fifty_two_week_position !== null && b.fifty_two_week_position >= 0.3 && b.fifty_two_week_position <= 0.85,
    },
  ];

  const fundamentalItems: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "P/E",
      value: b.pe_ratio !== null ? fmtMult(b.pe_ratio, 1) : "—",
      positive: b.pe_ratio !== null && b.pe_ratio > 0 && b.pe_ratio < 25,
    },
    {
      label: "Fwd P/E",
      value: b.forward_pe !== null ? fmtMult(b.forward_pe, 1) : "—",
      positive: b.forward_pe !== null && b.forward_pe > 0 && b.forward_pe < 20,
    },
    {
      label: "PEG",
      value: b.peg_ratio !== null ? fmtMult(b.peg_ratio, 2) : "—",
      positive: b.peg_ratio !== null && b.peg_ratio > 0 && b.peg_ratio < 1.5,
    },
    {
      label: "P/B",
      value: b.price_to_book !== null ? fmtMult(b.price_to_book, 1) : "—",
      positive: b.price_to_book !== null && b.price_to_book > 0 && b.price_to_book < 5,
    },
    {
      label: "P/S",
      value: b.price_to_sales !== null ? fmtMult(b.price_to_sales, 1) : "—",
      positive: b.price_to_sales !== null && b.price_to_sales > 0 && b.price_to_sales < 5,
    },
    {
      label: "EPS",
      value: b.eps !== null ? `$${b.eps.toFixed(2)}` : "—",
      positive: b.eps !== null && b.eps > 0,
    },
    {
      label: "EPS Growth",
      value: fmtPct(b.eps_growth !== null ? b.eps_growth * 100 : null),
      positive: b.eps_growth !== null && b.eps_growth > 0,
    },
    {
      label: "Rev. Growth",
      value: fmtPct(b.revenue_growth !== null ? b.revenue_growth * 100 : null),
      positive: b.revenue_growth !== null && b.revenue_growth > 0,
    },
    {
      label: "Div. Yield",
      value: b.dividend_yield !== null ? fmtPct(b.dividend_yield * 100) : "—",
      positive: b.dividend_yield !== null && b.dividend_yield > 0.01,
    },
    {
      label: "Mkt Cap",
      value: fmtCap(b.market_cap),
      positive: b.market_cap !== null && b.market_cap >= 10e9,
    },
  ];

  const signalItems: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "Signal",
      value:
        b.signal_confidence === null
          ? "—"
          : `${(b.signal_confidence * 100).toFixed(0)}% ${b.is_bullish ? "bullish" : "bearish"}`,
      positive: b.is_bullish === true,
    },
    {
      label: "Strategy",
      value: b.signal_strategy ?? "—",
      positive: b.signal_strategy !== null,
    },
  ];

  const renderSection = (
    title: string,
    items: { label: string; value: string; positive?: boolean }[],
  ) => (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(({ label, value, positive }) => (
          <div
            key={label}
            className="rounded-[14px] border border-border/50 bg-card/60 px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </p>
            <p
              className={cn(
                "mt-1 text-sm font-semibold tabular-nums",
                value === "—"
                  ? "text-muted-foreground/50"
                  : positive
                    ? "text-profit"
                    : "text-destructive",
              )}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mt-4 rounded-[18px] border border-border/60 bg-background/70 p-4">
      <div className="space-y-4 border-t border-border/50 pt-4">
        {renderSection("Technical Indicators", technicalItems)}
        {renderSection("Momentum", momentumItems)}
        {renderSection("Fundamentals & Valuation", fundamentalItems)}
        {signalItems.some((item) => item.value !== "—") &&
          renderSection("ML / Signals", signalItems)}
      </div>
    </div>
  );
}

// ── Stock Card ────────────────────────────────────────────────────────────────

function StockCard({ stock, rank, horizon }: { stock: StockScore; rank: number; horizon: Horizon }) {
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
        "group overflow-hidden rounded-[22px] border border-border/60 bg-card/90 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.55)] transition-all duration-200 hover:border-primary/25 hover:bg-card animate-in fade-in duration-300",
        !stock.data_fresh && "opacity-80"
      )}
    >
      <CardContent className="p-5">
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

          {/* Smoothed composite score badge */}
          <Badge
            variant="outline"
            className={cn("text-sm font-bold px-2.5 py-1 h-auto shrink-0", scoreBadge(stock.smoothed_score))}
          >
            {stock.smoothed_score.toFixed(0)}
          </Badge>
        </div>

        {/* Tier + Conviction row */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <Badge
            variant="outline"
            className={cn("text-[9px] px-1.5 py-0 h-4 font-semibold", tierBadge(stock.rank_tier))}
          >
            {stock.rank_tier}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-[9px] px-1.5 py-0 h-4 gap-0.5", convictionBadge(stock.conviction))}
          >
            {stock.conviction === "High" && <Star className="h-2.5 w-2.5" />}
            {stock.conviction === "Medium" && <Shield className="h-2.5 w-2.5" />}
            {stock.conviction} conviction
          </Badge>
          {(() => {
            const stability = stabilityLabel(stock.tier_held_cycles);
            if (!stability) return null;
            return (
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 gap-0.5", stability.className)}>
                <Lock className="h-2 w-2" />
                {stability.text}
              </Badge>
            );
          })()}
          <span className="text-[9px] text-muted-foreground/50">
            {stock.dimensions_bullish}/{stock.has_ml_data ? 6 : 5} bullish
          </span>
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

        {/* Smoothed composite score bar */}
        <div className="mt-3 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground font-medium">Composite</span>
            <span className={cn("font-semibold", stock.smoothed_score >= 70 ? "text-profit" : stock.smoothed_score >= 50 ? "text-yellow-500" : "text-destructive")}>
              {stock.smoothed_score.toFixed(1)} / 100
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50">
            <div
              className={cn("h-full rounded-full transition-all", scoreBar(stock.smoothed_score))}
              style={{ width: `${Math.min(100, stock.smoothed_score)}%` }}
            />
          </div>
        </div>

        {/* Dimension scores — 6 dimensions in 3×2 grid with horizon-aware weights */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(() => { const hw = HORIZON_WEIGHTS[horizon]; return (<>
            <ScoreBar label="Momentum" score={stock.momentum_score} weight={hw.momentum} />
            <ScoreBar label="Technical" score={stock.technical_score} weight={hw.technical} />
            <ScoreBar label="Fundamental" score={stock.fundamental_score} weight={hw.fundamental} />
            <ScoreBar label="Risk-Adj." score={stock.risk_score} weight={hw.risk} />
            <ScoreBar label="Quality" score={stock.quality_score} weight={hw.quality} />
            <ScoreBar
              label={stock.has_ml_data ? "ML Signal" : "ML Signal (-)"}
              score={stock.ml_score ?? 50}
              weight={stock.has_ml_data ? hw.ml : "redistributed"}
            />
          </>); })()}
        </div>

        {/* Expand/collapse breakdown */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 h-10 rounded-full border border-border/70 bg-background/70 px-4 text-xs font-medium text-muted-foreground gap-1 hover:bg-background hover:text-foreground"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
const HORIZON_OPTIONS: Horizon[] = ["short", "balanced", "long"];

const TopStocks = () => {
  const [limit, setLimit] = useState<number>(20);
  const [minScore, setMinScore] = useState<number>(0);
  const [horizon, setHorizon] = useState<Horizon>("balanced");

  const { data, isLoading, error, refetch, isRefetching } = useTopStocks(limit, minScore, horizon);

  const stocks = data?.stocks ?? [];
  const hasStaleData = data?.hasStaleData ?? false;
  const hasMlData = data?.hasMlData ?? false;
  const totalScored = data?.totalScored ?? 0;

  return (
    <AppLayout title="Top Stocks">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[24px] border border-border/60 bg-card/95 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.28)] animate-in fade-in duration-300">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" />
              Top Stocks
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Scan the market leaders faster.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Review ranked names, tighten the score filter, and shift time horizon from one clean surface.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              className="h-10 rounded-full px-4"
            >
              <RefreshCw className={cn("h-4 w-4", (isLoading || isRefetching) && "animate-spin")} />
              Refresh rankings
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <FilterGroup label="Show ranked set">
            {LIMIT_OPTIONS.map((n) => (
              <Button
                key={n}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 rounded-full px-4 text-xs font-medium transition-all",
                  limit === n
                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    : "border border-border/60 bg-card/70 text-muted-foreground hover:bg-background hover:text-foreground",
                )}
                onClick={() => setLimit(n)}
              >
                Top {n}
              </Button>
            ))}
          </FilterGroup>

          <FilterGroup label="Minimum score">
            {MIN_SCORE_OPTIONS.map((s) => (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 rounded-full px-4 text-xs font-medium transition-all",
                  minScore === s
                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    : "border border-border/60 bg-card/70 text-muted-foreground hover:bg-background hover:text-foreground",
                )}
                onClick={() => setMinScore(s)}
              >
                {s === 0 ? "All" : `>= ${s}`}
              </Button>
            ))}
          </FilterGroup>

          <FilterGroup label="Time horizon">
            {HORIZON_OPTIONS.map((h) => (
              <Button
                key={h}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 rounded-full px-4 text-xs font-medium transition-all",
                  horizon === h
                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    : "border border-border/60 bg-card/70 text-muted-foreground hover:bg-background hover:text-foreground",
                )}
                onClick={() => setHorizon(h)}
                title={HORIZON_LABELS[h].description}
              >
                {HORIZON_LABELS[h].label}
              </Button>
            ))}
          </FilterGroup>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
            <span className="font-semibold text-foreground">{stocks.length}</span> shown
          </div>
          <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
            <span className="font-semibold text-foreground">{totalScored}</span> ranked universe
          </div>
          <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
            <span className="font-semibold text-foreground">
              {minScore === 0 ? "All scores" : `Score >= ${minScore}`}
            </span>
          </div>
          <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
            <span className="font-semibold text-foreground">{HORIZON_LABELS[horizon].label}</span>
          </div>

          {hasStaleData && (
            <Badge
              variant="outline"
              className="h-auto rounded-full border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500"
            >
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              Some data may be stale (&gt;24h)
            </Badge>
          )}

          {!isLoading && !hasMlData && stocks.length > 0 && (
            <Badge
              variant="outline"
              className="h-auto rounded-full border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground"
            >
              <Info className="mr-1 h-3.5 w-3.5" />
              ML signals unavailable - weight redistributed
            </Badge>
          )}
        </div>

        <div className="mt-4 rounded-[20px] border border-border/60 bg-background/70 p-4">
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-medium text-foreground/80">{HORIZON_LABELS[horizon].label}:</span>{" "}
            {HORIZON_LABELS[horizon].description}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground/80">
            6-dimension scoring across 30+ metrics with EMA smoothing and tier hysteresis for more stable rankings. Not financial advice.
          </p>
        </div>
        </section>

        {/* Content */}
        {error ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-destructive/10">
                <Trophy className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Error loading stock rankings</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                {error instanceof Error ? error.message : "Failed to fetch stock data."}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
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
                    {[...Array(6)].map((_, j) => (
                      <Skeleton key={j} className="h-8 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10">
                <Trophy className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">No stocks match the current filters</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                {minScore > 0
                  ? `Try lowering the minimum score threshold. It is currently set to >= ${minScore}.`
                  : "No stock data is available. Make sure the Trade Engine is running."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {stocks.map((stock, index) => (
              <StockCard key={stock.ticker} stock={stock} rank={index + 1} horizon={horizon} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default TopStocks;
