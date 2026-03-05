-- ============================================================
-- Paper Trading Refactor Migration
-- BUY lots are stored in paper_trades
-- SELL/close actions are stored in paper_trade_closes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.paper_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    buy_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    buy_quantity INTEGER NOT NULL CHECK (buy_quantity > 0),
    buy_price DECIMAL(10, 2) NOT NULL CHECK (buy_price > 0),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    tags TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.paper_trade_closes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    buy_trade_id UUID NOT NULL REFERENCES public.paper_trades(id) ON DELETE CASCADE,
    close_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    close_quantity INTEGER NOT NULL CHECK (close_quantity > 0),
    close_price DECIMAL(10, 2) NOT NULL CHECK (close_price > 0),
    reason TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_user_buy_time ON public.paper_trades(user_id, buy_time DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_user_status ON public.paper_trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_upper ON public.paper_trades(UPPER(symbol));
CREATE INDEX IF NOT EXISTS idx_paper_trade_closes_user_time ON public.paper_trade_closes(user_id, close_time DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trade_closes_trade_id ON public.paper_trade_closes(buy_trade_id);
CREATE INDEX IF NOT EXISTS idx_stock_snapshots_ticker_upper ON public.stock_snapshots(UPPER(ticker));

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_trade_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can insert own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can update own paper trades" ON public.paper_trades;
DROP POLICY IF EXISTS "Users can delete own paper trades" ON public.paper_trades;

CREATE POLICY "Users can view own paper trades"
ON public.paper_trades FOR SELECT
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can insert own paper trades"
ON public.paper_trades FOR INSERT
WITH CHECK (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can update own paper trades"
ON public.paper_trades FOR UPDATE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can delete own paper trades"
ON public.paper_trades FOR DELETE
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

DROP POLICY IF EXISTS "Users can view own paper trade closes" ON public.paper_trade_closes;
DROP POLICY IF EXISTS "Users can insert own paper trade closes" ON public.paper_trade_closes;

CREATE POLICY "Users can view own paper trade closes"
ON public.paper_trade_closes FOR SELECT
USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

CREATE POLICY "Users can insert own paper trade closes"
ON public.paper_trade_closes FOR INSERT
WITH CHECK (
    auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id)
    AND EXISTS (
        SELECT 1
        FROM public.paper_trades pt
        WHERE pt.id = buy_trade_id
          AND pt.user_id = paper_trade_closes.user_id
    )
);

CREATE OR REPLACE FUNCTION public.validate_paper_trade_symbol_exists()
RETURNS TRIGGER AS $$
BEGIN
    NEW.symbol = UPPER(TRIM(NEW.symbol));

    PERFORM 1
    FROM public.stock_snapshots ss
    WHERE UPPER(ss.ticker) = NEW.symbol
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticker "%" does not exist in stock_snapshots', NEW.symbol
            USING ERRCODE = '23503',
                  HINT = 'Use a valid ticker present in stock_snapshots.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_paper_trade_close_insert()
RETURNS TRIGGER AS $$
DECLARE
    target_trade public.paper_trades%ROWTYPE;
    already_closed INTEGER;
BEGIN
    IF NEW.close_quantity <= 0 THEN
        RAISE EXCEPTION 'close_quantity must be greater than 0';
    END IF;

    IF NEW.close_price <= 0 THEN
        RAISE EXCEPTION 'close_price must be greater than 0';
    END IF;

    SELECT *
    INTO target_trade
    FROM public.paper_trades
    WHERE id = NEW.buy_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BUY trade % not found', NEW.buy_trade_id;
    END IF;

    IF target_trade.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Close user_id must match BUY trade user_id';
    END IF;

    SELECT COALESCE(SUM(close_quantity), 0)
    INTO already_closed
    FROM public.paper_trade_closes
    WHERE buy_trade_id = NEW.buy_trade_id;

    IF already_closed + NEW.close_quantity > target_trade.buy_quantity THEN
        RAISE EXCEPTION 'Cannot close % shares. Open quantity is %.',
            NEW.close_quantity,
            target_trade.buy_quantity - already_closed;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_paper_trade_core_field_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol
       OR NEW.buy_time IS DISTINCT FROM OLD.buy_time
       OR NEW.buy_quantity IS DISTINCT FROM OLD.buy_quantity
       OR NEW.buy_price IS DISTINCT FROM OLD.buy_price THEN
        RAISE EXCEPTION 'BUY trade core fields are immutable. Create a new BUY lot instead.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.refresh_paper_trade_status_after_close()
RETURNS TRIGGER AS $$
DECLARE
    buy_qty INTEGER;
    total_closed INTEGER;
BEGIN
    SELECT buy_quantity
    INTO buy_qty
    FROM public.paper_trades
    WHERE id = NEW.buy_trade_id;

    SELECT COALESCE(SUM(close_quantity), 0)
    INTO total_closed
    FROM public.paper_trade_closes
    WHERE buy_trade_id = NEW.buy_trade_id;

    UPDATE public.paper_trades
    SET
        status = CASE WHEN total_closed >= buy_qty THEN 'CLOSED' ELSE 'OPEN' END,
        updated_at = NOW()
    WHERE id = NEW.buy_trade_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_paper_trade_symbol ON public.paper_trades;
CREATE TRIGGER trigger_validate_paper_trade_symbol
    BEFORE INSERT OR UPDATE OF symbol ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_paper_trade_symbol_exists();

DROP TRIGGER IF EXISTS update_paper_trades_updated_at ON public.paper_trades;
CREATE TRIGGER update_paper_trades_updated_at
    BEFORE UPDATE ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_prevent_paper_trade_core_field_updates ON public.paper_trades;
CREATE TRIGGER trigger_prevent_paper_trade_core_field_updates
    BEFORE UPDATE ON public.paper_trades
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_paper_trade_core_field_updates();

DROP TRIGGER IF EXISTS trigger_validate_paper_trade_close_insert ON public.paper_trade_closes;
CREATE TRIGGER trigger_validate_paper_trade_close_insert
    BEFORE INSERT ON public.paper_trade_closes
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_paper_trade_close_insert();

DROP TRIGGER IF EXISTS trigger_refresh_paper_trade_status_after_close ON public.paper_trade_closes;
CREATE TRIGGER trigger_refresh_paper_trade_status_after_close
    AFTER INSERT ON public.paper_trade_closes
    FOR EACH ROW
    EXECUTE FUNCTION public.refresh_paper_trade_status_after_close();

UPDATE public.paper_trades pt
SET
    status = CASE
        WHEN COALESCE((
            SELECT SUM(c.close_quantity)::INTEGER
            FROM public.paper_trade_closes c
            WHERE c.buy_trade_id = pt.id
        ), 0) >= pt.buy_quantity THEN 'CLOSED'
        ELSE 'OPEN'
    END,
    updated_at = NOW()
;
