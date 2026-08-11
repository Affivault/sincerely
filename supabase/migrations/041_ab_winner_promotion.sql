-- 041: Acting on an A/B result.
--
-- The analytics service has always computed a winner and then done nothing
-- with it. These two columns let a winner actually be applied: one records
-- that a step's test has been settled (so it isn't offered again, and so the
-- UI can say which variant won), and one opts a campaign into having that
-- happen on its own once the result is significant.

-- Which variant was promoted into the live copy, and when. NULL = still running.
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS ab_promoted_variant text;
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS ab_promoted_at timestamptz;

-- Guard the value rather than trusting the writer. Dropped first so re-running
-- this migration is safe.
ALTER TABLE campaign_steps DROP CONSTRAINT IF EXISTS campaign_steps_ab_promoted_variant_check;
ALTER TABLE campaign_steps
  ADD CONSTRAINT campaign_steps_ab_promoted_variant_check
  CHECK (ab_promoted_variant IS NULL OR ab_promoted_variant IN ('a', 'b'));

-- Opt in per campaign. Off by default: promoting a variant rewrites the copy
-- being sent, and that is not something to start doing to someone's live
-- campaign without being asked.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_auto_promote boolean NOT NULL DEFAULT false;

-- The auto-promote sweep looks for running campaigns that opted in. Partial,
-- because that is a small slice of the table and the index should be too.
CREATE INDEX IF NOT EXISTS idx_campaigns_ab_auto_promote
  ON campaigns (id)
  WHERE ab_auto_promote AND status = 'running';
