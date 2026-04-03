import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  Minus,
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
import { ApiError, getStockDetail } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AnalyticsEvents } from "@/services/analytics";
import type { StockDetail, StockScore } from "@/types/database";

const EMPTY_VALUE = "—";

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

function tierLabel(tier: string) {
  switch (tier) {
    case "Strong Buy":
      return "Top score";
    case "Buy":
      return "Above average";
    case "Hold":
      return "Neutral";
    case "Underperform":
      return "Below average";
    case "Sell":
      return "Lowest score";
    default:
      return tier;
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

function convictionLabel(conviction: string) {
  switch (conviction) {
    case "High":
      return "High agreement";
    case "Medium":
      return "Moderate agreement";
    default:
      return "Low agreement";
  }
}

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

function ScoreBar({ label, score }: { label: string; score: number }) {
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
    </div>
  );
}

// ── Detail Cell ────────────────────────────────────────────────────────────────

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
                ? "text-destructive"
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

// ── Breakdown Section (Show details expansion) ────────────────────────────────

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
  const momentumItems: { label: string; value: string; positive?: boolean }[] = [
    {
      label: "1M Return",
      value: fmtPct(stock.momentum_1m),
      positive: stock.momentum_1m !== null && stock.momentum_1m > 0,
    },
    {
      label: "3M Return",
      value: fmtPct(stock.momentum_3m),
      positive: stock.momentum_3m !== null && stock.momentum_3m > 0,
    },
    {
      label: "6M Return",
      value: fmtPct(stock.momentum_6m),
      positive: stock.momentum_6m !== null && stock.momentum_6m > 0,
    },
    {
      label: "12M Return",
      value: fmtPct(stock.momentum_12m),
      positive: stock.momentum_12m !== null && stock.momentum_12m > 0,
    },
  ];

  const tech = detail?.technicals;
  const fund = detail?.fundamentals;
  const sig = detail?.signals;

  // ── Technical cells ──────────────────────────────────────────────────────

  const rsiColor = (v: number | null | undefined): CellColor => {
    if (v == null) return "neutral";
    if (v > 70) return "negative";
    if (v < 30) return "positive";
    return "neutral";
  };

  const macdText =
    tech?.macd_above_signal === true
      ? "Above signal"
      : tech?.macd_above_signal === false
        ? "Below signal"
        : EMPTY_VALUE;
  const macdColor: CellColor =
    tech?.macd_above_signal === true
      ? "positive"
      : tech?.macd_above_signal === false
        ? "negative"
        : "neutral";

  const goldenCrossText =
    tech?.golden_cross === true
      ? "Yes (SMA50>200)"
      : tech?.golden_cross === false
        ? "No (SMA50<200)"
        : EMPTY_VALUE;
  const goldenCrossColor: CellColor =
    tech?.golden_cross === true ? "positive" : tech?.golden_cross === false ? "negative" : "neutral";

  const stochText =
    tech?.stochastic_k != null && tech?.stochastic_d != null
      ? `${fmtNum(tech.stochastic_k, 1)} / ${fmtNum(tech.stochastic_d, 1)}`
      : EMPTY_VALUE;

  const williamsColor = (v: number | null | undefined): CellColor => {
    if (v == null) return "neutral";
    if (v < -80) return "positive";
    if (v > -20) return "negative";
    return "neutral";
  };

  const cciColor = (v: number | null | undefined): CellColor => {
    if (v == null) return "neutral";
    if (v > 100) return "negative";
    if (v < -100) return "positive";
    return "neutral";
  };

  const bbPosText =
    tech?.bollinger_position != null ? `${tech.bollinger_position}%` : EMPTY_VALUE;
  const bbPosColor: CellColor =
    tech?.bollinger_position != null
      ? tech.bollinger_position > 80
        ? "negative"
        : tech.bollinger_position < 20
          ? "positive"
          : "neutral"
      : "neutral";

  // ── Signal cell ──────────────────────────────────────────────────────────

  const signalText =
    sig?.latest_signal != null
      ? `${sig.latest_signal}${sig.signal_confidence != null ? ` (${Math.round(sig.signal_confidence * 100)}%)` : ""}`
      : EMPTY_VALUE;
  const signalColor: CellColor =
    sig?.is_bullish === true ? "positive" : sig?.is_bullish === false ? "negative" : "neutral";

  const strategyText = sig?.signal_strategy
    ? sig.signal_strategy.replace(/_/g, " ")
    : EMPTY_VALUE;

  return (
    <div className="mt-4 rounded-[18px] border border-border/60 bg-background/70 p-4">
      <div className="space-y-4 border-t border-border/50 pt-4">

        {/* ── 1. MOMENTUM (Multi-Horizon) ────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
            Momentum (Multi-Horizon)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {momentumItems.map(({ label, value, positive }) => (
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
                    value === EMPTY_VALUE
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

          {/* Extra momentum items from detail */}
          {detailLoading && (
            <div className="grid gap-2 sm:grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-[52px] rounded-[14px]" />
              ))}
            </div>
          )}
          {!detailLoading && !detailError && detail && (
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailCell
                label="Volume Ratio"
                value={detail.volume_ratio != null ? `${detail.volume_ratio.toFixed(2)}x` : EMPTY_VALUE}
                color={detail.volume_ratio != null ? (detail.volume_ratio >= 1 ? "positive" : "negative") : "neutral"}
              />
              <DetailCell
                label="VS SMA 50"
                value={fmtPct(detail.price_vs_sma_50)}
                color={detail.price_vs_sma_50 != null ? (detail.price_vs_sma_50 >= 0 ? "positive" : "negative") : "neutral"}
              />
              <DetailCell
                label="VS SMA 200"
                value={fmtPct(detail.price_vs_sma_200)}
                color={detail.price_vs_sma_200 != null ? (detail.price_vs_sma_200 >= 0 ? "positive" : "negative") : "neutral"}
              />
              <DetailCell
                label="52W Position"
                value={detail.high_52w_position != null ? `${detail.high_52w_position}%` : EMPTY_VALUE}
                color={detail.high_52w_position != null ? (detail.high_52w_position > 50 ? "positive" : "negative") : "neutral"}
              />
            </div>
          )}
        </div>

        {/* Loading / error state for all remaining detail sections */}
        {detailLoading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-44 rounded" />
            <div className="grid gap-2 sm:grid-cols-2">
              {[...Array(10)].map((_, i) => (
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
            {/* ── 2. TECHNICAL INDICATORS ──────────────────────────────────── */}
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                Technical Indicators
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <DetailCell label="RSI (14)" value={fmtNum(tech.rsi_14, 1)} color={rsiColor(tech.rsi_14)} />
                <DetailCell label="RSI (9)" value={fmtNum(tech.rsi_9, 1)} color={rsiColor(tech.rsi_9)} />
                <DetailCell label="MACD" value={macdText} color={macdColor} />
                <DetailCell
                  label="MACD HIST."
                  value={fmtNum(tech.macd_histogram, 3)}
                  color={tech.macd_histogram != null ? (tech.macd_histogram >= 0 ? "positive" : "negative") : "neutral"}
                />
                <DetailCell label="GOLDEN CROSS" value={goldenCrossText} color={goldenCrossColor} />
                <DetailCell
                  label="ADX"
                  value={fmtNum(tech.adx, 1)}
                  color={tech.adx != null ? (tech.adx > 25 ? "warning" : "neutral") : "neutral"}
                />
                <DetailCell label="STOCHASTIC K/D" value={stochText} />
                <DetailCell label="WILLIAMS %R" value={fmtNum(tech.williams_r, 1)} color={williamsColor(tech.williams_r)} />
                <DetailCell label="CCI" value={fmtNum(tech.cci, 1)} color={cciColor(tech.cci)} />
                <DetailCell label="BB POSITION" value={bbPosText} color={bbPosColor} />
              </div>
            </div>

            {/* ── 3. FUNDAMENTALS & VALUATION ──────────────────────────────── */}
            {fund && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                  Fundamentals &amp; Valuation
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailCell label="P/E" value={fmtNum(fund.pe_ratio, 1)} />
                  <DetailCell label="FWD P/E" value={fmtNum(fund.forward_pe, 1)} />
                  <DetailCell label="PEG" value={fmtNum(fund.peg_ratio, 2)} />
                  <DetailCell label="P/B" value={fmtNum(fund.price_to_book, 2)} />
                  <DetailCell label="P/S" value={fmtNum(fund.price_to_sales, 2)} />
                  <DetailCell
                    label="EPS"
                    value={fmtNum(fund.eps, 2)}
                    color={fund.eps != null ? (fund.eps >= 0 ? "neutral" : "negative") : "neutral"}
                  />
                  <DetailCell
                    label="EPS GROWTH"
                    value={fmtPct(fund.eps_growth)}
                    color={fund.eps_growth != null ? (fund.eps_growth >= 0 ? "positive" : "negative") : "neutral"}
                  />
                  <DetailCell
                    label="REV. GROWTH"
                    value={fmtPct(fund.revenue_growth)}
                    color={fund.revenue_growth != null ? (fund.revenue_growth >= 0 ? "positive" : "negative") : "neutral"}
                  />
                  <DetailCell
                    label="DIV. YIELD"
                    value={fund.dividend_yield != null ? `${fund.dividend_yield.toFixed(2)}%` : EMPTY_VALUE}
                  />
                  <DetailCell label="MKT CAP" value={fmtMktCap(fund.market_cap)} />
                </div>
              </div>
            )}

            {/* ── 4. ML / SIGNALS ──────────────────────────────────────────── */}
            {sig && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
                  ML / Signals
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailCell label="SIGNAL" value={signalText} color={signalColor} />
                  <DetailCell label="STRATEGY" value={strategyText} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Fundamental Trend Badge ────────────────────────────────────────────────────

function FundamentalTrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return null;

  const styles: Record<string, string> = {
    improving: "border-profit/25 bg-profit/10 text-profit",
    stable: "border-border/50 bg-muted/50 text-muted-foreground",
    deteriorating: "border-destructive/30 bg-destructive/10 text-destructive",
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

// ── Stock Card ────────────────────────────────────────────────────────────────

function StockCard({
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
  const pctColor =
    stock.change_percent === null
      ? "text-muted-foreground"
      : stock.change_percent >= 0
      ? "text-profit"
      : "text-loss";
  const PctIcon =
    stock.change_percent !== null && stock.change_percent >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card className="group overflow-hidden rounded-[22px] border border-border/60 bg-card/90 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.55)] transition-all duration-200 hover:border-primary/25 hover:bg-card animate-in fade-in duration-300">
      <CardContent className="p-5">
        {/* Top row: rank + ticker + composite */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-muted-foreground/60 tabular-nums w-5 shrink-0">
              #{rank}
            </span>
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground">{stock.ticker}</span>
              {stock.name && (
                <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                  {stock.name}
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

        {/* Tier + Conviction + Fundamental Trend row */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={cn("text-[9px] px-1.5 py-0 h-4 font-semibold", tierBadge(stock.rank_tier))}
          >
            {tierLabel(stock.rank_tier)}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-[9px] px-1.5 py-0 h-4 gap-0.5", convictionBadge(stock.conviction))}
          >
            {stock.conviction === "High" && <Star className="h-2.5 w-2.5" />}
            {stock.conviction === "Medium" && <Shield className="h-2.5 w-2.5" />}
            {convictionLabel(stock.conviction)}
          </Badge>
          <FundamentalTrendBadge trend={stock.fundamental_trend} />
        </div>

        {/* Change percent row */}
        <div className={cn("flex items-center gap-0.5 text-xs font-medium mt-2", pctColor)}>
          <PctIcon className="h-3 w-3" />
          {fmtPct(stock.change_percent)}
        </div>

        {/* Composite score bar */}
        <div className="mt-3 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground font-medium">Composite</span>
            <span className={cn("font-semibold", (stock.composite_score ?? 0) >= 70 ? "text-profit" : (stock.composite_score ?? 0) >= 50 ? "text-yellow-500" : "text-destructive")}>
              {stock.composite_score != null ? stock.composite_score.toFixed(1) : EMPTY_VALUE} / 100
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50">
            <div
              className={cn("h-full rounded-full transition-all", scoreBar(stock.composite_score))}
              style={{ width: `${Math.min(100, stock.composite_score)}%` }}
            />
          </div>
        </div>

        {/* Dimension scores — 5 dimensions */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ScoreBar label="Momentum" score={stock.momentum_score ?? 50} />
          <ScoreBar label="Technical" score={stock.technical_score ?? 50} />
          <ScoreBar label="Fundamental" score={stock.fundamental_score ?? 50} />
          <ScoreBar label="Consistency" score={stock.consistency_score ?? 50} />
          <ScoreBar label="Signal" score={stock.signal_score ?? 50} />
        </div>

        {/* Expand/collapse breakdown */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 h-10 rounded-full border border-border/70 bg-background/70 px-4 text-xs font-medium text-muted-foreground gap-1 hover:bg-background hover:text-foreground"
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

// ── Main Page ─────────────────────────────────────────────────────────────────

const LIMIT_OPTIONS = [20, 50] as const;
const MIN_SCORE_OPTIONS = [0, 40, 60] as const;

function useIsLargeStocksViewport() {
  const [isLargeViewport, setIsLargeViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsLargeViewport(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);

    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  return isLargeViewport;
}

const TopStocks = () => {
  const [limit, setLimit] = useState<number>(20);
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
  const isLargeViewport = useIsLargeStocksViewport();
  const columnCount = isLargeViewport ? 2 : 1;
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasTrackedRankingViewRef = useRef(false);
  const previousFiltersRef = useRef<{ limit: number; minScore: number } | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const stockRows = useMemo(() => {
    const rows: Array<Array<{ stock: StockScore; rank: number }>> = [];

    for (let index = 0; index < stocks.length; index += columnCount) {
      rows.push(
        stocks.slice(index, index + columnCount).map((stock, offset) => ({
          stock,
          rank: index + offset + 1,
        })),
      );
    }

    return rows;
  }, [columnCount, stocks]);

  const rowVirtualizer = useWindowVirtualizer({
    count: stockRows.length,
    estimateSize: () => (columnCount === 2 ? 480 : 620),
    overscan: 4,
    scrollMargin,
  });

  useEffect(() => {
    const updateScrollMargin = () => {
      if (!listRef.current) return;
      setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
    };

    updateScrollMargin();

    if (typeof ResizeObserver === "undefined" || !listRef.current) {
      window.addEventListener("resize", updateScrollMargin);
      return () => window.removeEventListener("resize", updateScrollMargin);
    }

    const resizeObserver = new ResizeObserver(updateScrollMargin);
    resizeObserver.observe(listRef.current);
    window.addEventListener("resize", updateScrollMargin);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollMargin);
    };
  }, [columnCount, limit, minScore, stockRows.length, totalScored]);

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
          // Ticker has no snapshot data — not an error, just skip the detail sections
          setDetailNotFound((current) => ({ ...current, [ticker]: true }));
        } else {
          setDetailError((current) => ({ ...current, [ticker]: true }));
        }
      } finally {
        setDetailLoading((current) => ({ ...current, [ticker]: false }));
      }
    }
  };

  return (
    <AppLayout title="Top Stocks">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[24px] border border-border/60 bg-card/95 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.28)] animate-in fade-in duration-300">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" />
              Top Ranked Stocks
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Review the highest-scoring names faster.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Review ranked names, tighten the score filter, and compare 5-dimension scores from one clean surface.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['top-stocks'] })}
              disabled={isLoading || isRefetching}
              className="h-10 rounded-full px-4"
            >
              <RefreshCw className={cn("h-4 w-4", (isLoading || isRefetching) && "animate-spin")} />
              Refresh rankings
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
        </div>

        <div className="mt-4 rounded-[20px] border border-border/60 bg-background/70 p-4">
          <p className="text-xs leading-5 text-muted-foreground/80">
            5-dimension scoring using 12 months of market data. Consistency-weighted for stable, reliable rankings. Provided for research only — not personalised investment advice.
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
                    {[...Array(5)].map((_, j) => (
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
                  : "No stock data is available. Make sure the backend is running."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div ref={listRef} className="relative">
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = stockRows[virtualRow.index];
                if (!row) return null;

                return (
                  <div
                    key={row.map(({ stock }) => stock.ticker).join(":")}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
                  >
                    <div className={cn("grid gap-4", columnCount === 2 && "lg:grid-cols-2")}>
                      {row.map(({ stock, rank }) => (
                        <StockCard
                          key={stock.ticker}
                          stock={stock}
                          rank={rank}
                          expanded={Boolean(expandedTickers[stock.ticker])}
                          onToggle={() => handleToggleExpanded(stock.ticker)}
                          detail={detailCache[stock.ticker] ?? null}
                          detailLoading={Boolean(detailLoading[stock.ticker])}
                          detailError={Boolean(detailError[stock.ticker])}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Data freshness footer */}
        {!isLoading && (
          <p className="text-center text-xs text-muted-foreground pb-4">
            {dataAgeHours === null || dataAgeHours > 24
              ? "Rankings updating soon"
              : `Rankings updated daily · Last ranked ${Math.round(dataAgeHours)} hours ago`}
          </p>
        )}
      </div>
    </AppLayout>
  );
};

export default TopStocks;
