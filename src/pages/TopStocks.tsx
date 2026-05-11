import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Minus,
  RefreshCw,
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
import { ApiError, getStockDetail } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AnalyticsEvents } from "@/services/analytics";
import type { StockDetail, StockScore } from "@/types/database";

const EMPTY_VALUE = "—";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return EMPTY_VALUE;
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value == null) return EMPTY_VALUE;
  return value.toFixed(decimals);
}

function fmtMktCap(value: number | null | undefined): string {
  if (value == null) return EMPTY_VALUE;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

// Stability score is a 0-100 number. The headline visual is a 10-segment bar
// where filled = primary, empty = muted. We deliberately do NOT colour the bar
// red/green: stability is an objective quality metric, not a directional bet.
function stabilitySegmentCount(score: number | null | undefined): number {
  if (score == null) return 0;
  const clamped = Math.max(0, Math.min(100, score));
  return Math.round(clamped / 10);
}

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

// ── Stability Bar ────────────────────────────────────────────────────────────

function StabilityBar({ score }: { score: number | null | undefined }) {
  const filled = stabilitySegmentCount(score);
  return (
    <div
      role="meter"
      aria-label="Stability score"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score ?? 0}
      className="stability-bar"
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} data-filled={i < filled ? "true" : undefined} />
      ))}
    </div>
  );
}

// ── Detail Cell ──────────────────────────────────────────────────────────────

type CellColor = "positive" | "negative" | "warning" | "neutral";

function DetailCell({
  label,
  value,
  color = "neutral",
}: {
  label: string;
  value: string;
  color?: CellColor;
}) {
  return (
    <div className="rounded-[14px] border border-border/50 bg-card/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          value === EMPTY_VALUE
            ? "text-muted-foreground/50"
            : color === "positive"
              ? "text-profit"
              : color === "negative"
                ? "text-loss"
                : color === "warning"
                  ? "text-yellow-500"
                  : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ── Score dimension bar (used inside expanded details only) ──────────────────

function DimensionBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-[14px] border border-border/50 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-foreground/80">{label}</span>
        <span className="font-semibold tabular-nums text-foreground/80">{score.toFixed(0)}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-muted/60">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
    </div>
  );
}

// ── Breakdown Section (Show details expansion) ───────────────────────────────

function BreakdownRow({
  stock,
  detail,
  detailLoading,
  detailError,
}: {
  stock: StockScore;
  detail: StockDetail | null;
  detailLoading: boolean;
  detailError: boolean;
}) {
  const dayChangeColor: CellColor =
    stock.change_percent == null
      ? "neutral"
      : stock.change_percent >= 0
        ? "positive"
        : "negative";

  const momentumItems: { label: string; value: string; color: CellColor }[] = [
    {
      label: "20D Return",
      value: fmtPct(stock.momentum_20d_pct),
      color:
        stock.momentum_20d_pct == null
          ? "neutral"
          : stock.momentum_20d_pct >= 0
            ? "positive"
            : "negative",
    },
    {
      label: "3M Return",
      value: fmtPct(stock.momentum_3m),
      color:
        stock.momentum_3m == null
          ? "neutral"
          : stock.momentum_3m >= 0
            ? "positive"
            : "negative",
    },
    {
      label: "6M Return",
      value: fmtPct(stock.momentum_6m),
      color:
        stock.momentum_6m == null
          ? "neutral"
          : stock.momentum_6m >= 0
            ? "positive"
            : "negative",
    },
    {
      label: "12M Return",
      value: fmtPct(stock.momentum_12m),
      color:
        stock.momentum_12m == null
          ? "neutral"
          : stock.momentum_12m >= 0
            ? "positive"
            : "negative",
    },
  ];

  const tech = detail?.technicals;
  const fund = detail?.fundamentals;
  const sig = detail?.signals;

  const rsiColor = (v: number | null | undefined): CellColor => {
    if (v == null) return "neutral";
    if (v > 70) return "negative";
    if (v < 30) return "positive";
    return "neutral";
  };

  return (
    <div className="mt-4 rounded-[18px] border border-border/60 bg-background/70 p-4">
      <div className="space-y-4 border-t border-border/50 pt-4">
        {/* 1-day change moves into the detail view per spec — out of the headline. */}
        <div className="grid gap-2 sm:grid-cols-2">
          <DetailCell label="Today" value={fmtPct(stock.change_percent)} color={dayChangeColor} />
          <DetailCell
            label="Volatility (20d)"
            value={
              stock.volatility_20d != null
                ? `${(stock.volatility_20d * 100).toFixed(1)}%`
                : EMPTY_VALUE
            }
          />
        </div>

        {/* Time-normalised return blend */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
            Return blend
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {momentumItems.map(({ label, value, color }) => (
              <DetailCell key={label} label={label} value={value} color={color} />
            ))}
          </div>
        </div>

        {/* Dimension scores belong here, not in the at-a-glance row. */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
            Composite dimensions
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <DimensionBar label="Momentum" score={stock.momentum_score ?? 50} />
            <DimensionBar label="Stability" score={stock.stability_score ?? 50} />
            <DimensionBar label="Technical" score={stock.technical_score ?? 50} />
            <DimensionBar label="Fundamental" score={stock.fundamental_score ?? 50} />
            <DimensionBar label="Consistency" score={stock.consistency_score ?? 50} />
            <DimensionBar label="Signal" score={stock.signal_score ?? 50} />
          </div>
        </div>

        {detailLoading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-44 rounded" />
            <div className="grid gap-2 sm:grid-cols-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-[52px] rounded-[14px]" />
              ))}
            </div>
          </div>
        )}

        {!detailLoading && detailError && (
          <p className="text-xs text-muted-foreground py-1">Detail data unavailable</p>
        )}

        {!detailLoading && !detailError && detail && tech && (
          <>
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                Technical indicators
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <DetailCell label="RSI (14)" value={fmtNum(tech.rsi_14, 1)} color={rsiColor(tech.rsi_14)} />
                {/* ADX temporarily disabled — re-enable once indicator is stable
                <DetailCell
                  label="ADX"
                  value={fmtNum(tech.adx, 1)}
                  color={tech.adx != null ? (tech.adx > 25 ? "warning" : "neutral") : "neutral"}
                />
                */}
                <DetailCell
                  label="MACD HIST."
                  value={fmtNum(tech.macd_histogram, 3)}
                  color={
                    tech.macd_histogram != null
                      ? tech.macd_histogram >= 0
                        ? "positive"
                        : "negative"
                      : "neutral"
                  }
                />
                <DetailCell
                  label="vs SMA 50"
                  value={fmtPct(detail.price_vs_sma_50)}
                  color={
                    detail.price_vs_sma_50 != null
                      ? detail.price_vs_sma_50 >= 0
                        ? "positive"
                        : "negative"
                      : "neutral"
                  }
                />
              </div>
            </div>

            {fund && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                  Fundamentals
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailCell label="P/E" value={fmtNum(fund.pe_ratio, 1)} />
                  <DetailCell label="P/S" value={fmtNum(fund.price_to_sales, 2)} />
                  <DetailCell
                    label="EPS growth"
                    value={fmtPct(fund.eps_growth)}
                    color={
                      fund.eps_growth != null
                        ? fund.eps_growth >= 0
                          ? "positive"
                          : "negative"
                        : "neutral"
                    }
                  />
                  <DetailCell
                    label="Revenue growth"
                    value={fmtPct(fund.revenue_growth)}
                    color={
                      fund.revenue_growth != null
                        ? fund.revenue_growth >= 0
                          ? "positive"
                          : "negative"
                        : "neutral"
                    }
                  />
                  <DetailCell label="Market cap" value={fmtMktCap(fund.market_cap)} />
                  <DetailCell
                    label="Volume ratio"
                    value={detail.volume_ratio != null ? `${detail.volume_ratio.toFixed(2)}x` : EMPTY_VALUE}
                  />
                </div>
              </div>
            )}

            {sig && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                  Signal
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailCell
                    label="Latest signal"
                    value={
                      sig.latest_signal != null
                        ? `${sig.latest_signal}${sig.signal_confidence != null ? ` (${Math.round(sig.signal_confidence * 100)}%)` : ""}`
                        : EMPTY_VALUE
                    }
                    color={
                      sig.is_bullish === true
                        ? "positive"
                        : sig.is_bullish === false
                          ? "negative"
                          : "neutral"
                    }
                  />
                  <DetailCell
                    label="Strategy"
                    value={sig.signal_strategy ? sig.signal_strategy.replace(/_/g, " ") : EMPTY_VALUE}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Fundamental Trend Badge (kept; small, muted) ─────────────────────────────

function FundamentalTrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return null;

  const styles: Record<string, string> = {
    improving: "border-profit/25 bg-profit/10 text-profit",
    stable: "border-border/50 bg-muted/50 text-muted-foreground",
    deteriorating: "border-loss/30 bg-loss/10 text-loss",
  };
  const labels: Record<string, string> = {
    improving: "Improving",
    stable: "Stable",
    deteriorating: "Deteriorating",
  };

  const style = styles[trend];
  const label = labels[trend];
  if (!style || !label) return null;

  return (
    <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 gap-0.5", style)}>
      {trend === "improving" && <TrendingUp className="h-2.5 w-2.5" />}
      {trend === "stable" && <Minus className="h-2.5 w-2.5" />}
      {trend === "deteriorating" && <TrendingDown className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  );
}

// ── Stock Row ────────────────────────────────────────────────────────────────
//
// Per spec the row shows only what a quality reader needs:
//   [#rank]  [TICKER + name]   [neutral score]   [20d %, muted]   [Stability bar]
// 1-day % change is intentionally absent from this view — it belongs in
// the detail panel. The stability bar is the only saturated colour in the
// row at rest; momentum colour is muted via `.price-up` / `.price-down`.

function StockRow({
  stock,
  rank,
  expanded,
  onToggle,
  detail,
  detailLoading,
  detailError,
}: {
  stock: StockScore;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  detail: StockDetail | null;
  detailLoading: boolean;
  detailError: boolean;
}) {
  const momentum20d = stock.momentum_20d_pct ?? stock.momentum_1m ?? null;
  const momentumClass =
    momentum20d == null
      ? "text-muted-foreground"
      : momentum20d >= 0
        ? "price-up"
        : "price-down";

  return (
    <Card className="group overflow-hidden rounded-[20px] border border-border/60 bg-card/95 transition-all duration-200 hover:border-primary/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-muted-foreground/60 tabular-nums w-7 shrink-0">
            #{rank}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground tracking-tight">
                {stock.ticker}
              </span>
              <FundamentalTrendBadge trend={stock.fundamental_trend} />
            </div>
            {stock.name && (
              <p className="text-[12px] text-muted-foreground truncate max-w-[260px]">
                {stock.name}
              </p>
            )}
          </div>

          {/* Neutral score badge — objective, not directional. */}
          <div
            className="score-badge text-sm font-semibold shrink-0"
            aria-label={`Composite score ${stock.composite_score.toFixed(0)} out of 100`}
            title={`Composite score ${stock.composite_score.toFixed(1)} / 100 · ${stock.rank_tier}`}
          >
            {stock.composite_score.toFixed(0)}
            <span className="text-[10px] font-normal text-muted-foreground/70 ml-1">/100</span>
          </div>

          {/* 20-day return — muted, secondary. Not the hero. */}
          <div
            className={cn(
              "text-xs font-medium tabular-nums shrink-0 rounded-md px-2 py-1 w-[78px] text-center",
              momentumClass,
            )}
            title="20-day return (≈ one trading month)"
          >
            {fmtPct(momentum20d)}
          </div>
        </div>

        {/* Stability bar — the visual hero. */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground font-medium uppercase tracking-[0.14em]">
              Stability
            </span>
            <span className="font-semibold tabular-nums text-foreground/80">
              {stock.stability_score != null ? stock.stability_score.toFixed(0) : EMPTY_VALUE}
              <span className="text-muted-foreground/70 ml-0.5">/100</span>
            </span>
          </div>
          <StabilityBar score={stock.stability_score} />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="mt-4 h-9 rounded-full border border-border/60 bg-background/70 px-4 text-xs font-medium text-muted-foreground gap-1 hover:bg-background hover:text-foreground"
          onClick={onToggle}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? "Hide details" : "Show details"}
        </Button>

        {expanded && (
          <BreakdownRow
            stock={stock}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

// Spec: "Show top 10 only" — keep 25 / 50 as opt-ins for power users.
const LIMIT_OPTIONS = [10, 25, 50] as const;
const MIN_SCORE_OPTIONS = [0, 40, 60] as const;

const TopStocks = () => {
  const [limit, setLimit] = useState<number>(10);
  const [minScore, setMinScore] = useState<number>(0);
  const [expandedTickers, setExpandedTickers] = useState<Record<string, boolean>>({});
  const [detailCache, setDetailCache] = useState<Record<string, StockDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailError, setDetailError] = useState<Record<string, boolean>>({});
  const [detailNotFound, setDetailNotFound] = useState<Record<string, boolean>>({});

  const queryClient = useQueryClient();
  const { data, isLoading, error, isRefetching } = useTopStocks(limit, minScore);

  const stocks = useMemo(() => data?.stocks ?? [], [data?.stocks]);
  const totalScored = data?.totalScored ?? 0;
  const dataAgeHours = data?.dataAgeHours ?? null;
  const hasTrackedRankingViewRef = useRef(false);
  const previousFiltersRef = useRef<{ limit: number; minScore: number } | null>(null);

  useEffect(() => {
    if (!data || hasTrackedRankingViewRef.current) return;
    AnalyticsEvents.stockRankingViewed({
      limit,
      min_score: minScore,
      total_scored: totalScored,
      data_age_hours: data.dataAgeHours,
    });
    hasTrackedRankingViewRef.current = true;
  }, [data, limit, minScore, totalScored]);

  useEffect(() => {
    const previousFilters = previousFiltersRef.current;
    if (previousFilters && (previousFilters.limit !== limit || previousFilters.minScore !== minScore)) {
      AnalyticsEvents.stockRankingFilterChanged({
        limit,
        min_score: minScore,
      });
    }
    previousFiltersRef.current = { limit, minScore };
  }, [limit, minScore]);

  const handleToggleExpanded = async (ticker: string) => {
    const expanding = !expandedTickers[ticker];
    setExpandedTickers((current) => ({ ...current, [ticker]: expanding }));

    if (expanding) {
      AnalyticsEvents.stockDetailExpanded(ticker);
    }

    if (expanding && !detailCache[ticker] && !detailNotFound[ticker]) {
      setDetailLoading((current) => ({ ...current, [ticker]: true }));
      setDetailError((current) => ({ ...current, [ticker]: false }));
      try {
        const detail = await getStockDetail(ticker);
        setDetailCache((current) => ({ ...current, [ticker]: detail }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setDetailNotFound((current) => ({ ...current, [ticker]: true }));
        } else {
          setDetailError((current) => ({ ...current, [ticker]: true }));
        }
      } finally {
        setDetailLoading((current) => ({ ...current, [ticker]: false }));
      }
    }
  };

  const updatedLabel = (() => {
    if (dataAgeHours == null) return "Awaiting first ranking cycle";
    if (dataAgeHours < 1) return "Updated less than an hour ago";
    if (dataAgeHours < 24) return `Updated ${Math.round(dataAgeHours)} hour${Math.round(dataAgeHours) === 1 ? "" : "s"} ago`;
    const days = Math.round(dataAgeHours / 24);
    return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
  })();

  return (
    <AppLayout title="Top Stocks">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-[24px] border border-border/60 bg-card/95 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <Trophy className="h-3.5 w-3.5" />
                Top Ranked Stocks
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Quality first. Spikes need not apply.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Each name is filtered for price ≥ $5, market cap ≥ $500M, and
                  average volume ≥ 500k shares before scoring. Composite blends
                  momentum, stability, trend, quality, and volume —
                  recalculated each cycle, never live.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["top-stocks"] })}
                disabled={isLoading || isRefetching}
                className="h-10 rounded-full px-4"
              >
                <RefreshCw className={cn("h-4 w-4", (isLoading || isRefetching) && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
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
          </div>

          <div className="mt-4 rounded-[20px] border border-border/60 bg-background/70 p-4">
            <p className="text-xs leading-5 text-muted-foreground/80">
              Composite weights: momentum 30 · stability 25 · trend 20 · quality 15 · volume 5. Provided for research only — not personalised investment advice.
            </p>
          </div>
        </section>

        {/* Content */}
        {error ? (
          <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/95">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-loss/10">
                <Trophy className="h-8 w-8 text-loss" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Error loading stock rankings</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                {error instanceof Error ? error.message : "Failed to fetch stock data."}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="border-border/50 bg-card/50">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-6" />
                    <Skeleton className="h-4 w-24 flex-1" />
                    <Skeleton className="h-7 w-16 rounded-full" />
                    <Skeleton className="h-7 w-16 rounded-md" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/95">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10">
                <Trophy className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">No stocks match the current filters</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                {minScore > 0
                  ? `Try lowering the minimum score threshold. It is currently set to >= ${minScore}.`
                  : "No stock data is available yet. The ranking cycle may not have completed."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {stocks.map((stock, index) => (
              <StockRow
                key={stock.ticker}
                stock={stock}
                rank={index + 1}
                expanded={Boolean(expandedTickers[stock.ticker])}
                onToggle={() => handleToggleExpanded(stock.ticker)}
                detail={detailCache[stock.ticker] ?? null}
                detailLoading={Boolean(detailLoading[stock.ticker])}
                detailError={Boolean(detailError[stock.ticker])}
              />
            ))}
          </div>
        )}

        {!isLoading && (
          <p className="text-center text-xs text-muted-foreground pb-4">
            {updatedLabel} · ranked universe of {totalScored}
          </p>
        )}
      </div>
    </AppLayout>
  );
};

export default TopStocks;
