# backend/websearch_service/app/services/ranking_engine.py
"""Stock Ranking Engine — scheduled batch scorer.

Runs daily at 01:00 UTC (via APScheduler) to score all tickers using the
composite formula derived entirely from market.stock_snapshots indicators.
Writes the top 50 to market.trending_stocks.

Scoring formula (weights):
  trend_score     30%  — (price_vs_sma_50 * 0.5) + (price_vs_sma_200 * 0.5), normalised
  momentum_score  30%  — normalise(rsi_14) * 0.5 + normalise(macd_histogram) * 0.5
  volume_score    20%  — normalise(volume / avg_volume_10d)
  range_score     10%  — normalise((close - low_52w) / (high_52w - low_52w))
  adx_score       10%  — normalise(adx) where is_bullish=True, else 0

Hard filters (applied before scoring):
  - is_overbought == True  → excluded
  - is_oversold  == True   → excluded
  - adx < 20               → excluded (ranging market)
  - volume / avg_volume_10d < 0.8 → excluded (thin volume)

Design constraints
──────────────────
- Single data source: market.stock_snapshots (one row per ticker, always latest).
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
# NOTE: Single-process guard against overlapping daily cycles.
# For multi-replica deployments replace with a distributed lock
# (e.g. Supabase advisory lock or Redis SETNX).
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

    Guard: if max == min (all tickers have the same value), all scores = default.
    This prevents a division-by-zero and keeps the output semantically neutral.
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

    This is the single data source for the entire ranking cycle.
    One row per ticker — always represents the latest available data.

    Returns: {ticker: row}
    """
    result = (
        _tbl("market", "stock_snapshots")
        .select(
            "ticker, company_name, price_change_pct, "
            "last_price, volume, avg_volume_10d, "
            "rsi_14, macd_histogram, "
            "adx, is_bullish, "
            "high_52w, low_52w, "
            "price_vs_sma_50, price_vs_sma_200, "
            "is_overbought, is_oversold"
        )
        .limit(600)
        .execute()
    )
    rows = result.data or []
    by_ticker = {row["ticker"]: row for row in rows if row.get("ticker")}
    logger.info("_fetch_indicators_snapshot: %d tickers", len(by_ticker))
    return by_ticker


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

    # ── Step 1: Bulk-fetch all indicators from market.stock_snapshots ─────────
    snapshots = _fetch_indicators_snapshot()
    logger.info("Loaded snapshots for %d unique tickers", len(snapshots))

    # ── Step 2: Hard filters ──────────────────────────────────────────────────
    # Recalculate volume_ratio as volume / avg_volume_10d (the stored
    # volume_ratio column has a pipeline bug with values like 0.0014).
    # Exclude tickers that fail any hard filter before scoring.
    filtered: dict[str, dict] = {}

    for ticker, snap in snapshots.items():
        # Filter 1 & 2: exclude overbought / oversold
        if snap.get("is_overbought") or snap.get("is_oversold"):
            continue

        # Filter 3: exclude ranging markets (ADX < 20)
        adx = _f(snap.get("adx"))
        if adx is None or adx < 20:
            continue

        # Filter 4: exclude thin volume (recalculated volume_ratio < 0.8)
        volume = _f(snap.get("volume"))
        avg_vol_10d = _f(snap.get("avg_volume_10d"))
        if volume is None or avg_vol_10d is None or avg_vol_10d <= 0:
            continue
        recalc_ratio = volume / avg_vol_10d
        if recalc_ratio < 0.8:
            continue

        # Cache the recalculated ratio for use in volume scoring
        snap["_recalc_volume_ratio"] = recalc_ratio
        filtered[ticker] = snap

    logger.info(
        "After hard filters: %d / %d tickers remain",
        len(filtered), len(snapshots),
    )

    if not filtered:
        logger.warning("No tickers passed hard filters — ranking cycle produced no results")
        elapsed = round(_time.monotonic() - start_ts, 2)
        return {
            "tickers_scored": 0,
            "tickers_failed": 0,
            "top_50_written": 0,
            "cycle_duration_seconds": elapsed,
            "ranked_at": cycle_start.isoformat(),
        }

    # ── Step 3: Component normalization across the filtered universe ──────────

    # ── Trend: (price_vs_sma_50 * 0.5) + (price_vs_sma_200 * 0.5) ───────────
    raw_trend: dict[str, float] = {}
    for ticker, snap in filtered.items():
        pvs50 = _f(snap.get("price_vs_sma_50"))
        pvs200 = _f(snap.get("price_vs_sma_200"))
        if pvs50 is not None and pvs200 is not None:
            raw_trend[ticker] = (pvs50 * 0.5) + (pvs200 * 0.5)
        elif pvs50 is not None:
            raw_trend[ticker] = pvs50
        elif pvs200 is not None:
            raw_trend[ticker] = pvs200
        # Missing both → omitted; gets default 50.0 in final assembly

    trend_norm = _minmax_normalize(raw_trend)

    # ── Momentum: normalise(rsi_14) * 0.5 + normalise(macd_histogram) * 0.5 ──
    # Normalise each component independently across the full filtered universe,
    # then combine. RSI 50-70 is the ideal range but we let min-max handle it.
    raw_rsi: dict[str, float] = {}
    raw_macd_hist: dict[str, float] = {}
    for ticker, snap in filtered.items():
        rsi = _f(snap.get("rsi_14"))
        mh = _f(snap.get("macd_histogram"))
        if rsi is not None:
            raw_rsi[ticker] = rsi
        if mh is not None:
            raw_macd_hist[ticker] = mh

    rsi_norm = _minmax_normalize(raw_rsi)
    macd_hist_norm = _minmax_normalize(raw_macd_hist)

    momentum_scores: dict[str, float] = {}
    for ticker in filtered:
        rsi_s = rsi_norm.get(ticker, 50.0)
        mh_s = macd_hist_norm.get(ticker, 50.0)
        momentum_scores[ticker] = round(rsi_s * 0.5 + mh_s * 0.5, 2)

    # ── Volume: normalise(volume / avg_volume_10d) ────────────────────────────
    # Uses the recalculated ratio cached in Step 2 (not the stored volume_ratio).
    raw_volume: dict[str, float] = {
        ticker: snap["_recalc_volume_ratio"]
        for ticker, snap in filtered.items()
    }
    volume_norm = _minmax_normalize(raw_volume)

    # ── 52-week position: (close - low_52w) / (high_52w - low_52w) ───────────
    raw_range: dict[str, float] = {}
    for ticker, snap in filtered.items():
        close = _f(snap.get("last_price"))
        low52 = _f(snap.get("low_52w"))
        high52 = _f(snap.get("high_52w"))
        if close is not None and low52 is not None and high52 is not None:
            denom = high52 - low52
            if denom > 0:
                raw_range[ticker] = (close - low52) / denom

    range_norm = _minmax_normalize(raw_range)

    # ── ADX trend strength: normalise(adx) for is_bullish=True; 0 otherwise ──
    # Only is_bullish tickers enter the normalization pool so they are ranked
    # relative to each other.  Non-bullish tickers receive adx_score = 0.
    raw_adx_bullish: dict[str, float] = {}
    for ticker, snap in filtered.items():
        if snap.get("is_bullish"):
            adx = _f(snap.get("adx"))
            if adx is not None:
                raw_adx_bullish[ticker] = adx

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
            r_score = range_norm.get(ticker, 50.0)
            a_score = adx_scores.get(ticker, 0.0)

            composite = round(
                0.30 * t_score
                + 0.30 * m_score
                + 0.20 * v_score
                + 0.10 * r_score
                + 0.10 * a_score,
                2,
            )

            scored_results.append({
                "ticker":            ticker,
                "symbol":            ticker,
                "name":              snap.get("company_name"),
                "change_percent":    _f(snap.get("price_change_pct")),
                "composite_score":   composite,
                "momentum_score":    round(m_score, 2),
                "trend_score":       round(t_score, 2),
                "volume_score":      round(v_score, 2),
                "range_score":       round(r_score, 2),
                "adx_score":         round(a_score, 2),
                # Legacy dimension fields — not produced by this scoring formula
                "technical_score":   None,
                "fundamental_score": None,
                "consistency_score": None,
                "signal_score":      None,
                "momentum_1m":       None,
                "momentum_3m":       None,
                "momentum_6m":       None,
                "momentum_12m":      None,
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
    top_50 = scored_results[:50]
    top_50_tickers = [r["ticker"] for r in top_50]

    now_iso = cycle_start.isoformat()
    for row in top_50:
        row["ranked_at"] = now_iso
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
    # .filter("ticker", "not.in", "(A,B,C)") maps to PostgREST's not.in operator.
    # This removes exactly the rows that fell out of the top 50 — it does NOT
    # wipe the whole table.
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
