# Diagram 4 — Data Pipeline Diagram

**Diagram Type:** Data Flow Diagram with Decision Conditions
**Purpose:** Shows all major data pipelines in the system — where data originates, how it is transformed, what conditions branch the flow, and where it is stored or consumed.

---

## Pipeline 1 — AI Chat Request Pipeline (Core Flow)

This is the primary pipeline. Every user chat message travels this path.

```mermaid
flowchart TD
    %% ── Source ───────────────────────────────────────────────────
    IN_MSG(["📨 User Message\n(Source: Browser)"])

    %% ── Auth Gate ────────────────────────────────────────────────
    AUTH{"🔐 JWT Valid?\n(require_auth)"}
    AUTH_FAIL["❌ 401 Unauthorised\n→ User redirected to Login"]

    %% ── Rate Limit Gate ──────────────────────────────────────────
    RATE{"📊 Rate Limit\nExceeded?\n(core.rate_limit_state)"}
    RATE_BLOCK["❌ 429 Too Many Requests\n→ Retry-After header returned"]

    %% ── Meridian Context ─────────────────────────────────────────
    CACHE{"📦 IRIS Context\nCache Valid?\n(ai.iris_context_cache)"}
    BUILD_CTX["🔄 Build Context\nRead: core.user_profiles\nRead: meridian.user_goals\nRead: meridian.risk_alerts\nRead: meridian.financial_plans\nCompute: emergency fund status\nCompute: on_track vs off_track"]
    USE_CTX["✅ Use Cached\nIRIS Context"]

    %% ── Query Classification ─────────────────────────────────────
    CLASSIFY["🧠 Classify Query\n(GPT-5-mini)\nOutput: complexity, risk, requires_calc, tier"]

    %% ── Knowledge Tier Detection ─────────────────────────────────
    TIER{"🎓 Knowledge\nTier Changed?"}
    UPDATE_TIER["📝 Update Tier\n(core.user_profiles +\nai.iris_context_cache)"]

    %% ── Search Intent Detection ──────────────────────────────────
    INTENT{"🔍 Requires\nWeb Search?"}
    SEARCH_TYPE{"Search Type?"}
    NEWS_SEARCH["📰 News Search\n→ Tavily: '[ticker] news today'\nSource: Tavily API"]
    GEN_SEARCH["🌐 General Search\n→ Tavily: user query\nSource: Tavily API"]
    SEARCH_RESULTS["Search Results\n(injected into prompt)"]

    %% ── Market Data ──────────────────────────────────────────────
    MARKET_NEED{"📈 Ticker\nMentioned?"}
    DATAAPI["📊 Fetch Market Data\nSource: TheEyeBeta DataAPI\nData: price, signals,\ntechnical indicators"]

    %% ── Prompt Assembly ──────────────────────────────────────────
    PROMPT["📋 Assemble IRIS Prompt\n1. Base system prompt (IRIS identity)\n2. Meridian context block\n3. Search results (if any)\n4. Market data (if any)\n5. Chat history (last 50 msgs)\n6. User message"]

    %% ── LLM Routing ──────────────────────────────────────────────
    CALC{"Requires\nCalculation?"}
    QUANT["🔢 Quantitative Path\nModel: GPT-5\nAnalyse: /api/ai/analyze-quantitative"]
    LLM_PRIMARY{"OpenAI\nAvailable?"}
    OPENAI["🤖 OpenAI GPT-5\n(Primary LLM)"]
    PERPLEXITY["🤖 Perplexity AI\n(Fallback LLM)"]

    %% ── Response Processing ──────────────────────────────────────
    STREAM["📡 Stream Response\n→ Server-Sent Events (SSE)\nto Browser"]

    %% ── Persistence ──────────────────────────────────────────────
    SAVE_MSG["💾 Save to Database\nai.chat_messages\n(role: assistant, content, tokens)"]
    SAVE_CHAT["💾 Update ai.chats\n(updated_at timestamp)"]
    REFRESH_CTX["🔄 Refresh Context Cache\nai.iris_context_cache\n(async, non-blocking)"]
    AUDIT["📝 Audit Log\naudit.jsonl\n(user_id, tokens, model)"]

    %% ── Output ───────────────────────────────────────────────────
    OUT(["✅ Response Displayed\nto User (Browser)"])

    %% ── Flow ─────────────────────────────────────────────────────
    IN_MSG --> AUTH
    AUTH -->|"Invalid"| AUTH_FAIL
    AUTH -->|"Valid"| RATE
    RATE -->|"Exceeded"| RATE_BLOCK
    RATE -->|"OK"| CACHE

    CACHE -->|"Miss / Stale"| BUILD_CTX
    CACHE -->|"Hit"| USE_CTX
    BUILD_CTX --> CLASSIFY
    USE_CTX --> CLASSIFY

    CLASSIFY --> TIER
    TIER -->|"Yes"| UPDATE_TIER
    TIER -->|"No"| INTENT
    UPDATE_TIER --> INTENT

    INTENT -->|"Yes"| SEARCH_TYPE
    INTENT -->|"No"| MARKET_NEED
    SEARCH_TYPE -->|"News pattern"| NEWS_SEARCH
    SEARCH_TYPE -->|"General pattern"| GEN_SEARCH
    NEWS_SEARCH --> SEARCH_RESULTS
    GEN_SEARCH --> SEARCH_RESULTS
    SEARCH_RESULTS --> MARKET_NEED

    MARKET_NEED -->|"Yes — fetch live data"| DATAAPI
    MARKET_NEED -->|"No"| PROMPT
    DATAAPI --> PROMPT

    PROMPT --> CALC
    CALC -->|"Yes"| QUANT
    CALC -->|"No"| LLM_PRIMARY
    QUANT --> LLM_PRIMARY
    LLM_PRIMARY -->|"Available"| OPENAI
    LLM_PRIMARY -->|"Rate limited / down"| PERPLEXITY

    OPENAI --> STREAM
    PERPLEXITY --> STREAM

    STREAM --> SAVE_MSG
    STREAM --> OUT
    SAVE_MSG --> SAVE_CHAT
    SAVE_CHAT --> REFRESH_CTX
    SAVE_CHAT --> AUDIT

    %% ── Styling ──────────────────────────────────────────────────
    style IN_MSG fill:#0d7377,stroke:#14a085,color:#fff
    style OUT fill:#0d7377,stroke:#14a085,color:#fff
    style AUTH_FAIL fill:#7a1a1a,stroke:#f44336,color:#fff
    style RATE_BLOCK fill:#7a1a1a,stroke:#f44336,color:#fff
    style OPENAI fill:#1a4a1a,stroke:#4caf50,color:#fff
    style PERPLEXITY fill:#1a4a1a,stroke:#4caf50,color:#fff
    style DATAAPI fill:#4a3a1a,stroke:#ff9800,color:#fff
```

---

## Pipeline 2 — Market Data & Stock Ranking Pipeline

```mermaid
flowchart TD
    %% ── Sources ──────────────────────────────────────────────────
    SRC_DATAAPI(["📈 TheEyeBeta DataAPI\n(External)"])
    SRC_MANUAL(["📋 Manual Upload\n/ Seed Data"])

    %% ── Ingestion ────────────────────────────────────────────────
    INGEST["⬇️ Ingest Market Snapshot\nFields: ticker, last_price,\n30+ technical indicators,\nfundamentals, signals"]

    UPSERT["💾 Upsert: market.stock_snapshots\nKey: ticker_id\nIncludes: SMA, EMA, RSI, MACD,\nBollinger Bands, PE ratio,\nmarket cap, dividend yield,\nlatest_signal"]

    %% ── Ranking Trigger ──────────────────────────────────────────
    REQUEST["📥 GET /api/stocks/ranking\n?horizon=long|short&top_n=20"]
    CACHE_HIT{"🗄️ In-Memory Cache\nValid? (10 min TTL)"}
    CACHE_RETURN["⚡ Return Cached\nRanking (fast path)"]

    %% ── Score Computation ────────────────────────────────────────
    FETCH["📖 Read All Snapshots\nfrom market.stock_snapshots"]

    subgraph SCORING ["6-Dimensional Scoring Engine"]
        D1["1️⃣ Momentum Score\n• price_change_pct\n• volume momentum"]
        D2["2️⃣ Technical Score\n• RSI (overbought/oversold)\n• MACD signal cross\n• Bollinger Band position"]
        D3["3️⃣ Fundamental Score\n• PE ratio (vs sector avg)\n• Earnings growth\n• Revenue growth"]
        D4["4️⃣ Risk-Adjusted Score\n• Sharpe-like ratio\n• Volatility (ATR)\n• Max drawdown"]
        D5["5️⃣ Quality Score\n• Dividend yield\n• Balance sheet strength"]
        D6["6️⃣ ML Signal Score\n• latest_signal field\n• Confidence weight"]
    end

    COMPOSITE["📊 Composite Score\nWeighted sum of 6 dimensions\n(weights vary by horizon: long/short)"]

    %% ── Smoothing & Stability ────────────────────────────────────
    EMA["📈 EMA Smoothing\nα = 0.3\nPrevious score × 0.7 +\nNew score × 0.3"]

    HYSTERESIS{"📏 Tier Changed?\n(Hysteresis check:\nmust exceed threshold\nto prevent flip-flopping)"}
    KEEP_TIER["🔒 Retain Previous Tier\n(stability)"]
    NEW_TIER["✅ Assign New Tier\n• Strong Buy\n• Buy\n• Hold\n• Underperform\n• Sell"]

    %% ── Output ───────────────────────────────────────────────────
    RANK_RESULT["📋 Ranked Stock List\nWith: tier, score, conviction,\ntechnical summary"]
    CACHE_STORE["💾 Store in Memory Cache\n+ Persist to market.ranking_history"]
    FRONTEND["🖥️ /top-stocks Page\n(User sees ranked list)"]

    %% ── Flow ─────────────────────────────────────────────────────
    SRC_DATAAPI --> INGEST
    SRC_MANUAL --> INGEST
    INGEST --> UPSERT

    REQUEST --> CACHE_HIT
    CACHE_HIT -->|"Hit"| CACHE_RETURN
    CACHE_HIT -->|"Miss"| FETCH
    CACHE_RETURN --> FRONTEND

    FETCH --> D1 & D2 & D3 & D4 & D5 & D6
    D1 & D2 & D3 & D4 & D5 & D6 --> COMPOSITE
    COMPOSITE --> EMA --> HYSTERESIS
    HYSTERESIS -->|"Change within threshold"| KEEP_TIER
    HYSTERESIS -->|"Change exceeds threshold"| NEW_TIER
    KEEP_TIER --> RANK_RESULT
    NEW_TIER --> RANK_RESULT
    RANK_RESULT --> CACHE_STORE
    CACHE_STORE --> FRONTEND

    style SRC_DATAAPI fill:#4a3a1a,stroke:#ff9800,color:#fff
    style FRONTEND fill:#0d7377,stroke:#14a085,color:#fff
    style CACHE_RETURN fill:#1a4a1a,stroke:#4caf50,color:#fff
```

---

## Pipeline 3 — Meridian Context Refresh Pipeline

```mermaid
flowchart TD
    %% ── Triggers ─────────────────────────────────────────────────
    T1(["🗣️ Trigger: Chat Request\n(per user)"])
    T2(["🎓 Trigger: Onboarding\nCompleted"])
    T3(["⏰ Trigger: Daily Background Job\n(APScheduler — all users)"])
    T4(["📊 Trigger: Goal Update\nor Life Event"])

    %% ── Context Builder ──────────────────────────────────────────
    FETCH_PROFILE["📖 Fetch: core.user_profiles\nFields: knowledge_tier, risk_profile,\ninvestment_horizon, monthly_investable,\nemergency_fund_months"]
    FETCH_GOALS["📖 Fetch: meridian.user_goals\nWHERE status = 'active'\nFields: goal_name, target_amount,\ncurrent_amount, target_date,\nmonthly_contribution"]
    FETCH_ALERTS["📖 Fetch: meridian.risk_alerts\nWHERE resolved = false\nFields: alert_type, severity, message"]
    FETCH_PLANS["📖 Fetch: meridian.financial_plans\nWHERE is_current = true"]

    %% ── Computation ──────────────────────────────────────────────
    CALC_EMG{"Emergency Fund\nSufficient?\n(≥ 6 months expenses)"}
    EMG_OK["✅ Emergency Fund: OK"]
    EMG_WARN["⚠️ Emergency Fund: Insufficient"]

    CALC_GOALS{"For each goal:\nOn Track?"}
    GOAL_ON["✅ On Track\n(progress ≥ expected)"]
    GOAL_OFF["⚠️ Off Track\n(progress < expected)"]

    %% ── Sanitisation ─────────────────────────────────────────────
    SANITISE["🛡️ Sanitise Data\n• Remove PII extremes\n• Cap decimal places\n• Validate goal count (≤ 10)"]

    %% ── Cache Build ──────────────────────────────────────────────
    BUILD_JSON["📦 Build profile_summary JSONB\n{\n  knowledge_tier: 1|2|3,\n  risk_profile: low|mid|high|very_high,\n  investment_horizon: short|medium|long,\n  monthly_investable: €X,\n  emergency_fund_status: ok|insufficient\n}"]
    BUILD_GOALS_JSON["📦 Build active_goals JSONB\n[\n  { goal_name, target, current,\n    progress_pct, on_track, days_remaining },\n  ...\n]"]
    BUILD_ALERTS_JSON["📦 Build active_alerts JSONB\n[\n  { type, severity, message },\n  ...\n]"]

    %% ── Upsert ───────────────────────────────────────────────────
    UPSERT["💾 UPSERT ai.iris_context_cache\nON CONFLICT (user_id)\nDO UPDATE SET\n  profile_summary = ...\n  active_goals = ...\n  active_alerts = ...\n  knowledge_tier = ...\n  updated_at = NOW()"]

    %% ── Usage ────────────────────────────────────────────────────
    INJECT["📋 Injected into IRIS\nSystem Prompt Block\n(next chat request)"]

    %% ── Flow ─────────────────────────────────────────────────────
    T1 & T2 & T3 & T4 --> FETCH_PROFILE & FETCH_GOALS & FETCH_ALERTS & FETCH_PLANS
    FETCH_PROFILE --> CALC_EMG
    CALC_EMG -->|"≥ 6 months"| EMG_OK
    CALC_EMG -->|"< 6 months"| EMG_WARN
    FETCH_GOALS --> CALC_GOALS
    CALC_GOALS -->|"On track"| GOAL_ON
    CALC_GOALS -->|"Off track"| GOAL_OFF

    EMG_OK & EMG_WARN & GOAL_ON & GOAL_OFF & FETCH_ALERTS & FETCH_PLANS --> SANITISE
    SANITISE --> BUILD_JSON & BUILD_GOALS_JSON & BUILD_ALERTS_JSON
    BUILD_JSON & BUILD_GOALS_JSON & BUILD_ALERTS_JSON --> UPSERT
    UPSERT --> INJECT

    style T1 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style T2 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style T3 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style T4 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style INJECT fill:#0d7377,stroke:#14a085,color:#fff
    style EMG_WARN fill:#5c3a1a,stroke:#ff9800,color:#fff
    style GOAL_OFF fill:#5c3a1a,stroke:#ff9800,color:#fff
```

---

## Pipeline 4 — Paper Trading Pipeline

```mermaid
flowchart TD
    USER(["👤 User Action\n(Source: Browser)"])

    ACTION{"Trade\nAction?"}

    %% ── Open Trade ───────────────────────────────────────────────
    OPEN["OPEN POSITION\nPOST /api/trades"]
    VALIDATE_OPEN{"Balance\nSufficient?"}
    BALANCE_FAIL["❌ Rejected\n'Insufficient balance'"]
    CREATE_POS["💾 Insert: trading.open_positions\n{ symbol, quantity,\n  entry_price, type: LONG|SHORT,\n  entry_date }"]
    JOURNAL_OPEN["💾 Insert: trading.trade_journal\n{ strategy, notes, tags }"]

    %% ── Close Trade ──────────────────────────────────────────────
    CLOSE["CLOSE POSITION\nPOST /api/trades/close"]
    FETCH_POS["📖 Read: trading.open_positions\n(by position_id)"]
    PARTIAL{"Full or\nPartial Close?"}
    FULL_CLOSE["💾 Update: trading.open_positions\nstatus → CLOSED"]
    PARTIAL_CLOSE["💾 Update: trading.open_positions\nquantity reduced"]
    CALC_PNL["🧮 Calculate P&L\npnl = (close_price - entry_price)\n      × quantity\n(negative = loss for LONG)"]
    RECORD_TRADE["💾 Insert: trading.trades\n{ action: CLOSED, entry_price,\n  exit_price, pnl, exit_date }"]
    UPDATE_BALANCE["💾 Update: core.user_profiles\nmonthly_investable += realised_pnl"]

    %% ── Shared: Daily Snapshot ───────────────────────────────────
    SNAPSHOT{"Snapshot\nfor today\nexists?"}
    UPDATE_SNAP["💾 UPDATE: trading.portfolio_history\nSET value = current_portfolio_value\nWHERE user_id AND date = TODAY"]
    INSERT_SNAP["💾 INSERT: trading.portfolio_history\n{ user_id, date, value }"]

    %% ── WebSocket Broadcast ──────────────────────────────────────
    WS{"WebSocket\nClient\nConnected?"}
    BROADCAST["📡 Broadcast Update\nWSS: live portfolio state"]
    SKIP_WS["(no real-time update)"]

    %% ── Output ───────────────────────────────────────────────────
    OUT(["✅ Portfolio Page\nRefreshed for User"])

    %% ── Flow ─────────────────────────────────────────────────────
    USER --> ACTION
    ACTION -->|"Buy / Short"| OPEN
    ACTION -->|"Sell / Cover"| CLOSE

    OPEN --> VALIDATE_OPEN
    VALIDATE_OPEN -->|"No"| BALANCE_FAIL
    VALIDATE_OPEN -->|"Yes"| CREATE_POS
    CREATE_POS --> JOURNAL_OPEN

    CLOSE --> FETCH_POS
    FETCH_POS --> PARTIAL
    PARTIAL -->|"Full"| FULL_CLOSE
    PARTIAL -->|"Partial"| PARTIAL_CLOSE
    FULL_CLOSE --> CALC_PNL
    PARTIAL_CLOSE --> CALC_PNL
    CALC_PNL --> RECORD_TRADE
    RECORD_TRADE --> UPDATE_BALANCE

    JOURNAL_OPEN & UPDATE_BALANCE --> SNAPSHOT
    SNAPSHOT -->|"Yes"| UPDATE_SNAP
    SNAPSHOT -->|"No"| INSERT_SNAP

    UPDATE_SNAP & INSERT_SNAP --> WS
    WS -->|"Yes"| BROADCAST
    WS -->|"No"| SKIP_WS
    BROADCAST & SKIP_WS --> OUT

    style USER fill:#0d7377,stroke:#14a085,color:#fff
    style OUT fill:#0d7377,stroke:#14a085,color:#fff
    style BALANCE_FAIL fill:#7a1a1a,stroke:#f44336,color:#fff
    style BROADCAST fill:#1a3a5c,stroke:#4a9eff,color:#fff
```

---

## Data Source Summary

| Pipeline | Data Sources | Conditions | Destinations |
|----------|-------------|-----------|--------------|
| AI Chat | User input, `ai.iris_context_cache`, `ai.chat_messages`, OpenAI, Perplexity, Tavily, DataAPI | JWT valid? Rate limit ok? Cache valid? Search needed? Ticker mentioned? | `ai.chat_messages`, `ai.chats`, `ai.iris_context_cache`, `audit.jsonl` |
| Stock Ranking | `market.stock_snapshots`, DataAPI | Cache hit? Tier threshold exceeded? | In-memory cache, `market.ranking_history` |
| Meridian Refresh | `core.user_profiles`, `meridian.user_goals`, `meridian.risk_alerts`, `meridian.financial_plans` | Emergency fund ≥ 6mo? Goal on-track? | `ai.iris_context_cache` |
| Paper Trading | User input, `trading.open_positions`, `core.user_profiles` | Balance sufficient? Full/partial close? WebSocket connected? | `trading.open_positions`, `trading.trades`, `trading.trade_journal`, `trading.portfolio_history` |
