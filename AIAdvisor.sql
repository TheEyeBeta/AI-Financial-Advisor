-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.achievements (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  icon text,
  unlocked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT achievements_pkey PRIMARY KEY (id),
  CONSTRAINT achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE ai.chat_messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  chat_id uuid,
  CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id),
  CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES ai.chats(id)
);
CREATE TABLE ai.chats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text DEFAULT 'New Chat'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chats_pkey PRIMARY KEY (id),
  CONSTRAINT chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id)
);
CREATE TABLE public.financial_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  plan_data jsonb NOT NULL,
  trigger text,
  is_current boolean DEFAULT true,
  CONSTRAINT financial_plans_pkey PRIMARY KEY (id),
  CONSTRAINT financial_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.goal_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  actual_amount numeric,
  plan_amount numeric,
  variance_pct numeric,
  on_track boolean,
  CONSTRAINT goal_progress_pkey PRIMARY KEY (id),
  CONSTRAINT goal_progress_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.user_goals(id)
);
CREATE TABLE public.intelligence_digests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  digest_type text,
  content jsonb,
  delivered boolean DEFAULT false,
  delivered_at timestamp with time zone,
  CONSTRAINT intelligence_digests_pkey PRIMARY KEY (id),
  CONSTRAINT intelligence_digests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.iris_context_cache (
  user_id uuid NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  profile_summary jsonb,
  active_goals jsonb,
  active_alerts jsonb,
  plan_status jsonb,
  knowledge_tier integer,
  CONSTRAINT iris_context_cache_pkey PRIMARY KEY (user_id),
  CONSTRAINT iris_context_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.learning_topics (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  topic_name text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT learning_topics_pkey PRIMARY KEY (id),
  CONSTRAINT learning_topics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.life_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text,
  event_date date,
  notes text,
  plan_recalculated boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT life_events_pkey PRIMARY KEY (id),
  CONSTRAINT life_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.market_indices (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  symbol text NOT NULL UNIQUE,
  name text NOT NULL,
  value numeric NOT NULL,
  change_percent numeric NOT NULL,
  is_positive boolean NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT market_indices_pkey PRIMARY KEY (id)
);
CREATE TABLE public.meridian_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  occurred_at timestamp with time zone DEFAULT now(),
  event_type text,
  event_data jsonb,
  source text,
  CONSTRAINT meridian_events_pkey PRIMARY KEY (id),
  CONSTRAINT meridian_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.news (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  summary text NOT NULL DEFAULT ''::text,
  link text NOT NULL UNIQUE,
  provider text,
  published_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT news_pkey PRIMARY KEY (id)
);
CREATE TABLE public.open_positions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  name text,
  quantity integer NOT NULL,
  entry_price numeric NOT NULL,
  current_price numeric,
  type text NOT NULL CHECK (type = ANY (ARRAY['LONG'::text, 'SHORT'::text])),
  entry_date timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT open_positions_pkey PRIMARY KEY (id),
  CONSTRAINT open_positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.paper_trade_closes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  buy_trade_id uuid NOT NULL,
  close_time timestamp with time zone NOT NULL DEFAULT now(),
  close_quantity integer NOT NULL CHECK (close_quantity > 0),
  close_price numeric NOT NULL CHECK (close_price > 0::numeric),
  reason text,
  tags ARRAY,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT paper_trade_closes_pkey PRIMARY KEY (id),
  CONSTRAINT paper_trade_closes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT paper_trade_closes_buy_trade_id_fkey FOREIGN KEY (buy_trade_id) REFERENCES public.paper_trades(id)
);
CREATE TABLE public.paper_trades (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  buy_time timestamp with time zone NOT NULL DEFAULT now(),
  buy_quantity integer NOT NULL CHECK (buy_quantity > 0),
  buy_price numeric NOT NULL CHECK (buy_price > 0::numeric),
  status text NOT NULL DEFAULT 'OPEN'::text CHECK (status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])),
  tags ARRAY,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT paper_trades_pkey PRIMARY KEY (id),
  CONSTRAINT paper_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.portfolio_history (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  value numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT portfolio_history_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.risk_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  alert_type text,
  severity text,
  message text,
  resolved boolean DEFAULT false,
  resolved_at timestamp with time zone,
  CONSTRAINT risk_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT risk_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.stock_snapshots (
  ticker_id bigint NOT NULL,
  ticker character varying NOT NULL,
  company_name character varying,
  last_price numeric,
  last_price_ts timestamp with time zone,
  price_change_pct numeric,
  price_change_abs numeric,
  high_52w numeric,
  low_52w numeric,
  updated_at timestamp with time zone,
  volume bigint,
  avg_volume_10d bigint,
  avg_volume_30d bigint,
  volume_ratio numeric,
  sma_10 numeric,
  sma_20 numeric,
  sma_50 numeric,
  sma_100 numeric,
  sma_200 numeric,
  ema_10 numeric,
  ema_20 numeric,
  ema_50 numeric,
  ema_200 numeric,
  rsi_14 numeric,
  rsi_9 numeric,
  stochastic_k numeric,
  stochastic_d numeric,
  williams_r numeric,
  cci numeric,
  macd numeric,
  macd_signal numeric,
  macd_histogram numeric,
  adx numeric,
  bollinger_upper numeric,
  bollinger_middle numeric,
  bollinger_lower numeric,
  pe_ratio numeric,
  forward_pe numeric,
  peg_ratio numeric,
  price_to_book numeric,
  price_to_sales numeric,
  dividend_yield numeric,
  market_cap numeric,
  eps numeric,
  eps_growth numeric,
  revenue_growth numeric,
  price_vs_sma_50 numeric,
  price_vs_sma_200 numeric,
  price_vs_ema_50 numeric,
  price_vs_ema_200 numeric,
  price_vs_bollinger_middle numeric,
  is_bullish boolean,
  is_oversold boolean,
  is_overbought boolean,
  latest_signal character varying,
  signal_strategy character varying,
  signal_confidence numeric,
  signal_timestamp timestamp with time zone,
  last_news_ts timestamp with time zone,
  news_count_24h integer,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stock_snapshots_pkey PRIMARY KEY (ticker_id)
);
CREATE TABLE public.trade_journal (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  trade_id uuid,
  symbol text NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['BUY'::text, 'SELL'::text])),
  date date NOT NULL,
  quantity integer NOT NULL,
  price numeric NOT NULL,
  strategy text,
  notes text,
  tags ARRAY,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trade_journal_pkey PRIMARY KEY (id),
  CONSTRAINT trade_journal_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id),
  CONSTRAINT trade_journal_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.trades (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['LONG'::text, 'SHORT'::text])),
  action text NOT NULL CHECK (action = ANY (ARRAY['OPENED'::text, 'CLOSED'::text])),
  quantity integer NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric,
  entry_date timestamp with time zone NOT NULL,
  exit_date timestamp with time zone,
  pnl numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trades_pkey PRIMARY KEY (id),
  CONSTRAINT trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.trending_stocks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  name text NOT NULL,
  change_percent numeric NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trending_stocks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_name text NOT NULL,
  target_amount numeric NOT NULL,
  current_amount numeric DEFAULT 0,
  target_date date,
  monthly_contribution numeric,
  required_return_pct numeric,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_goals_pkey PRIMARY KEY (id),
  CONSTRAINT user_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  quantity numeric,
  avg_cost numeric,
  current_value numeric,
  pct_of_portfolio numeric,
  last_updated timestamp with time zone DEFAULT now(),
  CONSTRAINT user_positions_pkey PRIMARY KEY (id),
  CONSTRAINT user_positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  age_range text,
  income_range text,
  monthly_expenses numeric,
  total_debt numeric,
  dependants integer DEFAULT 0,
  risk_profile text,
  knowledge_tier integer DEFAULT 1,
  investment_horizon text,
  emergency_fund_months numeric,
  monthly_investable numeric,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  auth_id uuid NOT NULL UNIQUE,
  first_name text,
  last_name text,
  age integer CHECK (age >= 13 AND age <= 150),
  email text,
  experience_level USER-DEFINED DEFAULT 'beginner'::experience_level_enum,
  risk_level USER-DEFINED DEFAULT 'mid'::risk_level_enum,
  is_verified boolean DEFAULT false,
  email_verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  userType USER-DEFINED NOT NULL DEFAULT 'User'::type_of_user,
  onboarding_complete boolean DEFAULT false,
  marital_status USER-DEFINED,
  investment_goal USER-DEFINED,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_new_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id)
);
