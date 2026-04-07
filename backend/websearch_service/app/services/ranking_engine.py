# backend/websearch_service/app/services/ranking_engine.py
"""Stock Ranking Engine — scheduled batch scorer.

Runs daily at 01:00 UTC (via APScheduler) to score all tickers using the
composite formula derived from market.stock_snapshots indicators, biased
toward 6-month price performance.  Writes the top 50 to market.trending_stocks.

Data sources (both in the market schema, zero N+1 queries):
  market.stock_snapshots  — latest indicator snapshot per ticker
  market.stock_returns_mv — pre-computed multi-horizon price returns

Eligibility requirements (applied before scoring):
  1. Complete data  — every scoring field must be non-null
  2. 6-month history — ticker must have ≥ 126 trading days (has_6m_history = True)

Hard filters (applied after completeness check):
  - is_overbought == True          → excluded
  - is_oversold  == True           → excluded
  - adx < 20                       → excluded (ranging/sideways market)
  - volume / avg_volume_10d < 0.8  → excluded (thin volume; stored volume_ratio
                                     ignored due to pipeline bug, recalculated here)

Scoring formula (weights):
  trend_score     35%  normalise(price_vs_sma_50)
  momentum_score  35%  normalise(return_6m) * 0.50
                       + normalise(rsi_14)  * 0.25
                       + normalise(macd_histogram) * 0.25
  volume_score    20%  normalise(volume / avg_volume_10d)
  adx_score       10%  normalise(adx) if is_bullish else 0

  composite = 0.35*trend + 0.35*momentum + 0.20*volume + 0.10*adx

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

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

# ── Run lock ──────────────────────────────────────────────────────────────────
_cycle_running: bool = False


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


def _minmax_normalize(
    values: dict[str, float], default: float = 50.0
) -> dict[str, float]:
    """Min-max normalize {ticker: raw_value} → {ticker: 0-100, rounded to 2 dp}.

    If all values are identical (range == 0), every ticker gets `default`.
    """
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    rng = hi - lo
    if rng == 0:
        return {t: default for t in values}
    return {t: round((v - lo) / rng * 100.0, 2) for t, v in values.items()}


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
            "last_price, volume, avg_volume_10d, "
            "rsi_14, macd_histogram, "
            "adx, is_bullish, "
            "price_vs_sma_50, "
            "is_overbought, is_oversold"
        )
        .limit(600)
        .execute()
    )
    rows = result.data or []
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


# ── Completeness check ────────────────────────────────────────────────────────

# All fields that must be non-null for a ticker to enter scoring.
# Missing any one of these → excluded before normalisation.
_REQUIRED_SNAPSHOT_FIELDS = (
    "price_vs_sma_50",   # SMA-50 reliable within 6-month window
    "rsi_14",
    "macd_histogram",
    "volume",
    "avg_volume_10d",
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
    # Hard filters: is_overbought, is_oversold, adx < 20, thin volume.
    # Volume ratio is recalculated from raw columns (stored value has a bug).
    filtered: dict[str, dict] = {}   # snap merged with returns row
    skipped_incomplete = 0
    skipped_hard_filter = 0

    for ticker, snap in snapshots.items():
        ret_row = returns.get(ticker)

        # Completeness guard
        if not _has_complete_data(snap, ret_row):
            skipped_incomplete += 1
            continue

        # Hard filter 1 & 2: overbought / oversold
        if snap.get("is_overbought") or snap.get("is_oversold"):
            skipped_hard_filter += 1
            continue

        # Hard filter 3: ranging market (ADX < 20)
        adx = _f(snap.get("adx"))
        if adx < 20:  # type: ignore[operator]  # non-null guaranteed by completeness check
            skipped_hard_filter += 1
            continue

        # Hard filter 4: thin volume (recalculated ratio < 0.8)
        volume     = _f(snap.get("volume"))
        avg_vol_10d = _f(snap.get("avg_volume_10d"))
        recalc_ratio = volume / avg_vol_10d  # type: ignore[operator]  # non-null guaranteed
        if recalc_ratio < 0.8:
            skipped_hard_filter += 1
            continue

        # Merge returns into the snap dict for convenience
        merged = dict(snap)
        merged["_recalc_volume_ratio"] = recalc_ratio
        merged["_return_6m"]           = _f(ret_row["return_6m"])   # type: ignore[index]
        merged["_return_1m"]           = _f(ret_row.get("return_1m"))
        merged["_return_3m"]           = _f(ret_row.get("return_3m"))
        merged["_return_12m"]          = _f(ret_row.get("return_12m"))
        filtered[ticker] = merged

    logger.info(
        "After filters: %d eligible | %d incomplete | %d failed hard filters",
        len(filtered), skipped_incomplete, skipped_hard_filter,
    )

    if not filtered:
        logger.warning("No tickers passed all filters — ranking cycle produced no results")
        elapsed = round(_time.monotonic() - start_ts, 2)
        return {
            "tickers_scored": 0,
            "tickers_failed": 0,
            "top_50_written": 0,
            "cycle_duration_seconds": elapsed,
            "ranked_at": cycle_start.isoformat(),
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

    # ── Momentum (6m-biased) ──────────────────────────────────────────────────
    # return_6m drives 50% of the momentum score so that sustained 6-month
    # price performance is rewarded over short-term oscillator readings alone.
    raw_return_6m  = {t: s["_return_6m"]    for t, s in filtered.items()}  # guaranteed non-null
    raw_rsi        = {t: _f(s["rsi_14"])    for t, s in filtered.items() if _f(s.get("rsi_14"))        is not None}  # type: ignore[misc]
    raw_macd_hist  = {t: _f(s["macd_histogram"]) for t, s in filtered.items() if _f(s.get("macd_histogram")) is not None}  # type: ignore[misc]

    return_6m_norm = _minmax_normalize(raw_return_6m)   # type: ignore[arg-type]
    rsi_norm       = _minmax_normalize(raw_rsi)          # type: ignore[arg-type]
    macd_hist_norm = _minmax_normalize(raw_macd_hist)    # type: ignore[arg-type]

    momentum_scores: dict[str, float] = {
        ticker: round(
            return_6m_norm.get(ticker, 50.0) * 0.50
            + rsi_norm.get(ticker,       50.0) * 0.25
            + macd_hist_norm.get(ticker,  50.0) * 0.25,
            2,
        )
        for ticker in filtered
    }

    # ── Volume ────────────────────────────────────────────────────────────────
    raw_volume = {t: s["_recalc_volume_ratio"] for t, s in filtered.items()}
    volume_norm = _minmax_normalize(raw_volume)

    # range_score removed — high_52w / low_52w require ~252 days (> 6-month gate).

    # ── ADX (bullish-only) ────────────────────────────────────────────────────
    # Normalisation pool is restricted to is_bullish tickers so their ADX
    # values are ranked relative to each other.  Non-bullish → score = 0.
    raw_adx_bullish: dict[str, float] = {
        ticker: _f(snap["adx"])  # type: ignore[misc]
        for ticker, snap in filtered.items()
        if snap.get("is_bullish") and _f(snap.get("adx")) is not None
    }
    adx_bullish_norm = _minmax_normalize(raw_adx_bullish)
    adx_scores: dict[str, float] = {
        ticker: adx_bullish_norm.get(ticker, 0.0)
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
            a_score = adx_scores.get(ticker, 0.0)

            composite = round(
                0.35 * t_score
                + 0.35 * m_score
                + 0.20 * v_score
                + 0.10 * a_score,
                2,
            )

            # Express returns as percentages for the response
            r6m  = snap["_return_6m"]
            r1m  = snap.get("_return_1m")
            r3m  = snap.get("_return_3m")
            r12m = snap.get("_return_12m")

            scored_results.append({
                "ticker":            ticker,
                "symbol":            ticker,
                "name":              snap.get("company_name"),
                "change_percent":    _f(snap.get("price_change_pct")),
                "composite_score":   composite,
                "momentum_score":    round(m_score, 2),
                "trend_score":       round(t_score, 2),
                "volume_score":      round(v_score, 2),
                "range_score":       None,   # removed — requires 52-week data (> 6-month gate)
                "adx_score":         round(a_score, 2),
                # Legacy dimension fields
                "technical_score":   None,
                "fundamental_score": None,
                "consistency_score": None,
                "signal_score":      None,
                # 6m return stored in momentum_6m for API consumers
                "momentum_6m":       round(r6m * 100, 2) if r6m is not None else None,
                "momentum_1m":       round(r1m * 100, 2) if r1m is not None else None,
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
                "ticker":            r["ticker"],
                "symbol":            r["symbol"],
                "name":              r["name"],
                "change_percent":    r["change_percent"],
                "composite_score":   r["composite_score"],
                "momentum_score":    r["momentum_score"],
                "trend_score":       r["trend_score"],
                "volume_score":      r["volume_score"],
                "range_score":       r["range_score"],
                "adx_score":         r["adx_score"],
                "technical_score":   r["technical_score"],
                "fundamental_score": r["fundamental_score"],
                "consistency_score": r["consistency_score"],
                "signal_score":      r["signal_score"],
                "momentum_1m":       r["momentum_1m"],
                "momentum_3m":       r["momentum_3m"],
                "momentum_6m":       r["momentum_6m"],
                "momentum_12m":      r["momentum_12m"],
                "fundamental_trend": r["fundamental_trend"],
                "rank_tier":         r["rank_tier"],
                "conviction":        r["conviction"],
                "ranked_at":         r["ranked_at"],
                "updated_at":        r["updated_at"],
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

    elapsed = round(_time.monotonic() - start_ts, 2)
    summary: dict = {
        "tickers_scored":         tickers_scored,
        "tickers_failed":         tickers_failed,
        "top_50_written":         len(top_50),
        "skipped_incomplete":     skipped_incomplete,
        "skipped_hard_filter":    skipped_hard_filter,
        "cycle_duration_seconds": elapsed,
        "ranked_at":              now_iso,
    }
    logger.info("Ranking cycle complete: %s", summary)
    return summary


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
