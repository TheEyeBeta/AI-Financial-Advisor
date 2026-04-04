# Ranking Methodology Review

_Reviewed against `backend/websearch_service/app/services/ranking_engine.py`_

---

## Executive Summary

The five-dimension composite scorer produces a reasonable ranking signal for a
retail-facing product, but it diverges from professional factor models in
several ways that reduce signal quality and introduce a structural data-integrity
problem.  All five dimensions have actionable improvement opportunities.

| Dimension | Weight | Verdict |
|---|---|---|
| Momentum | 30 % | NEEDS IMPROVEMENT |
| Technical | 20 % | NEEDS IMPROVEMENT |
| Fundamental | 25 % | NEEDS IMPROVEMENT |
| Consistency | 15 % | NEEDS IMPROVEMENT |
| Signal Quality | 10 % | NEEDS IMPROVEMENT — circular dependency |

---

## Dimension-by-Dimension Analysis

### 1. MOMENTUM — NEEDS IMPROVEMENT

**What is implemented**

A four-horizon weighted blend:

```
full history:    1M×0.15 + 3M×0.25 + 6M×0.35 + 12M×0.25
partial history: 1M×0.20 + 3M×0.35 + 6M×0.45
```

**What is missing**

The academic 12-1 momentum factor (Jegadeesh & Titman 1993; Carhart 1997) is
the most empirically validated momentum signal in factor investing.  It is
defined as:

> Return from month −12 to month −1, **skipping the most recent month** (month 0).

The skip is deliberate.  The most recent 1-month return exhibits
**short-term mean reversion** — stocks that rose last month tend to give back
some of those gains over the following month.  Including the 1-month return as
a positive weight, as this model does, partially cancels the valid signal from
the 3–12 month window and adds noise.

Additionally, the current 12-month weight (0.25) is lower than the 6-month
weight (0.35).  Professional implementations either use the full 12-1 return as
a single factor or give 12M the highest single weight.

**Recommended fix**

- Implement a `return_12_1m` column in `market.stock_returns_mv`:
  return from 12 months ago to 1 month ago (i.e., `return_12m / return_1m`
  approximation, or a direct price lookup).
- Replace the current blend with: `12-1M × 0.50 + 6M × 0.30 + 3M × 0.20`.
- Retain the 1M return as a **mean-reversion signal** inside the technical
  dimension rather than as part of momentum.

---

### 2. TECHNICAL — NEEDS IMPROVEMENT

**What is implemented**

RSI (14-day), is_bullish flag, MACD histogram, ADX, and Bollinger band
containment, combined as:

```
RSI×0.25 + trend×0.25 + MACD×0.20 + ADX×0.15 + Bollinger×0.15
```

**Problems**

1. **RSI as a primary factor (25 % weight) is inconsistent with quant practice.**
   RSI is a mean-reversion indicator at extremes — it is widely used by retail
   traders but rarely used as a primary scoring factor by systematic quant
   funds.  Most institutional models use RSI only as a regime filter (e.g.,
   "exclude overbought stocks from a momentum long book"), not as a direct
   alpha source.

2. **Bollinger band containment adds noise.**  Being inside the bands is a
   low-volatility regime signal, not a directional quality signal.  This tends
   to favour low-beta stocks rather than genuinely high-quality technicals.

3. **MACD histogram percentage** (% of days > 0 over 20 days) is a coarse
   derivative of momentum already captured in Dimension 1.  It creates
   correlation between the two dimensions and inflates the effective momentum
   weight.

4. **ADX alone does not indicate direction.**  A high ADX means strong trend
   (up or down).  Without conditioning on direction, it can score a strong
   downtrend favourably.

**Recommended fix**

Replace RSI and Bollinger with:
- **Price vs SMA-200** (% above/below 200-day moving average): well-validated
  trend-following signal used by institutions.
- **Volume trend** (20-day average volume vs 90-day average): institutional
  interest proxy.
- Condition ADX on `is_bullish` flag so only bullish trending stocks get
  the ADX bonus.

---

### 3. FUNDAMENTAL — NEEDS IMPROVEMENT

**What is implemented**

```
PE_inverse×0.30 + growth×0.45 + PEG_inverse×0.25
```

Where `growth = (eps_growth + revenue_growth) / 2`.

**Problems**

Professional factor models (Fama-French 5-factor, AQR Quality Minus Junk)
consistently rank factors in this order of predictive power for forward returns:

> **Profitability > Growth > Valuation**

The current model has **no profitability dimension at all**.  Fama-French's
`RMW` (Robust Minus Weak) factor is driven by return on equity (ROE), gross
margin, and operating margin — none of which are currently scored.

Additionally, **valuation (PE + PEG) accounts for 55 % of the fundamental
score**, which is high.  Research shows low-PE stocks do outperform over long
horizons (value premium), but PE alone is a weak short-to-medium term predictor
compared to profitability.  The PEG ratio is mathematically dependent on the
same PE and growth inputs already scored separately, creating double-counting.

**Recommended fix**

Restructure the fundamental dimension:
```
Profitability (ROE / gross margin)  × 0.40
Growth quality (EPS + revenue)      × 0.35
Valuation (PE inverse only)         × 0.25
```

Remove PEG as a separate component — its signal is already captured by
combining PE and growth.  Add `return_on_equity` or `gross_margin` to the
`stock_fundamentals_history` fetch.

---

### 4. CONSISTENCY — NEEDS IMPROVEMENT

**What is implemented**

```
consistency = volatility_90d_inverted × 0.60 + positive_days_ratio × 0.40
```

Where `volatility_90d_inverted = 100 - min_max_normalised(stdev(daily_returns_90d))`.

**Problems**

1. **Standalone volatility as a consistency metric is a blunt instrument.**
   Pure volatility penalises both upside _and_ downside movement equally.  A
   stock with consistently strong positive returns but moderate volatility is
   penalised relative to a flat, low-volatility stock that is going nowhere.

2. **A Sharpe-like adjustment would be more appropriate.**  A Sharpe ratio
   (mean return ÷ standard deviation of returns) captures risk-adjusted return
   quality directly.  It answers the question IRIS users care about: "which
   stocks are delivering the best return per unit of risk?" — not merely
   "which stocks are the least volatile?"

3. **Positive days ratio (% days with positive return)** is a reasonable
   directional proxy but it too ignores magnitude.  A stock up 0.001 % counts
   the same as one up 3 %.

**Recommended fix**

Replace the standalone consistency dimension with a **risk-adjusted return**
dimension:

```
sharpe_90d = mean(daily_returns_90d) / stdev(daily_returns_90d) × sqrt(252)
```

Normalise across the universe.  Retain volatility_90d as an auxiliary output
stored in the result row for downstream use (e.g., position sizing), but remove
it as a direct scoring input in favour of the Sharpe-like measure.

---

### 5. SIGNAL QUALITY — NEEDS IMPROVEMENT ⚠️ Circular Dependency

**What is implemented**

```
signal_score = signal_confidence × 0.70 + is_bullish × 0.30
```

Where `signal_confidence` and `is_bullish` come from `market.stock_snapshots`,
populated by a separate trade engine.

**Critical problem: circular dependency / data integrity**

`signal_confidence` is an output of the trade/signal engine.  If the trade
engine itself was trained on or influenced by the ranking engine's outputs
(composite scores, conviction levels, rank tiers written to
`market.trending_stocks`), then feeding `signal_confidence` back into the
ranking engine creates a **feedback loop**:

```
ranking_engine → trending_stocks (composite, tier, conviction)
                       ↓
              trade engine reads trending_stocks
                       ↓
              trade engine writes signal_confidence
                       ↓
ranking_engine reads signal_confidence  ← circular
```

Even if the trade engine is currently independent, using an AI-generated
confidence score as a direct scoring input violates a core quant principle:
**do not use model outputs as model inputs**.  This amplifies any errors or
biases in the upstream signal engine rather than providing an independent check.

**Recommended fix**

Remove `signal_confidence` from the ranking composite entirely.  Replace the
signal quality dimension with an **independent** market microstructure signal:

- **Relative volume** (`volume_ratio` from snapshots): unusual volume relative
  to 30-day average is a clean, independent signal of institutional interest.
- Retain `is_bullish` as a binary filter to exclude confirmed downtrends, but
  not as a percentage-weighted score component.

Alternatively, absorb the 10 % weight into the momentum or fundamental
dimension where signal quality is already captured more rigorously.

---

## Comparison to Professional Factor Models

| Factor | AQR / Fama-French | This model |
|---|---|---|
| 12-1 Momentum | Core factor, ~12 % annual premium | Partially implemented; 1M return included (adds noise) |
| Profitability (ROE, margins) | Core in FF5, AQR QMJ | **Not present** |
| Growth (EPS, revenue) | Secondary factor | Present (growth × 0.45 in fundamental) |
| Valuation (PE) | Present but lower weight than profitability | Over-weighted at 55 % of fundamental |
| Volatility / Low-risk | Standalone factor in some models | Used as "consistency" but without return context |
| Technical indicators (RSI, MACD) | Rarely used as primary quant factors | RSI is 25 % of technical dimension |
| Signal circularity | Forbidden in professional implementations | Present via signal_confidence |

---

## Recommended Changes (Prioritised)

1. **[HIGH] Remove signal_confidence from the composite.**  The circular
   dependency is a structural data integrity problem.  Replace with relative
   volume or absorb the 10 % weight elsewhere.

2. **[HIGH] Implement 12-1 momentum.**  Add `return_12_1m` to
   `stock_returns_mv` and restructure the momentum blend to use it.  The 1M
   return should be removed from momentum scoring or used only as a mean-
   reversion filter.

3. **[HIGH] Add profitability to the fundamental dimension.**  Add ROE or gross
   margin to `stock_fundamentals_history`.  Set profitability weight to 40 %
   and reduce valuation to 25 %.

4. **[MEDIUM] Replace RSI as a primary technical factor.**  Substitute price-
   vs-SMA-200 and volume trend.  Move RSI to a regime filter role.

5. **[MEDIUM] Replace standalone consistency with a Sharpe-like score.**
   `mean(daily_returns_90d) / stdev(daily_returns_90d)` is a well-understood,
   direct measure of risk-adjusted quality.

6. **[LOW] Remove PEG as an independent component.**  PEG = PE / growth, so it
   double-counts signals already scored by PE_inverse and growth separately.

---

## What Should NOT Change

- **Min-max normalisation across the universe before combining dimensions.**
  This is correct practice — it prevents any single dimension from dominating
  the composite due to scale differences.

- **Independent error isolation per ticker.**  The try/except per ticker in the
  scoring loop is the right pattern.  A single data-quality failure should not
  abort the full cycle.

- **Bulk-fetch before the scoring loop (zero N+1 queries).**  This is an
  excellent design choice for a 507-ticker universe.

- **The conviction / tier classification thresholds.**  The tiered output
  (Strong Buy / Buy / Hold / Underperform / Sell) and conviction levels (High /
  Medium / Low) are useful downstream signals for the IRIS advisor.  The
  thresholds themselves are reasonable starting points even if the underlying
  composite improves.

- **The 30 % momentum / 25 % fundamental weighting structure.**  These relative
  priorities are broadly consistent with how institutional factor models are
  constructed.  The signal _content_ within each dimension needs improvement,
  but the dimensional weights are a reasonable allocation.
