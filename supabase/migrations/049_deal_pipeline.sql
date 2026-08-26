-- 049_deal_pipeline.sql
--
-- What a pipeline needs to be a forecast rather than a list.
--
-- The deals table could tell you what a deal was worth and what stage it was
-- in, and nothing about whether it was moving, how likely it was, or why the
-- ones that ended ended. Four columns fix that:
--
--   probability       this deal's own odds, when the stage default is wrong.
--   outcome_reason    why it was won or lost, so the answers are countable.
--   closed_at         when it finished, for cycle length and "won this month".
--   stage_changed_at  when it last moved. Deliberately separate from
--                     updated_at, which moves when somebody fixes a typo and
--                     therefore cannot answer "has this deal moved?".
--
-- Safe to run more than once.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS probability integer;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS outcome_reason text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;

-- Odds are a percentage or nothing at all. A stored 140% would quietly
-- inflate every forecast it appeared in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_probability_range'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_probability_range
      CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));
  END IF;
END $$;

-- Existing rows get a starting point rather than a null that would read as
-- "never moved". updated_at is the best available evidence of when a deal was
-- last touched, and for a row that has not been edited since it was made it is
-- exactly right.
UPDATE deals
   SET stage_changed_at = COALESCE(updated_at, created_at, now())
 WHERE stage_changed_at IS NULL;

-- Deals already sitting in won or lost closed at some point, and the same
-- timestamp is the closest honest answer we have. Without this every historic
-- deal is missing from win rate and cycle length.
UPDATE deals
   SET closed_at = COALESCE(updated_at, created_at, now())
 WHERE closed_at IS NULL
   AND stage IN ('won', 'lost');

-- The board reads open deals by stage and orders them; the header sums closed
-- ones by date. Both are per user.
CREATE INDEX IF NOT EXISTS idx_deals_user_stage_position
  ON deals(user_id, stage, position);

CREATE INDEX IF NOT EXISTS idx_deals_user_closed
  ON deals(user_id, closed_at)
  WHERE closed_at IS NOT NULL;

-- Rot is "open deals that have not moved", so the index only needs the open
-- ones. A partial index here stays small no matter how much history builds up.
CREATE INDEX IF NOT EXISTS idx_deals_user_stage_changed
  ON deals(user_id, stage_changed_at)
  WHERE stage IN ('lead', 'qualified', 'proposal');
