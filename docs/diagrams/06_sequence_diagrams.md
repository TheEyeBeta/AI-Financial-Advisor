# Diagram 6 — Sequence Diagrams

**Diagram Type:** UML Sequence Diagrams
**Purpose:** Shows the time-ordered interactions between components for each key system workflow.

---

## Sequence 1 — User Registration & Onboarding

```mermaid
sequenceDiagram
    actor User as 👤 User (Browser)
    participant FE as React Frontend
    participant SB as Supabase Auth
    participant DB as Supabase DB
    participant BE as FastAPI Backend
    participant CTX as Meridian Context

    User->>FE: Fill signup form\n(email, password)
    FE->>SB: supabase.auth.signUp()
    SB-->>DB: INSERT auth.users
    DB-->>DB: TRIGGER handle_new_user()\n→ INSERT core.users
    SB-->>FE: JWT session token
    FE-->>User: Redirect → /onboarding

    Note over User, CTX: Onboarding Flow

    User->>FE: Submit onboarding form\n(age, risk_level, goal, experience)
    FE->>BE: POST /api/meridian/onboard\n{knowledge_tier, risk_profile,\ninvestment_horizon, monthly_investable,\ngoal_name, target_amount, target_date}
    BE->>BE: require_auth() → validate JWT
    BE->>DB: UPSERT core.user_profiles
    BE->>DB: Check: existing goal for this user?
    alt No existing goal
        BE->>DB: INSERT meridian.user_goals
    end
    BE->>DB: INSERT meridian.meridian_events\n{event_type: "onboarding_completed"}
    BE->>CTX: refresh_iris_context_cache(user_id)
    CTX->>DB: READ core.user_profiles
    CTX->>DB: READ meridian.user_goals
    CTX->>DB: READ meridian.risk_alerts
    CTX->>DB: UPSERT ai.iris_context_cache
    CTX-->>BE: Context refreshed
    BE->>DB: UPDATE core.users\nSET onboarding_complete = true
    BE-->>FE: 200 OK
    FE-->>User: Redirect → /dashboard
```

---

## Sequence 2 — AI Chat Flow (Full Path)

```mermaid
sequenceDiagram
    actor User as 👤 User (Browser)
    participant FE as React Frontend
    participant BE as FastAPI Backend
    participant AUTH as auth.py
    participant RATE as rate_limit.py
    participant DB as Supabase DB
    participant CTX as meridian_context.py
    participant TAVILY as Tavily API
    participant OPENAI as OpenAI API
    participant PERP as Perplexity AI

    User->>FE: Type message & send
    FE->>BE: POST /api/chat\n{chat_id, message, history}\nAuthorization: Bearer JWT

    BE->>AUTH: require_auth(token)
    AUTH->>AUTH: Verify JWT locally (HS256)
    alt JWT invalid
        AUTH-->>BE: 401 Unauthorised
        BE-->>FE: 401
        FE-->>User: Redirect to login
    end
    AUTH-->>BE: AuthenticatedUser(auth_id)

    BE->>RATE: check_rate_limit(user_id, /api/chat)
    RATE->>DB: READ core.rate_limit_state
    alt Rate limit exceeded
        RATE-->>BE: 429 + retry_after
        BE-->>FE: 429 Too Many Requests
        FE-->>User: Show rate limit message
    end
    RATE-->>BE: Allowed

    BE->>DB: READ ai.iris_context_cache\nWHERE user_id = ?
    alt Cache miss or stale
        BE->>CTX: build_iris_context(user_id)
        CTX->>DB: READ core.user_profiles
        CTX->>DB: READ meridian.user_goals
        CTX->>DB: READ meridian.risk_alerts
        CTX->>DB: UPSERT ai.iris_context_cache
        CTX-->>BE: context_string
    end

    BE->>OPENAI: POST /v1/chat/completions\nmodel: gpt-5-mini\n{classify query: complexity, risk, tier}
    OPENAI-->>BE: classification JSON

    BE->>BE: detectSearchIntent(message)
    alt Search intent detected
        alt News pattern
            BE->>TAVILY: POST /search\n{query: "AAPL stock news today"}
        else General knowledge
            BE->>TAVILY: POST /search\n{query: user_message}
        end
        TAVILY-->>BE: search_results[]
        BE->>BE: Inject search results into prompt
    end

    BE->>BE: Assemble IRIS prompt\n= system_prompt\n+ meridian_context_block\n+ search_results\n+ chat_history (last 50)\n+ user_message

    alt OpenAI available
        BE->>OPENAI: POST /v1/chat/completions\nmodel: gpt-5, stream: true
        OPENAI-->>BE: SSE stream chunks
    else OpenAI rate-limited / down
        BE->>PERP: POST /chat/completions\nmodel: llama-3.1-sonar
        PERP-->>BE: SSE stream chunks
    end

    loop Stream chunks
        BE-->>FE: SSE chunk (text delta)
        FE-->>User: Display token-by-token
    end

    BE->>DB: INSERT ai.chat_messages\n{role: "user", content, chat_id}
    BE->>DB: INSERT ai.chat_messages\n{role: "assistant", content, tokens}
    BE->>DB: UPDATE ai.chats SET updated_at = NOW()

    alt Knowledge tier changed
        BE->>DB: UPDATE core.user_profiles\nSET knowledge_tier = new_tier
        BE->>CTX: refresh_iris_context_cache(user_id)
    end

    BE->>BE: audit_log("chat_request",\n{user_id, model, tokens})
    RATE->>DB: UPDATE core.rate_limit_state\n(increment counts)
```

---

## Sequence 3 — Paper Trade Execution

```mermaid
sequenceDiagram
    actor User as 👤 User (Browser)
    participant FE as React Frontend
    participant BE as FastAPI Backend
    participant DB as Supabase DB
    participant WS as WebSocket Server

    User->>FE: Select stock, quantity, direction\nClick "Open Long Position"
    FE->>BE: POST /api/trades\n{symbol: "AAPL", quantity: 10,\nentry_price: 185.50, type: "LONG"}

    BE->>BE: require_auth() → validate JWT
    BE->>DB: READ core.user_profiles\nGET monthly_investable
    BE->>BE: cost = quantity × entry_price\n(10 × 185.50 = €1,855)

    alt Insufficient balance
        BE-->>FE: 400 Bad Request\n"Insufficient balance"
        FE-->>User: Show error toast
    end

    BE->>DB: INSERT trading.open_positions\n{user_id, symbol, quantity,\nentry_price, type: "LONG",\nentry_date: TODAY}
    BE->>DB: INSERT trading.trade_journal\n{symbol, type: "BUY",\nstrategy, notes, tags}
    BE->>DB: Upsert trading.portfolio_history\n{user_id, date: TODAY, value: updated_value}

    alt WebSocket connected
        BE->>WS: Broadcast portfolio update\n{positions, total_value}
        WS-->>FE: Live portfolio state
    end

    BE-->>FE: 201 Created\n{position_id, ...}
    FE-->>User: Position shown in Portfolio

    Note over User, WS: Later — Closing the Position

    User->>FE: Click "Close Position" (full)
    FE->>BE: POST /api/trades/close\n{position_id, close_price: 192.00,\nquantity: 10}

    BE->>DB: READ trading.open_positions\nWHERE id = position_id
    BE->>BE: pnl = (192.00 - 185.50) × 10\n= €65.00 profit

    BE->>DB: UPDATE trading.open_positions\nSET status = "CLOSED"
    BE->>DB: INSERT trading.trades\n{action: "CLOSED", pnl: 65.00,\nexit_price: 192.00, exit_date: TODAY}
    BE->>DB: UPDATE core.user_profiles\nSET monthly_investable += 65.00

    BE->>DB: Upsert trading.portfolio_history\n{value: updated_value}
    BE-->>FE: 200 OK {pnl: 65.00}
    FE-->>User: Show P&L: +€65.00 ✅
```

---

## Sequence 4 — Academy Lesson & Quiz Flow

```mermaid
sequenceDiagram
    actor User as 👤 User (Browser)
    participant FE as React Frontend
    participant SB as Supabase (Direct)
    participant BE as FastAPI Backend
    participant OPENAI as OpenAI API

    User->>FE: Navigate to Academy
    FE->>SB: SELECT academy.tiers\n+ user_tier_enrollments
    SB-->>FE: Available tiers\n(Foundation, Intermediate, Advanced)
    FE-->>User: Show tier selection

    User->>FE: Enrol in "Foundation" tier
    FE->>SB: INSERT academy.user_tier_enrollments\n{user_id, tier_id}
    SB-->>FE: Enrolled ✅

    User->>FE: Open Lesson 1
    FE->>SB: SELECT academy.lessons\nWHERE tier_id = foundation\nORDER BY order_index
    FE->>SB: SELECT academy.lesson_sections\nSELECT academy.lesson_blocks\n(all blocks for this lesson)
    SB-->>FE: Lesson content (sections + blocks)
    FE-->>User: Render lesson content

    opt User asks IRIS a question mid-lesson
        User->>FE: Type question in lesson chat
        FE->>SB: INSERT academy.chat_sessions\n{user_id, lesson_id}
        FE->>BE: POST /api/chat\n{lesson_context: true,\nlesson_id, message}
        BE->>OPENAI: Chat with lesson-specific context
        OPENAI-->>BE: Explanation tailored to lesson
        BE-->>FE: Stream response
        FE-->>User: IRIS answers in lesson context
        FE->>SB: INSERT academy.chat_messages\n{session_id, role, content}
    end

    User->>FE: Click "Take Quiz"
    FE->>SB: SELECT academy.quizzes\nSELECT academy.quiz_questions\nSELECT academy.quiz_options
    SB-->>FE: Quiz with questions
    FE-->>User: Show quiz UI

    User->>FE: Submit answers
    FE->>SB: INSERT academy.quiz_attempts\n{quiz_id, user_id, score, passed}
    FE->>SB: INSERT academy.quiz_answers\n(one per question, is_correct)
    FE->>SB: UPSERT academy.user_lesson_progress\n{completed: true, progress_pct: 100,\nlast_quiz_attempt_id}
    SB-->>FE: Progress saved

    alt Passed quiz
        FE-->>User: ✅ Lesson complete! Next lesson unlocked
    else Failed quiz
        FE-->>User: ❌ Try again — review lesson content
    end
```

---

## Sequence 5 — Stock Ranking Request

```mermaid
sequenceDiagram
    actor User as 👤 User (Browser)
    participant FE as React Frontend
    participant BE as FastAPI Backend
    participant CACHE as In-Memory Cache
    participant DB as Supabase DB

    User->>FE: Navigate to /top-stocks
    FE->>BE: GET /api/stocks/ranking\n?horizon=long&top_n=20

    BE->>CACHE: Check cache\n(TTL: 10 minutes)
    alt Cache hit
        CACHE-->>BE: Cached ranking list
        BE-->>FE: 200 OK (fast response ~10ms)
        FE-->>User: Show ranked stocks
    else Cache miss
        BE->>DB: SELECT * FROM market.stock_snapshots
        DB-->>BE: All stock snapshots\n(price, technicals, fundamentals, signals)

        loop For each stock
            BE->>BE: Score 1: Momentum\n(price_change_pct, volume)
            BE->>BE: Score 2: Technical\n(RSI, MACD, Bollinger)
            BE->>BE: Score 3: Fundamental\n(PE, earnings growth)
            BE->>BE: Score 4: Risk-Adjusted\n(ATR, Sharpe-like)
            BE->>BE: Score 5: Quality\n(dividend yield, revenue)
            BE->>BE: Score 6: ML Signal\n(latest_signal confidence)
            BE->>BE: composite = weighted_sum(scores)\nEMA smooth: α=0.3
            BE->>BE: Hysteresis check:\nassign tier (Strong Buy → Sell)
        end

        BE->>BE: Sort by composite score DESC
        BE->>CACHE: Store result (10 min TTL)
        BE->>DB: INSERT market.ranking_history\n(persist for audit)
        BE-->>FE: 200 OK (ranked list)
        FE-->>User: Show ranked stocks with tiers
    end
```

---

## Sequence 6 — Admin System Health Check

```mermaid
sequenceDiagram
    actor Admin as 🛡️ Administrator
    participant FE as Admin Panel (React)
    participant BE as FastAPI Backend
    participant AUTH as auth.py
    participant DB as Supabase DB
    participant DATAAPI as TheEyeBeta DataAPI
    participant OPENAI as OpenAI API

    Admin->>FE: Navigate to /admin
    FE->>BE: GET /api/admin/health\nAuthorization: Bearer JWT (Admin role)

    BE->>AUTH: require_auth(token)
    AUTH-->>BE: AuthenticatedUser(auth_id)
    BE->>DB: SELECT core.users\nWHERE auth_id = ? AND userType = 'Admin'
    alt Not admin
        DB-->>BE: No rows / userType = 'User'
        BE-->>FE: 403 Forbidden
        FE-->>Admin: Access denied
    end

    BE->>DB: Ping Supabase connection
    DB-->>BE: ✅ Connected

    BE->>DATAAPI: GET /health
    alt DataAPI available
        DATAAPI-->>BE: ✅ Healthy
    else DataAPI down
        DATAAPI-->>BE: ❌ Connection error
    end

    BE->>OPENAI: GET /v1/models (lightweight probe)
    alt OpenAI available
        OPENAI-->>BE: ✅ Model list
    else OpenAI down
        OPENAI-->>BE: ❌ API error
    end

    BE-->>FE: Health report:\n{supabase: ok, dataapi: ok/down,\nopenai: ok/down, scheduler: running,\ncache_size: N, audit_log_size: Xkb}

    FE-->>Admin: Display service status dashboard
```
