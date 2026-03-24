# Diagram 8 — State Machine Diagrams

**Diagram Type:** UML State Machine / Statechart Diagrams
**Purpose:** Shows the valid states and transitions for key entities in the system.

---

## State 1 — User Account Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Registered : User signs up\n(Supabase Auth)

    Registered --> PendingOnboarding : core.users row created\n(DB trigger fires)

    PendingOnboarding --> Onboarding : User navigates\nto /onboarding

    Onboarding --> Active : POST /api/meridian/onboard\n✓ onboarding_complete = true\n✓ core.user_profiles created\n✓ meridian.user_goals created\n✓ ai.iris_context_cache populated

    Onboarding --> PendingOnboarding : User abandons\nonboarding flow

    Active --> Active : Normal usage\n(chat, trade, learn)

    Active --> KnowledgeTier1 : Detected as Beginner\n(knowledge_tier = 1)
    Active --> KnowledgeTier2 : Detected as Intermediate\n(knowledge_tier = 2)
    Active --> KnowledgeTier3 : Detected as Advanced\n(knowledge_tier = 3)

    KnowledgeTier1 --> KnowledgeTier2 : IRIS detects advanced\nvocabulary in chat
    KnowledgeTier2 --> KnowledgeTier3 : IRIS detects institutional\nlevel vocabulary
    KnowledgeTier3 --> KnowledgeTier2 : Reassessment on\nsimpler questions

    Active --> Admin : Admin grants\nadmin role\n(userType = 'Admin')

    Active --> Suspended : Rate limit abuse\ndetected (50 req/min)\n→ blocked_until set

    Suspended --> Active : block period expires\n(1 hour default)

    Active --> Deleted : Admin deletes user\n(cannot delete self)

    Deleted --> [*]
```

---

## State 2 — Chat Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Initialised : User opens /advisor\nor clicks "New Chat"

    Initialised --> WaitingForInput : Chat UI loaded\nchat_id created in ai.chats

    WaitingForInput --> ProcessingRequest : User sends message

    ProcessingRequest --> AuthValidating : JWT checked
    AuthValidating --> RateLimitChecked : JWT valid
    AuthValidating --> AuthFailed : JWT invalid/expired

    AuthFailed --> WaitingForInput : User re-authenticates

    RateLimitChecked --> ContextBuilding : Within limits
    RateLimitChecked --> RateLimited : Limit exceeded

    RateLimited --> WaitingForInput : Retry-After\nperiod expires

    ContextBuilding --> SearchingWeb : Search intent\ndetected
    ContextBuilding --> CallingLLM : No search needed

    SearchingWeb --> CallingLLM : Search results\ninjected into prompt

    CallingLLM --> Streaming : LLM response begins\n(SSE stream opens)

    Streaming --> PersistingMessages : Stream complete\n(full response received)

    PersistingMessages --> WaitingForInput : ai.chat_messages saved\nai.chats.updated_at refreshed\nAudit log written

    WaitingForInput --> Archived : User closes tab\nor session expires

    Archived --> [*]

    note right of ContextBuilding
        Checks ai.iris_context_cache
        If stale → rebuilds from
        core.user_profiles +
        meridian.* tables
    end note

    note right of Streaming
        Server-Sent Events (SSE)
        Text displayed token-by-token
        ~50ms per chunk
    end note
```

---

## State 3 — Trade Position Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PendingValidation : User submits trade\nPOST /api/trades

    PendingValidation --> BalanceChecked : require_auth() ✓\nrate_limit ✓

    BalanceChecked --> Rejected : Insufficient balance\n(cost > monthly_investable)

    Rejected --> [*]

    BalanceChecked --> Open : INSERT trading.open_positions\naction: OPENED

    Open --> PriceUpdating : WebSocket connected\n→ current_price updated live

    PriceUpdating --> Open : WebSocket tick\ncurrent_price refreshed

    Open --> PartiallyClosing : User closes\npartial quantity

    PartiallyClosing --> Open : trading.open_positions.quantity\nreduced, remainder stays open

    Open --> Closing : User closes\nfull position\nPOST /api/trades/close

    PartiallyClosing --> Closing : Remaining quantity\nclosed

    Closing --> PnLCalculated : exit_price received\npnl = (exit - entry) × qty

    PnLCalculated --> ProfitClosed : pnl > 0
    PnLCalculated --> LossClosed : pnl ≤ 0

    ProfitClosed --> Settled : INSERT trading.trades\n{action: CLOSED, pnl: +X}\nUPDATE monthly_investable += pnl
    LossClosed --> Settled : INSERT trading.trades\n{action: CLOSED, pnl: -X}\nUPDATE monthly_investable += pnl

    Settled --> Recorded : Upsert portfolio_history\n(daily snapshot)

    Recorded --> [*]

    note right of Open
        Position lives in:
        trading.open_positions
        Visible on /paper-trading page
    end note

    note right of Settled
        Historical record in:
        trading.trades
        Used for PnL charts
        and performance metrics
    end note
```

---

## State 4 — Financial Goal Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created : User sets goal\nPOST /api/meridian/onboard\nor goal creation form

    Created --> Active : INSERT meridian.user_goals\n{status: 'active'}

    Active --> OnTrack : Daily refresh:\nactual_amount ≥ plan_amount\ngoal_progress.on_track = true

    Active --> OffTrack : Daily refresh:\nactual_amount < plan_amount\ngoal_progress.on_track = false

    OnTrack --> OffTrack : Progress slips\nbehind schedule

    OffTrack --> OnTrack : User increases\ncontributions or\nmarket gains catch up

    OffTrack --> AlertGenerated : Variance > threshold\nINSERT meridian.risk_alerts\n{severity: 'medium', type: 'goal_risk'}

    AlertGenerated --> Active : Alert acknowledged\nby user

    OnTrack --> Completed : current_amount ≥ target_amount\nstatus → 'completed'

    OffTrack --> Completed : current_amount ≥ target_amount\n(caught up / early)

    Active --> Cancelled : User manually\ncancels goal\nstatus → 'cancelled'

    Completed --> [*]
    Cancelled --> [*]

    note right of OnTrack
        Tracked daily in:
        meridian.goal_progress
        { snapshot_date, actual_amount,
          plan_amount, variance_pct,
          on_track: true }
    end note

    note right of AlertGenerated
        Alert injected into IRIS
        context on next chat request.
        IRIS warns user proactively.
    end note
```

---

## State 5 — Academy Lesson & Quiz Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Locked : Lesson exists in DB\nbut tier not enrolled

    Locked --> Available : User enrolls in tier\nINSERT user_tier_enrollments

    Available --> InProgress : User opens lesson\nUPSERT user_lesson_progress\n{progress_pct: 0}

    InProgress --> InProgress : User reads sections/blocks\nprogress_pct increments

    InProgress --> QuizReady : All blocks read\nprogress_pct = 100

    QuizReady --> QuizAttempting : User starts quiz\nINSERT quiz_attempts

    QuizAttempting --> QuizSubmitted : User submits all answers\nINSERT quiz_answers (per question)

    QuizSubmitted --> Passed : score ≥ pass_threshold\npassed = true

    QuizSubmitted --> Failed : score < pass_threshold\npassed = false

    Failed --> QuizReady : User retries quiz\n(no attempt limit)

    Passed --> Completed : UPDATE user_lesson_progress\n{completed: true}\nNext lesson unlocked

    Completed --> [*]

    note right of InProgress
        User can ask IRIS questions
        at any time via
        academy_chat_sessions
    end note
```

---

## State 6 — Stock Ranking Cache Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Empty : Application starts\nNo rankings computed

    Empty --> Computing : First request:\nGET /api/stocks/ranking

    Computing --> Cached : Rankings computed:\n• 6-dim scores per stock\n• EMA smoothed\n• Tiers assigned\nStored in memory

    Cached --> Serving : Subsequent requests\n(< 10 min TTL)

    Serving --> Cached : Request served\ncache unchanged

    Cached --> Expired : 10 minute TTL\nreached

    Expired --> Computing : Next request\ntriggers recompute

    Cached --> Invalidated : Admin triggers\nmanual refresh\nGET /api/admin/refresh-ranking

    Invalidated --> Computing : Recompute rankings\nfrom fresh snapshots

    Computing --> Failed : market.stock_snapshots\nempty or unreachable

    Failed --> Empty : Error returned to client\n503 Service Unavailable

    note right of Cached
        Stored: Python dict in memory
        Persisted: market.ranking_history
        (for audit/analytics)
    end note
```
