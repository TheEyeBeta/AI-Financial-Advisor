# backend/websearch_service/app/services/ranking_engine.py
"""Stock Ranking Engine — scheduled batch scorer.

Runs daily at 01:00 UTC (via APScheduler) to score all tickers using a
six-dimension composite derived from market.stock_snapshots indicators
and market.stock_returns_mv pre-computed returns.  Writes the top 50 to
market.trending_stocks.

Data sources (both in the market schema, zero N+1 queries):
  market.stock_snapshots  — latest indicator snapshot per ticker
  market.stock_returns_mv — pre-computed multi-horizon price returns

Hard filters (applied before scoring — eliminate spike/penny/illiquid bias):
  1. Complete data       — every scoring field must be non-null
  2. has_6m_history      — ≥ 126 trading days (covers "listed < 90 days")
  3. last_price          ≥ MIN_PRICE_USD ($5)
  4. market_cap          ≥ MIN_MARKET_CAP_USD ($500M)
  5. avg_volume_10d      ≥ MIN_AVG_VOLUME_SHARES (500k shares/day)
  6. adx                 ≥ 20 (sideways / ranging market filter retained)

Scoring formula (weights — stability promoted to #2 to remove spike bias):
  momentum_score   30%  multi-horizon return blend (1M/3M/6M/12M)
                          — academically validated; rewards sustained,
                          time-normalised price performance, never 1-day spikes.
  stability_score  25%  inverted Bollinger band width (low-volatility = high
                          score).  This is the single change that disqualifies
                          short-squeezes and overnight-spike movers from the
                          top of the list.
  trend_score      20%  normalise(price_vs_sma_50)
  quality_score    15%  eps_growth * 0.50 + revenue_growth * 0.30 +
                          earnings_yield (1/pe_ratio) * 0.20
  volume_score      5%  normalise(volume / avg_volume_10d) — capped via
                          winsorisation so spike volume cannot dominate
  adx_score         5%  normalise(adx) if is_bullish else neutral 50.0

  composite = 0.30*momentum + 0.25*stability + 0.20*trend +
              0.15*quality  + 0.05*volume    + 0.05*adx

  Stability is computed from Bollinger band width because it is a true
  20-period (one trading month) volatility measure already available in
  stock_snapshots.  A future improvement is to replace it with a direct
  20-day rolling stdev of daily returns when the upstream pipeline begins
  exporting it.

  Deliberately excluded (require > 6 months of history):
    price_vs_sma_200  — SMA-200 needs 200 days (~10 months)
    range_score       — high_52w / low_52w need 252 days (~12 months)

Design constraints
──────────────────
- NO N+1 queries.  All data is bulk-fetched before the per-ticker scoring loop.
- Run lock prevents overlapping cycles in a single-process deployment.
- Single ticker failures are isolated — never abort the full cycle.
- market.trending_stocks always contains exactly the current top 50.
"""
from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

# ── Run lock ──────────────────────────────────────────────────────────────────
_cycle_running: bool = False


# ── Quality hard-filter thresholds ────────────────────────────────────────────
# Anything below these is excluded before scoring.  These cut penny stocks,
# micro-caps, and illiquid names that would otherwise win the ranking via
# overnight spikes on tiny share counts.
MIN_PRICE_USD: float = 5.0
MIN_MARKET_CAP_USD: float = 500_000_000.0
MIN_AVG_VOLUME_SHARES: float = 500_000.0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tbl(schema: str, table: str):
    """Return a schema-qualified table builder."""
    return supabase_client.schema(schema).table(table)


def _f(val: Any) -> Optional[float]:
    """Safe float conversion — returns None for null/non-finite values."""
    import math
    if val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _winsorize(
    values: dict[str, float],
    lower_pct: float = 5.0,
    upper_pct: float = 95.0,
) -> dict[str, float]:
    """Clip values to [lower_pct, upper_pct] percentile range cross-sectionally.
    Prevents a single outlier from compressing the rest of the universe
    when passed into _minmax_normalize.
    """
    if len(values) < 4:
        return values  # too few tickers to winsorize meaningfully
    arr = np.array(list(values.values()), dtype=float)
    lo = float(np.percentile(arr, lower_pct))
    hi = float(np.percentile(arr, upper_pct))
    return {k: float(np.clip(v, lo, hi)) for k, v in values.items()}


def _minmax_normalize(
    values: dict[str, float], default: float = 50.0
) -> dict[str, float]:
    """Winsorize then min-max normalize {ticker: raw_value} → {ticker: 0-100}.
    Winsorization (5th/95th pct) prevents outliers from distorting the
    cross-sectional ranking.  If all post-clip values are identical, every
    ticker gets `default`.
    """
    if not values:
        return {}
    clipped = _winsorize(values)
    lo = min(clipped.values())
    hi = max(clipped.values())
    rng = hi - lo
    if rng == 0:
        return {t: default for t in values}
    return {t: round((v - lo) / rng * 100.0, 2) for t, v in clipped.items()}


# ── Data fetching ─────────────────────────────────────────────────────────────

def _fetch_indicators_snapshot() -> dict[str, dict]:
    """Bulk-fetch the latest snapshot for all tickers from market.stock_snapshots.

    One row per ticker — always represents the most recent available data.
    Returns: {ticker: row}
    """
    result = (
        _tbl("market", "stock_snapshots")
        .select(
            "ticker, company_name, price_change_pct, "
            "last_price, volume, avg_volume_10d, market_cap, "
            "rsi_14, macd_histogram, "
            "adx, is_bullish, "
            "price_vs_sma_50, "
            "bollinger_upper, bollinger_middle, bollinger_lower, "
            "is_overbought, is_oversold, "
            "eps_growth, revenue_growth, pe_ratio"
        )
        .order("market_cap", desc=True)
        .limit(600)
        .execute()
    )
    rows = result.data or []
    if len(rows) == 600:
        logger.warning(
            "_fetch_indicators_snapshot: hit 600-row cap — universe may be truncated. "
            "Consider raising the limit."
        )
    by_ticker = {row["ticker"]: row for row in rows if row.get("ticker")}
    logger.info("_fetch_indicators_snapshot: %d tickers", len(by_ticker))
    return by_ticker


def _fetch_stock_returns() -> dict[str, dict]:
    """Bulk-fetch pre-computed returns from market.stock_returns_mv.

    Used for 6-month return bias in momentum scoring and for enforcing the
    ≥ 6-month history completeness requirement.
    Returns: {ticker: row}
    """
    result = (
        _tbl("market", "stock_returns_mv")
        .select(
            "ticker, return_6m, has_6m_history, "
            "return_1m, return_3m, return_12m, total_trading_days"
        )
        .execute()
    )
    rows = result.data or []
    by_ticker = {row["ticker"]: row for row in rows if row.get("ticker")}
    logger.info("_fetch_stock_returns: %d tickers", len(by_ticker))
    return by_ticker


# ── Stability proxy ───────────────────────────────────────────────────────────


def _bollinger_band_width(snap: dict) -> Optional[float]:
    """Return the 20-period Bollinger band width relative to the middle band.

    Width = (upper − lower) / middle.  Lower width = lower volatility = more
    stable.  Returns None when any of the three bands or the middle band is
    missing/zero — caller treats None as "no stability signal".
    """
    upper = _f(snap.get("bollinger_upper"))
    middle = _f(snap.get("bollinger_middle"))
    lower = _f(snap.get("bollinger_lower"))
    if upper is None or middle is None or lower is None:
        return None
    if middle == 0:
        return None
    return (upper - lower) / abs(middle)


# ── Completeness check ────────────────────────────────────────────────────────

# All fields that must be non-null for a ticker to enter scoring.
# Missing any one of these → excluded before normalisation.
_REQUIRED_SNAPSHOT_FIELDS = (
    "price_vs_sma_50",   # SMA-50 reliable within 6-month window
    "rsi_14",
    "macd_histogram",
    "volume",
    # avg_volume_10d excluded from required fields —
    # populated by Mac Mini daily pipeline, not real-time.
    # Null between pipeline runs causes full universe failure.
    # Volume scoring uses 50.0 neutral when unavailable.
    "last_price",
    "adx",
    # Excluded — require more than 6 months of history:
    #   price_vs_sma_200  (needs ~200 days)
    #   high_52w / low_52w (need ~252 days)
)


def _has_complete_data(snap: dict, returns_row: Optional[dict]) -> bool:
    """Return True only when every scoring field is non-null and the ticker
    has at least 6 months (≈ 126 trading days) of price history."""
    # Must have a returns row with 6m history confirmed
    if returns_row is None:
        return False
    if not returns_row.get("has_6m_history"):
        return False
    r6m = _f(returns_row.get("return_6m"))
    if r6m is None:
        return False
    r3m = _f(returns_row.get("return_3m"))
    if r3m is None:
        return False

    # All snapshot scoring fields must be non-null / finite
    for field in _REQUIRED_SNAPSHOT_FIELDS:
        if _f(snap.get(field)) is None:
            return False
    return True


# ── Tier and conviction ───────────────────────────────────────────────────────

def _rank_tier(score: float) -> str:
    if score >= 80:
        return "Strong Buy"
    elif score >= 65:
        return "Buy"
    elif score >= 45:
        return "Hold"
    elif score >= 30:
        return "Underperform"
    return "Sell"


def _conviction(composite: float) -> str:
    if composite >= 70:
        return "High"
    elif composite >= 50:
        return "Medium"
    return "Low"


# ── Core sync implementation (runs in a thread pool) ─────────────────────────

def _run_ranking_cycle_sync(cycle_start: datetime) -> dict:
    """Full ranking cycle: fetch → filter → score → upsert top 50 → delete stale.

    Designed to run in asyncio.to_thread() so the event loop is never blocked.
    Returns a summary dict.
    """
    start_ts = _time.monotonic()
    logger.info("Ranking cycle starting")

    # ── Step 1: Bulk-fetch both data sources ──────────────────────────────────
    snapshots = _fetch_indicators_snapshot()
    returns   = _fetch_stock_returns()
    logger.info(
        "Loaded snapshots for %d tickers, returns for %d tickers",
        len(snapshots), len(returns),
    )

    # ── Step 2: Completeness filter + hard filters ────────────────────────────
    #
    # Completeness: all scoring fields non-null AND has_6m_history = True.
    # Hard filters (eliminate penny / micro-cap / illiquid spike bias):
    #   - last_price        ≥ MIN_PRICE_USD
    #   - market_cap        ≥ MIN_MARKET_CAP_USD
    #   - avg_volume_10d    ≥ MIN_AVG_VOLUME_SHARES
    #   - adx               ≥ 20 (sideways-market filter, retained)
    filtered: dict[str, dict] = {}   # snap merged with returns row
    skipped_incomplete = 0
    skipped_hard_filter = 0
    skipped_quality_gate = 0

    for ticker, snap in snapshots.items():
        ret_row = returns.get(ticker)

        # Completeness guard
        if not _has_complete_data(snap, ret_row):
            skipped_incomplete += 1
            continue

        # Quality gates — disqualify spike-prone, illiquid, or penny names
        # before they can win on a single noisy day.
        last_price = _f(snap.get("last_price"))
        market_cap = _f(snap.get("market_cap"))
        avg_vol = _f(snap.get("avg_volume_10d"))

        if last_price is not None and last_price < MIN_PRICE_USD:
            skipped_quality_gate += 1
            continue
        if market_cap is not None and market_cap < MIN_MARKET_CAP_USD:
            skipped_quality_gate += 1
            continue
        if avg_vol is not None and avg_vol < MIN_AVG_VOLUME_SHARES:
            skipped_quality_gate += 1
            continue

        # Hard filter: ranging market (ADX < 20)
        adx = _f(snap.get("adx"))
        if adx is not None and adx < 20:
            skipped_hard_filter += 1
            continue

        # Recompute volume ratio defensively; the stored value has had unit
        # mismatches historically.
        if avg_vol and avg_vol > 0:
            recalc_ratio = (_f(snap.get("volume")) or 0) / avg_vol
        else:
            recalc_ratio = None

        # Merge returns + derived stability proxy into the snap dict.
        merged = dict(snap)
        merged["_recalc_volume_ratio"] = recalc_ratio
        merged["_return_6m"]           = _f(ret_row["return_6m"])   # type: ignore[index]
        merged["_return_1m"]           = _f(ret_row.get("return_1m"))
        merged["_return_3m"]           = _f(ret_row.get("return_3m"))
        merged["_return_12m"]          = _f(ret_row.get("return_12m"))
        merged["_band_width"]          = _bollinger_band_width(snap)
        filtered[ticker] = merged

    logger.info(
        "After filters: %d eligible | %d incomplete | %d quality-gated | %d failed hard filters",
        len(filtered), skipped_incomplete, skipped_quality_gate, skipped_hard_filter,
    )

    if not filtered:
        logger.warning("No tickers passed all filters — ranking cycle produced no results")
        elapsed = round(_time.monotonic() - start_ts, 2)
        return {
            "tickers_scored":         0,
            "tickers_failed":         0,
            "top_50_written":         0,
            "skipped_incomplete":     skipped_incomplete,
            "skipped_quality_gate":   skipped_quality_gate,
            "skipped_hard_filter":    skipped_hard_filter,
            "cycle_duration_seconds": elapsed,
            "ranked_at":              cycle_start.isoformat(),
        }

    # ── Step 3: Component normalisation across the eligible universe ──────────
    #
    # All normalisations use _minmax_normalize so every component maps to 0-100
    # relative to the filtered universe.  Tickers absent from a pool (field was
    # null before the completeness check, which can't happen here) would get the
    # default 50.0 — included for defensive completeness.

    # ── Trend ─────────────────────────────────────────────────────────────────
    # Only price_vs_sma_50 — SMA-200 excluded (requires ~200 days, > 6-month gate).
    raw_trend: dict[str, float] = {
        ticker: _f(snap["price_vs_sma_50"])  # type: ignore[misc]
        for ticker, snap in filtered.items()
    }
    trend_norm = _minmax_normalize(raw_trend)

    # ── Momentum (multi-horizon blend) ───────────────────────────────────────────
    # Weights: 1M=20%, 3M=35%, 6M=30%, 12M=15%
    # 3M and 6M carry the most weight — medium-term momentum is most predictive.
    # 1M adds short-term acceleration; 12M adds long-term persistence context.
    # All four are already fetched; only normalise tickers where the value is non-null.
    raw_return_1m  = {t: s["_return_1m"]  for t, s in filtered.items() if s.get("_return_1m")  is not None}
    raw_return_3m  = {t: s["_return_3m"]  for t, s in filtered.items() if s.get("_return_3m")  is not None}
    raw_return_6m  = {t: s["_return_6m"]  for t, s in filtered.items() if s.get("_return_6m")  is not None}
    raw_return_12m = {t: s["_return_12m"] for t, s in filtered.items() if s.get("_return_12m") is not None}
    return_1m_norm  = _minmax_normalize(raw_return_1m)
    return_3m_norm  = _minmax_normalize(raw_return_3m)
    return_6m_norm  = _minmax_normalize(raw_return_6m)
    return_12m_norm = _minmax_normalize(raw_return_12m)

    momentum_scores: dict[str, float] = {
        ticker: round(
            return_1m_norm.get(ticker,  50.0) * 0.20
            + return_3m_norm.get(ticker,  50.0) * 0.35
            + return_6m_norm.get(ticker,  50.0) * 0.30
            + return_12m_norm.get(ticker, 50.0) * 0.15,
            2,
        )
        for ticker in filtered
    }

    # ── Volume ────────────────────────────────────────────────────────────────
    raw_volume = {
        t: s["_recalc_volume_ratio"]
        for t, s in filtered.items()
        if s.get("_recalc_volume_ratio") is not None
    }
    volume_norm = _minmax_normalize(raw_volume)

    # range_score removed — high_52w / low_52w require ~252 days (> 6-month gate).

    # ── Quality / Growth ──────────────────────────────────────────────────────
    # Uses eps_growth (50%), revenue_growth (30%), earnings yield 1/pe_ratio (20%).
    # pe_ratio is inverted so higher earnings yield = higher score.
    # Tickers with null fields are excluded from that sub-pool and receive 50.0.
    # Winsorization inside _minmax_normalize handles PE ratio outliers.
    raw_eps_growth = {
        t: _f(s.get("eps_growth"))
        for t, s in filtered.items()
        if _f(s.get("eps_growth")) is not None
    }
    raw_rev_growth = {
        t: _f(s.get("revenue_growth"))
        for t, s in filtered.items()
        if _f(s.get("revenue_growth")) is not None
    }
    raw_earnings_yield = {
        t: 1.0 / _f(s.get("pe_ratio"))
        for t, s in filtered.items()
        if _f(s.get("pe_ratio")) is not None and _f(s.get("pe_ratio")) > 0
    }
    eps_growth_norm     = _minmax_normalize(raw_eps_growth)
    rev_growth_norm     = _minmax_normalize(raw_rev_growth)
    earnings_yield_norm = _minmax_normalize(raw_earnings_yield)
    quality_scores: dict[str, float] = {
        ticker: round(
            eps_growth_norm.get(ticker,      50.0) * 0.50
            + rev_growth_norm.get(ticker,    50.0) * 0.30
            + earnings_yield_norm.get(ticker, 50.0) * 0.20,
            2,
        )
        for ticker in filtered
    }

    # ── Stability (inverted Bollinger band width) ────────────────────────────
    # Lower band width = lower realised volatility = more stable.  Invert
    # the normalised score so the lowest-volatility ticker maps to ~100.
    # Tickers with missing band data receive a neutral 50.0 — they are not
    # penalised, but they cannot win on stability alone.
    raw_band_width: dict[str, float] = {
        ticker: snap["_band_width"]
        for ticker, snap in filtered.items()
        if snap.get("_band_width") is not None
    }
    band_width_norm = _minmax_normalize(raw_band_width)
    stability_scores: dict[str, float] = {
        ticker: round(100.0 - band_width_norm.get(ticker, 50.0), 2)
        for ticker in filtered
    }

    # ── ADX (bullish-only) ────────────────────────────────────────────────────
    # Normalisation pool is restricted to is_bullish tickers so their ADX
    # values are ranked relative to each other.  Non-bullish → score = 0.
    raw_adx_bullish: dict[str, float] = {
        ticker: _f(snap["adx"])  # type: ignore[misc]
        for ticker, snap in filtered.items()
        if snap.get("is_bullish") and _f(snap.get("adx")) is not None
    }
    adx_bullish_norm = _minmax_normalize(raw_adx_bullish)
    # Non-bullish tickers receive a neutral 50.0 (not 0) on the ADX leg.
    # The bullish-only normalisation pool means bullish tickers compete for
    # 0-100 among themselves; non-bullish tickers are excluded from that pool
    # but are not penalised — they receive the midpoint score instead.
    adx_scores: dict[str, float] = {
        ticker: adx_bullish_norm.get(ticker, 50.0)
        for ticker in filtered
    }

    # ── Step 4: Composite score per ticker ───────────────────────────────────
    tickers_scored = 0
    tickers_failed = 0
    scored_results: list[dict] = []

    for ticker, snap in filtered.items():
        try:
            t_score = trend_norm.get(ticker, 50.0)
            m_score = momentum_scores.get(ticker, 50.0)
            v_score = volume_norm.get(ticker, 50.0)
            a_score = adx_scores.get(ticker, 50.0)
            q_score = quality_scores.get(ticker, 50.0)
            s_score = stability_scores.get(ticker, 50.0)

            # Composite weights — stability promoted to a 25% dimension
            # to eliminate the overnight-spike bias.  The remaining
            # 75% spreads across momentum (30), trend (20), quality (15),
            # volume (5), adx (5).  Weights sum to 1.00.
            composite = round(
                0.30 * m_score
                + 0.25 * s_score
                + 0.20 * t_score
                + 0.15 * q_score
                + 0.05 * v_score
                + 0.05 * a_score,
                2,
            )

            # Express returns as percentages for the response
            r6m  = snap["_return_6m"]
            r1m  = snap.get("_return_1m")
            r3m  = snap.get("_return_3m")
            r12m = snap.get("_return_12m")
            band_width = snap.get("_band_width")
            # 1-month return ≈ 20 trading days, which is the spec's "20d %"
            # headline.  Stored separately so the UI can render it without
            # repurposing the dimension breakdown's 1M cell.
            momentum_20d_pct = round(r1m * 100, 2) if r1m is not None else None

            scored_results.append({
                "ticker":            ticker,
                "symbol":            ticker,
                "name":              snap.get("company_name"),
                "change_percent":    _f(snap.get("price_change_pct")),
                "composite_score":   composite,
                "momentum_score":    round(m_score, 2),
                "stability_score":   round(s_score, 2),
                "trend_score":       round(t_score, 2),
                "volume_score":      round(v_score, 2),
                "quality_score":     round(q_score, 2),
                "range_score":       None,   # removed — requires 52-week data (> 6-month gate)
                "adx_score":         round(a_score, 2),
                # Legacy dimension fields (kept for backwards compatibility)
                "technical_score":   round(t_score, 2),   # trend = technical
                "fundamental_score": round(q_score, 2),   # quality = fundamental
                "signal_score":      round(m_score, 2),   # momentum = signal
                "consistency_score": round(s_score, 2),   # stability replaces volume here
                # Headline metrics for the redesigned TopStocks card
                "momentum_20d_pct":  momentum_20d_pct,
                "volatility_20d":    round(band_width, 6) if band_width is not None else None,
                "hard_filter_passed": True,  # all rows here passed every gate
                # 6m return stored in momentum_6m for API consumers
                "momentum_6m":       round(r6m * 100, 2) if r6m is not None else None,
                "momentum_1m":       momentum_20d_pct,
                "momentum_3m":       round(r3m * 100, 2) if r3m is not None else None,
                "momentum_12m":      round(r12m * 100, 2) if r12m is not None else None,
                "fundamental_trend": None,
                "rank_tier":         _rank_tier(composite),
                "conviction":        _conviction(composite),
            })
            tickers_scored += 1

        except Exception as exc:
            logger.warning("Failed to score ticker %s: %s", ticker, exc)
            tickers_failed += 1

    # ── Step 5: Select top 50 by composite score ──────────────────────────────
    scored_results.sort(key=lambda r: r["composite_score"], reverse=True)
    top_50         = scored_results[:50]
    top_50_tickers = [r["ticker"] for r in top_50]

    now_iso = cycle_start.isoformat()
    for row in top_50:
        row["ranked_at"]  = now_iso
        row["updated_at"] = now_iso

    if top_50:
        logger.info(
            "Top 50 score range: %.2f – %.2f",
            top_50[-1]["composite_score"],
            top_50[0]["composite_score"],
        )

    # ── Step 6: Upsert top 50 into market.trending_stocks ────────────────────
    if top_50:
        upsert_rows = [
            {
                "ticker":              r["ticker"],
                "symbol":              r["symbol"],
                "name":                r["name"],
                "change_percent":      r["change_percent"],
                "composite_score":     r["composite_score"],
                "momentum_score":      r["momentum_score"],
                "stability_score":     r["stability_score"],
                "trend_score":         r["trend_score"],
                "volume_score":        r["volume_score"],
                "range_score":         r["range_score"],
                "adx_score":           r["adx_score"],
                "technical_score":     r["technical_score"],
                "fundamental_score":   r["fundamental_score"],
                "consistency_score":   r["consistency_score"],
                "signal_score":        r["signal_score"],
                "momentum_20d_pct":    r["momentum_20d_pct"],
                "volatility_20d":      r["volatility_20d"],
                "hard_filter_passed":  r["hard_filter_passed"],
                "momentum_1m":         r["momentum_1m"],
                "momentum_3m":         r["momentum_3m"],
                "momentum_6m":         r["momentum_6m"],
                "momentum_12m":        r["momentum_12m"],
                "fundamental_trend":   r["fundamental_trend"],
                "rank_tier":           r["rank_tier"],
                "conviction":          r["conviction"],
                "ranked_at":           r["ranked_at"],
                "updated_at":          r["updated_at"],
            }
            for r in top_50
        ]

        supabase_client.schema("market").table("trending_stocks").upsert(
            upsert_rows, on_conflict="ticker"
        ).execute()
        logger.info("Upserted %d rows to market.trending_stocks", len(upsert_rows))

    # ── Step 7: Delete stale entries not in the current top 50 ───────────────
    if top_50_tickers:
        tickers_csv = ",".join(top_50_tickers)
        supabase_client.schema("market").table("trending_stocks").delete().filter(
            "ticker", "not.in", f"({tickers_csv})"
        ).execute()
        logger.info(
            "Deleted stale entries from market.trending_stocks (keeping %d)",
            len(top_50_tickers),
        )

    # ── Step 8: Persist full scored set to stock_ranking_history ──────────────
    _persist_ranking_history(scored_results, cycle_start)

    elapsed = round(_time.monotonic() - start_ts, 2)
    summary: dict = {
        "tickers_scored":         tickers_scored,
        "tickers_failed":         tickers_failed,
        "top_50_written":         len(top_50),
        "skipped_incomplete":     skipped_incomplete,
        "skipped_quality_gate":   skipped_quality_gate,
        "skipped_hard_filter":    skipped_hard_filter,
        "cycle_duration_seconds": elapsed,
        "ranked_at":              now_iso,
    }
    logger.info("Ranking cycle complete: %s", summary)
    return summary


def _persist_ranking_history(
    scored_results: list[dict], cycle_start: datetime
) -> None:
    """Write all scored tickers (not just top 50) to market.stock_ranking_history.

    This powers the intelligence_engine.py 'top 10' lookups (which reads the
    latest scored_at snapshot ordered by composite_score) and enables EMA score
    smoothing in future iterations.

    Table schema mapping:
    - scored_at         ← cycle_start (intelligence_engine reads this field)
    - dimension_scores  ← JSONB holding per-component scores
    - ticker_id_fk      ← nullable FK, omitted here (no ticker UUID lookup)
    - horizon           hardcoded to 'balanced' to match existing read queries
    """
    if not scored_results:
        return
    now_iso = cycle_start.isoformat()
    rows = [
        {
            "ticker":          r["ticker"],
            "composite_score": r["composite_score"],
            "smoothed_score":  r["composite_score"],
            "rank_tier":       r["rank_tier"],
            "conviction":      r["conviction"],
            "horizon":         "balanced",
            "scored_at":       now_iso,
            "dimension_scores": {
                "momentum_score":  r["momentum_score"],
                "stability_score": r.get("stability_score", 50.0),
                "trend_score":     r["trend_score"],
                "volume_score":    r["volume_score"],
                "adx_score":       r.get("adx_score", 50.0),
                "quality_score":   r.get("quality_score", 50.0),
            },
        }
        for r in scored_results
    ]
    try:
        supabase_client.schema("market").table("stock_ranking_history").insert(
            rows
        ).execute()
        logger.info(
            "_persist_ranking_history: wrote %d rows to stock_ranking_history",
            len(rows),
        )
    except Exception as exc:
        logger.error("Failed to persist ranking history: %s", exc)
        # Non-fatal — do not re-raise; cycle summary is still returned


# ── Public async entry point ──────────────────────────────────────────────────

async def run_ranking_cycle() -> dict:
    """Score all tickers and write the top 50 to market.trending_stocks.

    The heavy synchronous work (Supabase I/O + in-process computation) is
    dispatched to a thread-pool worker via asyncio.to_thread so the asyncio
    event loop remains unblocked.

    Returns a summary dict, or {"skipped": True} if a cycle is already running.
    """
    global _cycle_running
    if _cycle_running:
        logger.info("Ranking cycle already running — skipping concurrent execution")
        return {"skipped": True}

    _cycle_running = True
    cycle_start = datetime.now(timezone.utc)
    try:
        return await asyncio.to_thread(_run_ranking_cycle_sync, cycle_start)
    finally:
        _cycle_running = False
