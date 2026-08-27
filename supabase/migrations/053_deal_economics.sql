-- 053: What a B2B deal is actually worth, and over how long.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- A deal carried one number. In B2B that number is close to meaningless on
-- its own: 60k of retainer on a three year term and 60k of one-off project
-- work are not the same deal, are not worth the same to the business, and
-- should not sit next to each other in a forecast as equals.
--
-- So the shape is recorded instead of the total. How much recurs, how often
-- it recurs, how long the term runs, and whatever one-off sits on top.
-- Everything else - monthly recurring, annual recurring, total contract
-- value - is arithmetic on those four, done in one place rather than in
-- each person's head.
--
-- `value` stays, and stays authoritative for every existing total, board
-- column and forecast. When the shape is filled in, the app recomputes
-- `value` as the total contract value, so nothing downstream needs to know
-- this migration happened.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS recurring_amount numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS recurring_period text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS one_off_amount numeric;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS term_months integer;

DO $$
BEGIN
  -- How often the recurring part recurs. Constrained because normalising to
  -- a monthly figure is the whole point, and you cannot normalise a period
  -- somebody typed freehand.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_recurring_period_known') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_recurring_period_known
      CHECK (recurring_period IS NULL OR recurring_period IN ('month', 'quarter', 'year'));
  END IF;

  -- Negative money is never a real answer here, and a negative term would
  -- silently invert every total that multiplies by it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_economics_non_negative') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_economics_non_negative
      CHECK (
        (recurring_amount IS NULL OR recurring_amount >= 0)
        AND (one_off_amount IS NULL OR one_off_amount >= 0)
        AND (term_months IS NULL OR term_months > 0)
      );
  END IF;
END;
$$;

-- Existing deals keep their single number and gain no invented shape. A
-- guessed term would flow straight into a forecast as though somebody had
-- agreed it.

-- Reporting reads closed deals by when they closed, over and over.
CREATE INDEX IF NOT EXISTS idx_deals_user_closed
  ON deals (user_id, closed_at DESC) WHERE closed_at IS NOT NULL;
