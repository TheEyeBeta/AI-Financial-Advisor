-- The Eye Trade Engine Snapshots
-- This table stores snapshots/connections from The Eye trade engine
-- The Eye is a separate external trade engine that users can connect to

CREATE TABLE IF NOT EXISTS public.eye_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- Snapshot metadata
    snapshot_name TEXT,
    snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Portfolio data from The Eye
    portfolio_value DECIMAL(12, 2),
    total_positions INTEGER DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    
    -- Performance metrics from The Eye
    win_rate DECIMAL(5, 2),
    total_pnl DECIMAL(12, 2),
    realized_pnl DECIMAL(12, 2),
    unrealized_pnl DECIMAL(12, 2),
    profit_factor DECIMAL(5, 2),
    avg_profit DECIMAL(10, 2),
    avg_loss DECIMAL(10, 2),
    
    -- Raw data from The Eye (stored as JSONB for flexibility)
    raw_data JSONB,
    
    -- Connection status
    is_active BOOLEAN DEFAULT TRUE,
    is_latest BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure only one active/latest snapshot per user
    CONSTRAINT unique_latest_per_user UNIQUE NULLS NOT DISTINCT (user_id, is_latest) WHERE (is_latest = TRUE)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_id ON public.eye_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_latest ON public.eye_snapshots(user_id, is_latest) WHERE (is_latest = TRUE);
CREATE INDEX IF NOT EXISTS idx_eye_snapshots_user_active ON public.eye_snapshots(user_id, is_active) WHERE (is_active = TRUE);

-- RLS Policies
ALTER TABLE public.eye_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can view their own snapshots
CREATE POLICY "Users can view their own eye snapshots"
    ON public.eye_snapshots
    FOR SELECT
    USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

-- Users can insert their own snapshots
CREATE POLICY "Users can insert their own eye snapshots"
    ON public.eye_snapshots
    FOR INSERT
    WITH CHECK (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

-- Users can update their own snapshots
CREATE POLICY "Users can update their own eye snapshots"
    ON public.eye_snapshots
    FOR UPDATE
    USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

-- Users can delete their own snapshots
CREATE POLICY "Users can delete their own eye snapshots"
    ON public.eye_snapshots
    FOR DELETE
    USING (auth.uid() IN (SELECT auth_id FROM public.users WHERE id = user_id));

-- Function to automatically set is_latest flag (only one latest per user)
CREATE OR REPLACE FUNCTION set_latest_eye_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    -- If this snapshot is marked as latest, unmark all others for this user
    IF NEW.is_latest = TRUE THEN
        UPDATE public.eye_snapshots
        SET is_latest = FALSE
        WHERE user_id = NEW.user_id
        AND id != NEW.id
        AND is_latest = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce single latest snapshot
CREATE TRIGGER trigger_set_latest_eye_snapshot
    BEFORE INSERT OR UPDATE ON public.eye_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION set_latest_eye_snapshot();
