ALTER TABLE market.trending_stocks
ADD COLUMN IF NOT EXISTS signal_score numeric;

UPDATE market.trending_stocks
SET signal_score = 50
WHERE signal_score IS NULL;
