# backend/websearch_service/app/services/ranking_engine.py
"""Stock Ranking Engine — scheduled batch scorer.

Runs daily at 01:00 UTC (via APScheduler) to score all 507 tickers across
5 dimensions using one year of historical data, then writes the top 50 to
market.trending_stocks.

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
import statistics
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


# ── Bulk data fetching ────────────────────────────────────────────────────────
# All four fetches run before the scoring loop — zero Supabase queries inside
# the per-ticker loop.

def _fetch_price_history() -> dict[str, list[dict]]:
    """Bulk-fetch last 252 trading days of price history for all tickers.

    Single query; 507 × 252 ≈ 127,764 expected rows.
    Returns: {ticker: [rows sorted ascending by date]}
    """
    result = (
        _tbl("market", "stock_price_history")
        .select(
            "ticker, date, close, volume, rsi_14, macd, macd_histogram, "
            "adx, sma_50, sma_200, bollinger_upper, bollinger_lower, "
            "is_bullish, is_oversold, is_overbought"
        )
        .order("date", desc=False)
        .limit(150000)  # safety cap; 507 × 252 = 127,764 rows expected
        .execute()
    )
    rows = result.data or []

    by_ticker: dict[str, list[dict]] = {}
    for row in rows:
        t = row.get("ticker")
        if not t:
            continue
        if t not in by_ticker:
            by_ticker[t] = []
        by_ticker[t].append(row)

    # Trim to the last 252 rows per ticker (already asc-ordered → take tail)
    for t in list(by_ticker):
        if len(by_ticker[t]) > 252:
            by_ticker[t] = by_ticker[t][-252:]

    logger.info("_fetch_price_history: %d rows across %d tickers", len(rows), len(by_ticker))
    return by_ticker


def _fetch_fundamentals() -> dict[str, list[dict]]:
    """Bulk-fetch last 252 days of fundamentals for all tickers.

    Single query.
    Returns: {ticker: [rows sorted ascending by date]}
    """
    result = (
        _tbl("market", "stock_fundamentals_history")
        .select(
            "ticker, date, pe_ratio, forward_pe, peg_ratio, "
            "eps_growth, revenue_growth, market_cap"
        )
        .order("date", desc=False)
        .limit(150000)
        .execute()
    )
    rows = result.data or []

    by_ticker: dict[str, list[dict]] = {}
    for row in rows:
        t = row.get("ticker")
        if not t:
            continue
        if t not in by_ticker:
            by_ticker[t] = []
        by_ticker[t].append(row)

    for t in list(by_ticker):
        if len(by_ticker[t]) > 252:
            by_ticker[t] = by_ticker[t][-252:]

    logger.info("_fetch_fundamentals: %d rows across %d tickers", len(rows), len(by_ticker))
    return by_ticker


def _fetch_snapshots() -> dict[str, dict]:
    """Bulk-fetch current snapshot for all tickers.

    Single query.
    Returns: {ticker: row}
    """
    result = (
        _tbl("market", "stock_snapshots")
        .select(
            "ticker, last_price, price_change_pct, high_52w, low_52w, "
            "signal_confidence, is_bullish, company_name"
        )
        .limit(600)
        .execute()
    )
    rows = result.data or []
    by_ticker = {row["ticker"]: row for row in rows if row.get("ticker")}
    logger.info("_fetch_snapshots: %d tickers", len(by_ticker))
    return by_ticker


def _fetch_stock_returns() -> dict[str, dict]:
    """Bulk-fetch pre-computed returns from market.stock_returns_mv.

    Single query.
    Returns: {ticker: row}
    """
    result = (
        _tbl("market", "stock_returns_mv")
        .select(
            "ticker, return_1m, return_3m, return_6m, return_12m, "
            "has_1m_history, has_3m_history, has_6m_history, "
            "has_12m_history, total_trading_days"
        )
        .execute()
    )
    rows = result.data or []
    by_ticker = {row["ticker"]: row for row in rows if row.get("ticker")}
    logger.info("_fetch_stock_returns: %d tickers", len(by_ticker))
    return by_ticker


# ── Dimension 1: Multi-horizon momentum (weight 30%) ─────────────────────────

def _score_momentum(
    returns_by_ticker: dict[str, dict],
) -> dict[str, dict]:
    """Score tickers on multi-horizon price momentum.

    Reads pre-computed returns from market.stock_returns_mv.
    Horizons: 1m, 3m, 6m, 12m.

    Weight schedules:
    - Full history (12m available):
        1m×0.15 + 3m×0.25 + 6m×0.35 + 12m×0.25  (sums to 1.00)
    - Insufficient 12m history (return_12m is None):
        1m×0.20 + 3m×0.35 + 6m×0.45              (sums to 1.00)
    - Insufficient 1m history (return_1m is None, < 21 trading days):
        ticker excluded from momentum scoring entirely.

    Returns: {ticker: {momentum_score, momentum_1m, momentum_3m,
                        momentum_6m, momentum_12m}}
    """
    raw_momentum: dict[str, float] = {}
    details: dict[str, dict] = {}
    neutral_tickers: list[str] = []  # < 21 trading days — neutral score, not excluded

    for ticker, row in returns_by_ticker.items():
        r1m  = _f(row.get("return_1m"))
        r3m  = _f(row.get("return_3m"))
        r6m  = _f(row.get("return_6m"))
        r12m = _f(row.get("return_12m"))

        momentum_1m  = r1m  * 100 if r1m  is not None else None
        momentum_3m  = r3m  * 100 if r3m  is not None else None
        momentum_6m  = r6m  * 100 if r6m  is not None else None
        momentum_12m = r12m * 100 if r12m is not None else None

        # < 21 trading days: assign neutral score 50.0, exclude from normalization pool
        if momentum_1m is None:
            neutral_tickers.append(ticker)
            continue

        # Weighted momentum raw score
        if momentum_12m is None:
            # Insufficient 12m history — redistribute weights to 1m/3m/6m
            momentum_raw = (
                (momentum_1m          * 0.20)
                + ((momentum_3m or 0.0) * 0.35)
                + ((momentum_6m or 0.0) * 0.45)
            )
        else:
            momentum_raw = (
                (momentum_1m          * 0.15)
                + ((momentum_3m or 0.0) * 0.25)
                + ((momentum_6m or 0.0) * 0.35)
                + (momentum_12m        * 0.25)
            )

        raw_momentum[ticker] = momentum_raw
        details[ticker] = {
            "momentum_1m":  round(momentum_1m,  2),
            "momentum_3m":  round(momentum_3m,  2) if momentum_3m  is not None else None,
            "momentum_6m":  round(momentum_6m,  2) if momentum_6m  is not None else None,
            "momentum_12m": round(momentum_12m, 2) if momentum_12m is not None else None,
        }

    normalized = _minmax_normalize(raw_momentum)

    result: dict[str, dict] = {
        ticker: {
            "momentum_score": normalized[ticker],
            **details[ticker],
        }
        for ticker in normalized
        if ticker in details
    }

    # Tickers with < 21 trading days get a neutral score; they are not
    # included in the normalization pool but ARE present in the result so
    # that momentum_1m–12m are written as None to trending_stocks.
    for ticker in neutral_tickers:
        result[ticker] = {
            "momentum_score": 50.0,
            "momentum_1m":    None,
            "momentum_3m":    None,
            "momentum_6m":    None,
            "momentum_12m":   None,
        }

    return result


# ── Dimension 2: Technical quality (weight 20%) ───────────────────────────────

def _score_technical(price_history: dict[str, list[dict]]) -> dict[str, float]:
    """Score tickers on technical indicator quality over the last 20 days.

    Components: RSI, trend (is_bullish), MACD histogram, ADX, Bollinger bands.
    ADX is universe-normalised before combining, everything else is computed
    as a 0-100 ratio within the ticker's own window.

    Returns: {ticker: technical_score (0-100)}
    """
    partial: dict[str, dict] = {}  # pre-norm per-ticker components
    raw_adx: dict[str, float] = {}  # collected for universe normalisation

    for ticker, rows in price_history.items():
        if not rows:
            continue

        recent_20 = rows[-20:] if len(rows) >= 20 else rows
        if not recent_20:
            continue
        n20 = len(recent_20)

        # ── RSI score ─────────────────────────────────────────────────────────
        rsi_vals = [v for v in (_f(r.get("rsi_14")) for r in recent_20) if v is not None]
        avg_rsi = sum(rsi_vals) / len(rsi_vals) if rsi_vals else None

        if avg_rsi is None:
            rsi_score = 50.0
        elif 50 <= avg_rsi <= 70:
            rsi_score = 100.0
        elif (40 <= avg_rsi < 50) or (70 < avg_rsi <= 80):
            rsi_score = 50.0
        else:
            rsi_score = 20.0

        # ── Trend score: % of last 20 days where is_bullish = True ────────────
        bullish_count = sum(1 for r in recent_20 if r.get("is_bullish") is True)
        trend_score = (bullish_count / n20) * 100

        # ── MACD score: % of last 20 days where macd_histogram > 0 ────────────
        macd_positive = sum(
            1 for r in recent_20
            if (v := _f(r.get("macd_histogram"))) is not None and v > 0
        )
        macd_score = (macd_positive / n20) * 100

        # ── ADX: average over last 20 days (universe-normalised later) ─────────
        adx_vals = [v for v in (_f(r.get("adx")) for r in recent_20) if v is not None]
        if adx_vals:
            avg_adx = sum(adx_vals) / len(adx_vals)
            raw_adx[ticker] = avg_adx

        # ── Bollinger bands: % days close inside bands ─────────────────────────
        bb_inside = bb_total = 0
        for r in recent_20:
            close    = _f(r.get("close"))
            bb_upper = _f(r.get("bollinger_upper"))
            bb_lower = _f(r.get("bollinger_lower"))
            if close is not None and bb_upper is not None and bb_lower is not None:
                bb_total += 1
                if bb_lower <= close <= bb_upper:
                    bb_inside += 1
        bb_score = (bb_inside / bb_total * 100) if bb_total > 0 else 50.0

        partial[ticker] = {
            "rsi_score":   rsi_score,
            "trend_score": trend_score,
            "macd_score":  macd_score,
            "bb_score":    bb_score,
        }

    # Normalise ADX across the universe before combining
    adx_norm = _minmax_normalize(raw_adx)

    final_raw: dict[str, float] = {}
    for ticker, p in partial.items():
        adx_score = adx_norm.get(ticker, 50.0)
        final_raw[ticker] = (
            p["rsi_score"]   * 0.25
            + p["trend_score"] * 0.25
            + p["macd_score"]  * 0.20
            + adx_score        * 0.15
            + p["bb_score"]    * 0.15
        )

    return _minmax_normalize(final_raw)


# ── Dimension 3: Fundamental quality (weight 25%) ─────────────────────────────

def _score_fundamental(
    fundamentals: dict[str, list[dict]],
) -> dict[str, dict]:
    """Score tickers on fundamental quality using the most recent row.

    Components: inverse-PE (lower PE = better), average growth, inverse-PEG.
    Fundamental trend compares current eps_growth to the row from 180 days ago.

    Returns: {ticker: {fundamental_score (0-100), fundamental_trend}}
    """
    raw_pe_inv:  dict[str, float] = {}
    raw_growth:  dict[str, float] = {}
    raw_peg_inv: dict[str, float] = {}
    trends:      dict[str, str]   = {}

    for ticker, rows in fundamentals.items():
        if not rows:
            continue

        current       = rows[-1]
        current_eps_g = _f(current.get("eps_growth"))

        # ── PE score: lower PE = better; cap at 100; invert ───────────────────
        pe = _f(current.get("pe_ratio"))
        if pe is not None and pe > 0:
            raw_pe_inv[ticker] = 1.0 / min(pe, 100.0)
        # Negative or zero PE → absent from raw_pe_inv → gets score 0 below

        # ── Growth score: (eps_growth + revenue_growth) / 2, positive only ────
        rev_g = _f(current.get("revenue_growth"))
        if current_eps_g is not None and rev_g is not None:
            avg_g = (current_eps_g + rev_g) / 2.0
            if avg_g > 0:
                raw_growth[ticker] = avg_g
        elif current_eps_g is not None and current_eps_g > 0:
            raw_growth[ticker] = current_eps_g
        elif rev_g is not None and rev_g > 0:
            raw_growth[ticker] = rev_g
        # Negative growth → absent → score 0

        # ── PEG score: lower PEG = better; cap at 5; invert ───────────────────
        peg = _f(current.get("peg_ratio"))
        if peg is not None and peg > 0:
            raw_peg_inv[ticker] = 1.0 / min(peg, 5.0)
        # PEG <= 0 → absent → score 0

        # ── Fundamental trend: compare current eps_growth vs 180 days ago ──────
        # rows is sorted ascending; 180 trading days back = rows[-181]
        if current_eps_g is not None and len(rows) >= 2:
            old_row   = rows[max(0, len(rows) - 181)]  # correctly 180 rows before last
            old_eps_g = _f(old_row.get("eps_growth"))
            if old_eps_g is not None:
                delta = current_eps_g - old_eps_g
                if delta > 5:
                    trends[ticker] = "improving"
                elif delta < -5:
                    trends[ticker] = "deteriorating"
                else:
                    trends[ticker] = "stable"
            else:
                trends[ticker] = "stable"
        else:
            trends[ticker] = "stable"

    # Normalise each component across the universe
    pe_scores     = _minmax_normalize(raw_pe_inv)   # higher inv-PE = better
    growth_scores = _minmax_normalize(raw_growth)
    peg_scores    = _minmax_normalize(raw_peg_inv)  # higher inv-PEG = better

    # Combine for every ticker present in fundamentals.
    # Tickers absent from a component dict receive 0 for that component
    # (consistent with the spec: negative PE → score 0).
    raw_fund: dict[str, float] = {}
    for ticker in set(fundamentals):
        raw_fund[ticker] = (
            pe_scores.get(ticker,     0.0) * 0.30
            + growth_scores.get(ticker, 0.0) * 0.45
            + peg_scores.get(ticker,    0.0) * 0.25
        )

    normalized = _minmax_normalize(raw_fund)

    return {
        ticker: {
            "fundamental_score": normalized.get(ticker, 50.0),
            "fundamental_trend": trends.get(ticker, "stable"),
        }
        for ticker in normalized
    }


# ── Dimension 4: Consistency (weight 15%) ─────────────────────────────────────

def _score_consistency(price_history: dict[str, list[dict]]) -> dict[str, float]:
    """Score tickers on return consistency over 90 trading days.

    Components:
    - volatility_90d (std dev of daily returns, last 90 days) — lower = better
    - positive_days_ratio (last 90 days)
    Also computes volatility_30d for completeness (not in the formula).

    Returns: {ticker: consistency_score (0-100)}
    """
    raw_vol_90: dict[str, float] = {}
    raw_pos_90: dict[str, float] = {}

    for ticker, rows in price_history.items():
        if len(rows) < 2:
            continue

        closes = [_f(r.get("close")) for r in rows]
        daily_returns: list[float] = []
        for i in range(1, len(closes)):
            c_prev, c_curr = closes[i - 1], closes[i]
            if c_prev is not None and c_curr is not None and c_prev != 0:
                daily_returns.append((c_curr - c_prev) / c_prev)

        if len(daily_returns) < 2:
            continue

        returns_90 = daily_returns[-90:]
        returns_30 = daily_returns[-30:]  # computed; not in formula (short-term vol)

        # volatility_90d
        if len(returns_90) >= 2:
            try:
                vol_90 = statistics.stdev(returns_90)
                if vol_90 > 0:
                    raw_vol_90[ticker] = vol_90
            except statistics.StatisticsError:
                pass

        # volatility_30d (short-term, computed but not used in consistency formula)
        if len(returns_30) >= 2:
            try:
                _vol_30 = statistics.stdev(returns_30)  # noqa: F841
            except statistics.StatisticsError:
                pass

        # Positive days ratio (90d)
        if returns_90:
            pos_days = sum(1 for r in returns_90 if r > 0)
            raw_pos_90[ticker] = pos_days / len(returns_90)

    # Lower volatility = higher score: normalise, then invert
    vol_norm   = _minmax_normalize(raw_vol_90)
    vol_scores = {t: round(100.0 - v, 2) for t, v in vol_norm.items()}

    # Higher positive-days ratio = higher score (no inversion needed)
    pos_scores = _minmax_normalize(raw_pos_90)

    all_tickers = set(vol_scores) | set(pos_scores)
    raw_consistency: dict[str, float] = {}
    for ticker in all_tickers:
        v = vol_scores.get(ticker, 50.0)
        p = pos_scores.get(ticker, 50.0)
        raw_consistency[ticker] = (v * 0.60) + (p * 0.40)

    # Debug: log a sample of raw values before normalization so we can
    # distinguish genuinely flat data from a normalization collapse.
    logger.debug(
        "Consistency raw sample: %s",
        dict(list(raw_consistency.items())[:5]),
    )

    # Flat-data guard: if all raw consistency values are essentially identical
    # (stdev < 0.001), normalization would collapse them all to the default
    # anyway — log a warning and short-circuit rather than silently returning 50.
    if len(raw_consistency) > 1:
        try:
            consistency_stddev = statistics.stdev(raw_consistency.values())
            if consistency_stddev < 0.001:
                logger.warning(
                    "Consistency raw values are flat (stdev=%.6f across %d tickers) "
                    "— setting all consistency scores to 50.0; check price history data",
                    consistency_stddev,
                    len(raw_consistency),
                )
                return {t: 50.0 for t in raw_consistency}
        except statistics.StatisticsError:
            pass

    return _minmax_normalize(raw_consistency)


# ── Dimension 5: Signal quality (weight 10%) ──────────────────────────────────

def _score_signal(snapshots: dict[str, dict]) -> dict[str, float]:
    """Score tickers on AI signal quality from the current snapshot.

    Returns: {ticker: signal_score (0-100)}
    """
    raw_signal: dict[str, float] = {}

    for ticker, snap in snapshots.items():
        conf      = _f(snap.get("signal_confidence"))
        is_bull   = snap.get("is_bullish")

        conf_score    = (conf * 100) if conf is not None else 50.0
        bullish_score = 100.0 if is_bull else 0.0

        raw_signal[ticker] = (conf_score * 0.70) + (bullish_score * 0.30)

    return _minmax_normalize(raw_signal)


# ── Conviction and tier classification ───────────────────────────────────────

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


def _conviction(
    composite: float,
    consistency: float,
    dimension_scores: list[float],
) -> str:
    dims_above_60 = sum(1 for s in dimension_scores if s >= 60)
    if composite >= 70 and consistency >= 65 and dims_above_60 >= 3:
        return "High"
    elif composite >= 50 and consistency >= 45:
        return "Medium"
    return "Low"


# ── Core sync implementation (runs in a thread pool) ─────────────────────────

def _run_ranking_cycle_sync(cycle_start: datetime) -> dict:
    """Full ranking cycle: fetch → score → upsert top 50 → delete stale.

    Designed to run in asyncio.to_thread() so the event loop is never blocked.
    Returns a summary dict.
    """
    start_ts = _time.monotonic()
    logger.info("Ranking cycle starting")

    # ── Step 1: Bulk-fetch (zero queries inside the scoring loop) ─────────────
    price_history  = _fetch_price_history()
    fundamentals   = _fetch_fundamentals()
    snapshots      = _fetch_snapshots()
    stock_returns  = _fetch_stock_returns()

    all_tickers = set(price_history) | set(fundamentals) | set(snapshots) | set(stock_returns)
    logger.info("Loaded data for %d unique tickers", len(all_tickers))

    # ── Step 2: Score all five dimensions across the full universe ────────────
    # Each scorer performs its own bulk computation and returns a dict keyed
    # by ticker.  All normalization happens before per-ticker composite assembly.
    logger.info("Scoring 5 dimensions...")
    momentum_scores    = _score_momentum(stock_returns)
    technical_scores   = _score_technical(price_history)
    fundamental_scores = _score_fundamental(fundamentals)
    consistency_scores = _score_consistency(price_history)
    signal_scores      = _score_signal(snapshots)

    # ── Step 3: Composite score per ticker ───────────────────────────────────
    tickers_scored = 0
    tickers_failed = 0
    scored_results: list[dict] = []

    for ticker in all_tickers:
        try:
            mom_data   = momentum_scores.get(ticker)    or {}
            fund_data  = fundamental_scores.get(ticker) or {}

            mom_score  = float(mom_data.get("momentum_score",    50.0))
            tech_score = float(technical_scores.get(ticker,      50.0))
            fund_score = float(fund_data.get("fundamental_score", 50.0))
            cons_score = float(consistency_scores.get(ticker,    50.0))
            sig_score  = float(signal_scores.get(ticker,         50.0))

            composite = round(
                mom_score  * 0.30
                + tech_score * 0.20
                + fund_score * 0.25
                + cons_score * 0.15
                + sig_score  * 0.10,
                2,
            )

            snap = snapshots.get(ticker) or {}

            scored_results.append({
                "ticker":            ticker,
                "symbol":            ticker,
                "name":              snap.get("company_name"),
                "change_percent":    _f(snap.get("price_change_pct")),
                "composite_score":   composite,
                "momentum_score":    round(mom_score,  2),
                "technical_score":   round(tech_score, 2),
                "fundamental_score": round(fund_score, 2),
                "consistency_score": round(cons_score, 2),
                "signal_score":      round(sig_score,  2),
                "momentum_1m":       mom_data.get("momentum_1m"),
                "momentum_3m":       mom_data.get("momentum_3m"),
                "momentum_6m":       mom_data.get("momentum_6m"),
                "momentum_12m":      mom_data.get("momentum_12m"),
                "fundamental_trend": fund_data.get("fundamental_trend", "stable"),
                "rank_tier":         _rank_tier(composite),
                "conviction":        _conviction(
                    composite, cons_score,
                    [mom_score, tech_score, fund_score, cons_score, sig_score],
                ),
            })
            tickers_scored += 1

        except Exception as exc:
            logger.warning("Failed to score ticker %s: %s", ticker, exc)
            tickers_failed += 1

    # ── Step 4: Select top 50 by composite score ──────────────────────────────
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

    # ── Step 5: Upsert top 50 into market.trending_stocks ────────────────────
    if top_50:
        upsert_rows = [
            {
                "ticker":            r["ticker"],
                "symbol":            r["symbol"],
                "name":              r["name"],
                "change_percent":    r["change_percent"],
                "composite_score":   r["composite_score"],
                "momentum_score":    r["momentum_score"],
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

    # ── Step 6: Delete stale entries not in the current top 50 ───────────────
    # .filter("ticker", "not.in", "(A,B,C)") maps to PostgREST's not.in operator.
    # This removes exactly the rows that fell out of the top 50 — it does NOT
    # wipe the whole table.
    if top_50_tickers:
        tickers_csv = ",".join(top_50_tickers)
        supabase_client.schema("market").table("trending_stocks").delete().filter(
            "ticker", "not.in", f"({tickers_csv})"
        ).execute()
        logger.info("Deleted stale entries from market.trending_stocks (keeping %d)", len(top_50_tickers))

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
