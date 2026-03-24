# Diagram 5 — Database Schema (Class / ER Diagram)

**Diagram Type:** Entity-Relationship Diagram + Schema Class View
**Purpose:** Documents all 6 database schemas, their tables, key fields, data types, constraints, and relationships.

> The full Mermaid ER diagram is in [`../database-erd.md`](../database-erd.md).
> This file provides the **annotated schema breakdown** with field-level detail, organised by schema.

---

## Schema Architecture Overview

```mermaid
flowchart LR
    subgraph AUTH_EXT ["Supabase Auth (External)"]
        AU["auth.users\n(UUID, email, created_at)"]
    end

    subgraph CORE ["core schema\n(User identity & limits)"]
        CU["users"]
        CUP["user_profiles"]
        CA["achievements"]
        CRL["rate_limit_state"]
    end

    subgraph AI_SCH ["ai schema\n(Conversations)"]
        ACH["chats"]
        ACM["chat_messages"]
        AIC["iris_context_cache"]
    end

    subgraph TRADING ["trading schema\n(Paper Trading)"]
        TOP["open_positions"]
        TT["trades"]
        TJ["trade_journal"]
        TPH["portfolio_history"]
        TPT["paper_trades"]
        TPTC["paper_trade_closes"]
    end

    subgraph MARKET ["market schema\n(Market Data)"]
        MSS["stock_snapshots"]
        MI["market_indices"]
        MTS["trending_stocks"]
        MN["news"]
        MNA["news_articles"]
    end

    subgraph ACADEMY ["academy schema\n(Education)"]
        ATI["tiers"]
        AL["lessons"]
        ALS["lesson_sections"]
        ALB["lesson_blocks"]
        AQ["quizzes"]
        AQQ["quiz_questions"]
        AQQO["quiz_options"]
        AQQA["quiz_answers"]
        AQA["quiz_attempts"]
        AULP["user_lesson_progress"]
        AUTE["user_tier_enrollments"]
        ACS["chat_sessions"]
        ACSM["chat_messages"]
        APT["prompt_templates"]
        ALPL["lesson_prompt_links"]
    end

    subgraph MERIDIAN ["meridian schema\n(Planning & Goals)"]
        MUG["user_goals"]
        MGP["goal_progress"]
        MRA["risk_alerts"]
        MME["meridian_events"]
        MFP["financial_plans"]
        MID["intelligence_digests"]
        MLE["life_events"]
        MUP["user_positions"]
    end

    AU -->|"1:1 FK auth_id"| CU
    CU -->|"1:many"| CORE & AI_SCH & TRADING & ACADEMY
    AU -->|"1:many"| MERIDIAN
    MSS -.->|"read by ranking engine"| ACH
```

---

## Schema 1: `core` — User Identity

```mermaid
classDiagram
    class core_users {
        +UUID id PK
        +UUID auth_id FK
        +text first_name
        +text last_name
        +text email
        +int age
        +text experience_level
        +text risk_level
        +text userType "User | Admin"
        +bool is_verified
        +bool onboarding_complete
        +text marital_status
        +text investment_goal
        +timestamptz created_at
        +timestamptz updated_at
    }

    class core_user_profiles {
        +UUID id PK
        +UUID user_id FK
        +text age_range
        +text income_range
        +numeric monthly_expenses
        +numeric total_debt
        +int dependants
        +text risk_profile "low | mid | high | very_high"
        +int knowledge_tier "1 | 2 | 3"
        +text investment_horizon "short | medium | long"
        +int emergency_fund_months
        +numeric monthly_investable
    }

    class core_achievements {
        +UUID id PK
        +UUID user_id FK
        +text name
        +text icon
        +timestamptz unlocked_at
    }

    class core_rate_limit_state {
        +text identifier PK "user_id or IP"
        +text endpoint PK
        +text window_type PK "minute | hour | day"
        +int request_count
        +int token_count
        +timestamptz window_start
        +timestamptz blocked_until
    }

    core_users "1" --> "0..1" core_user_profiles : user_id
    core_users "1" --> "0..*" core_achievements : user_id
```

---

## Schema 2: `ai` — Conversations

```mermaid
classDiagram
    class ai_chats {
        +UUID id PK
        +UUID user_id FK
        +text title
        +timestamptz created_at
        +timestamptz updated_at
    }

    class ai_chat_messages {
        +UUID id PK
        +UUID user_id FK
        +UUID chat_id FK
        +text role "user | assistant"
        +text content
        +timestamptz created_at
    }

    class ai_iris_context_cache {
        +UUID user_id PK
        +jsonb profile_summary "risk, horizon, investable, emergency_fund_status"
        +jsonb active_goals "[ {goal_name, progress_pct, on_track} ]"
        +jsonb active_alerts "[ {type, severity, message} ]"
        +jsonb plan_status
        +int knowledge_tier
        +timestamptz updated_at
    }

    ai_chats "1" --> "0..*" ai_chat_messages : chat_id
```

---

## Schema 3: `trading` — Paper Trading

```mermaid
classDiagram
    class trading_open_positions {
        +UUID id PK
        +UUID user_id FK
        +text symbol
        +text name
        +numeric quantity
        +numeric entry_price
        +numeric current_price
        +text type "LONG | SHORT"
        +date entry_date
        +timestamptz updated_at
    }

    class trading_trades {
        +UUID id PK
        +UUID user_id FK
        +text symbol
        +text type "LONG | SHORT"
        +text action "OPENED | CLOSED"
        +numeric quantity
        +numeric entry_price
        +numeric exit_price
        +date entry_date
        +date exit_date
        +numeric pnl
        +timestamptz created_at
    }

    class trading_trade_journal {
        +UUID id PK
        +UUID user_id FK
        +UUID trade_id FK
        +text symbol
        +text type "BUY | SELL"
        +date date
        +numeric quantity
        +numeric price
        +text strategy
        +text notes
        +text[] tags
    }

    class trading_portfolio_history {
        +UUID id PK
        +UUID user_id FK
        +date date UK_with_user
        +numeric value
        +timestamptz created_at
    }

    class trading_paper_trades {
        +UUID id PK
        +UUID user_id FK
        +text symbol
        +text status "OPEN | CLOSED"
        +numeric quantity
        +numeric buy_price
        +date buy_date
    }

    class trading_paper_trade_closes {
        +UUID id PK
        +UUID user_id FK
        +UUID buy_trade_id FK
        +numeric quantity
        +numeric close_price
        +date close_date
    }

    trading_trades "1" --> "0..*" trading_trade_journal : trade_id
    trading_paper_trades "1" --> "0..*" trading_paper_trade_closes : buy_trade_id
```

---

## Schema 4: `market` — Market Data

```mermaid
classDiagram
    class market_stock_snapshots {
        +bigint ticker_id PK
        +text ticker UK
        +text company_name
        +numeric last_price
        +numeric price_change_pct
        +bigint volume
        +numeric sma_20
        +numeric sma_50
        +numeric ema_12
        +numeric ema_26
        +numeric rsi_14
        +numeric macd
        +numeric macd_signal
        +numeric bb_upper
        +numeric bb_lower
        +numeric bb_middle
        +numeric atr_14
        +numeric pe_ratio
        +numeric market_cap
        +numeric dividend_yield
        +numeric earnings_growth
        +text latest_signal
        +numeric signal_confidence
        +timestamptz synced_at
    }

    class market_market_indices {
        +UUID id PK
        +text symbol UK
        +text name
        +numeric value
        +numeric change_percent
        +bool is_positive
        +timestamptz updated_at
    }

    class market_trending_stocks {
        +UUID id PK
        +text symbol
        +text name
        +numeric change_percent
        +timestamptz updated_at
    }

    class market_news {
        +UUID id PK
        +text title
        +text summary
        +text link UK
        +text provider
        +timestamptz published_at
        +timestamptz created_at
    }

    class market_news_articles {
        +UUID id PK
        +text title
        +text summary
        +text link UK
        +text source
        +timestamptz published_at
    }
```

---

## Schema 5: `academy` — Financial Education

```mermaid
classDiagram
    class academy_tiers {
        +UUID id PK
        +text slug UK "foundation | intermediate | advanced"
        +text title
        +text description
        +int order_index
    }

    class academy_lessons {
        +UUID id PK
        +UUID tier_id FK
        +text slug UK
        +text title
        +text description
        +int order_index
        +bool is_published
    }

    class academy_lesson_sections {
        +UUID id PK
        +UUID lesson_id FK
        +text title
        +int order_index
    }

    class academy_lesson_blocks {
        +UUID id PK
        +UUID lesson_id FK
        +UUID section_id FK
        +text block_type "text | code | quiz | image"
        +text content
        +int order_index
    }

    class academy_quizzes {
        +UUID id PK
        +UUID lesson_id FK
        +text title
    }

    class academy_quiz_questions {
        +UUID id PK
        +UUID quiz_id FK
        +text question_text
        +int order_index
    }

    class academy_quiz_options {
        +UUID id PK
        +UUID question_id FK
        +text option_text
        +bool is_correct
        +int order_index
    }

    class academy_quiz_attempts {
        +UUID id PK
        +UUID quiz_id FK
        +UUID user_id FK
        +int score
        +bool passed
        +timestamptz attempted_at
    }

    class academy_quiz_answers {
        +UUID id PK
        +UUID attempt_id FK
        +UUID question_id FK
        +UUID selected_option_id FK
        +bool is_correct
    }

    class academy_user_lesson_progress {
        +UUID id PK
        +UUID user_id FK
        +UUID lesson_id FK
        +UUID last_quiz_attempt_id FK
        +bool completed
        +int progress_pct
        +timestamptz last_accessed
    }

    class academy_user_tier_enrollments {
        +UUID id PK
        +UUID user_id FK
        +UUID tier_id FK
        +timestamptz enrolled_at
    }

    class academy_chat_sessions {
        +UUID id PK
        +UUID user_id FK
        +UUID lesson_id FK
        +timestamptz created_at
    }

    class academy_chat_messages {
        +UUID id PK
        +UUID session_id FK
        +text role "user | assistant"
        +text content
        +timestamptz created_at
    }

    class academy_prompt_templates {
        +UUID id PK
        +text key UK
        +text template_text
    }

    class academy_lesson_prompt_links {
        +UUID id PK
        +UUID lesson_id FK
        +UUID prompt_template_id FK
    }

    academy_tiers "1" --> "0..*" academy_lessons : tier_id
    academy_tiers "1" --> "0..*" academy_user_tier_enrollments : tier_id
    academy_lessons "1" --> "0..*" academy_lesson_sections : lesson_id
    academy_lessons "1" --> "0..*" academy_lesson_blocks : lesson_id
    academy_lessons "1" --> "0..1" academy_quizzes : lesson_id
    academy_lessons "1" --> "0..*" academy_user_lesson_progress : lesson_id
    academy_lessons "1" --> "0..*" academy_chat_sessions : lesson_id
    academy_lessons "1" --> "0..*" academy_lesson_prompt_links : lesson_id
    academy_lesson_sections "1" --> "0..*" academy_lesson_blocks : section_id
    academy_quizzes "1" --> "0..*" academy_quiz_questions : quiz_id
    academy_quizzes "1" --> "0..*" academy_quiz_attempts : quiz_id
    academy_quiz_questions "1" --> "0..*" academy_quiz_options : question_id
    academy_quiz_questions "1" --> "0..*" academy_quiz_answers : question_id
    academy_quiz_attempts "1" --> "0..*" academy_quiz_answers : attempt_id
    academy_quiz_attempts "1" --> "0..*" academy_user_lesson_progress : last_quiz_attempt_id
    academy_chat_sessions "1" --> "0..*" academy_chat_messages : session_id
    academy_prompt_templates "1" --> "0..*" academy_lesson_prompt_links : prompt_template_id
```

---

## Schema 6: `meridian` — Goals & Financial Planning

```mermaid
classDiagram
    class meridian_user_goals {
        +UUID id PK
        +UUID user_id FK
        +text goal_name
        +numeric target_amount
        +numeric current_amount
        +date target_date
        +numeric monthly_contribution
        +numeric required_return_pct
        +text status "active | completed | cancelled"
        +timestamptz created_at
    }

    class meridian_goal_progress {
        +UUID id PK
        +UUID goal_id FK
        +date snapshot_date
        +numeric actual_amount
        +numeric plan_amount
        +numeric variance_pct
        +bool on_track
    }

    class meridian_risk_alerts {
        +UUID id PK
        +UUID user_id FK
        +text alert_type
        +text severity "low | medium | high"
        +text message
        +bool resolved
        +timestamptz resolved_at
        +timestamptz created_at
    }

    class meridian_meridian_events {
        +UUID id PK
        +UUID user_id FK
        +timestamptz occurred_at
        +text event_type
        +jsonb event_data
        +text source
    }

    class meridian_financial_plans {
        +UUID id PK
        +UUID user_id FK
        +jsonb plan_data
        +text trigger
        +bool is_current
        +timestamptz created_at
    }

    class meridian_intelligence_digests {
        +UUID id PK
        +UUID user_id FK
        +text digest_type
        +jsonb content
        +bool delivered
        +timestamptz delivered_at
        +timestamptz created_at
    }

    class meridian_life_events {
        +UUID id PK
        +UUID user_id FK
        +text event_type
        +date event_date
        +text notes
        +bool plan_recalculated
        +timestamptz created_at
    }

    class meridian_user_positions {
        +UUID id PK
        +UUID user_id FK
        +text ticker
        +numeric quantity
        +numeric avg_entry_price
        +timestamptz updated_at
    }

    meridian_user_goals "1" --> "0..*" meridian_goal_progress : goal_id
```

---

## Row-Level Security (RLS) Summary

| Schema | Policy | Effect |
|--------|--------|--------|
| `core.users` | `auth.uid() = auth_id` | Users see only their own row |
| `ai.chats` | `auth.uid() = user_id` | Users see only their own chats |
| `ai.chat_messages` | `auth.uid() = user_id` | Users see only their own messages |
| `trading.*` | `auth.uid() = user_id` | Users see only their own trades |
| `meridian.*` | `auth.uid() = user_id` | Users see only their own goals/plans |
| `academy.user_*` | `auth.uid() = user_id` | Users see only their progress |
| `market.*` | `TRUE` (public read) | All authenticated users can read |
| `core.rate_limit_state` | Service role only | No user-level access |

---

## Database Constraint Summary

| Table | Unique Constraint | Purpose |
|-------|-------------------|---------|
| `trading.portfolio_history` | `(user_id, date)` | One snapshot per user per day |
| `core.rate_limit_state` | `(identifier, endpoint, window_type)` | One counter per user/endpoint/window |
| `market.stock_snapshots` | `ticker` | One snapshot per ticker symbol |
| `market.news` | `link` | No duplicate news articles |
| `market.news_articles` | `link` | No duplicate legacy articles |
| `market.market_indices` | `symbol` | One entry per market index |
| `academy.tiers` | `slug` | One tier per knowledge level |
| `academy.lessons` | `slug` | Unique lesson identifiers |
| `academy.prompt_templates` | `key` | Unique prompt template keys |
