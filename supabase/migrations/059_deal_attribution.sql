-- 059: Which outreach produced which revenue.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The question nobody in this market can answer. Apollo knows reply rates and
-- stops at the handoff. Pipedrive knows won deals and does not know where they
-- came from. The join needs both halves of the funnel in one database, and
-- until now ours could not answer it either: deals.source is free text, so
-- "which sequence paid for itself" was a thing you reconstructed by hand from
-- two exports, if at all.
--
-- Four columns. The campaign and the step that produced the deal, when the
-- link was made, and - the important one - HOW it was decided.
--
-- Attribution strength is recorded rather than flattened, because these are
-- not the same claim:
--
--   thread    the deal was created from an email thread belonging to that
--             campaign. Direct evidence.
--   reply     the contact replied to that campaign before the deal existed.
--             Strong, and how most real deals will be attributed.
--   enrolment the contact was in that campaign and never replied. Weak - they
--             may have come from a referral a month later.
--   manual    somebody said so.
--
-- Reporting can then say "£212k attributed, of which £180k from replies" and
-- mean it. A single boolean would let the weakest evidence quietly inflate
-- every number built on top of it, which is how attribution dashboards end up
-- being ignored by the people who most need them.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_step_id uuid REFERENCES campaign_steps(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS attribution text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS attributed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_attribution_known') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_attribution_known
      CHECK (attribution IS NULL OR attribution IN ('thread', 'reply', 'enrolment', 'manual'));
  END IF;

  -- A strength with nothing to point at is not an attribution, and a campaign
  -- with no strength cannot be weighed. Neither half is useful alone.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_attribution_complete') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_attribution_complete
      CHECK (
        (attribution IS NULL AND source_campaign_id IS NULL)
        OR (attribution IS NOT NULL AND source_campaign_id IS NOT NULL)
      );
  END IF;
END;
$$;

-- Reporting reads "every deal this campaign produced" over and over.
CREATE INDEX IF NOT EXISTS idx_deals_source_campaign
  ON deals (source_campaign_id, stage) WHERE source_campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill, on evidence only.
--
-- Existing deals predate the idea, so they are attributed from what actually
-- happened: the last campaign this contact replied to BEFORE the deal was
-- created. Replies only - enrolment alone is too weak to assert retroactively,
-- and inventing it here would put numbers on a dashboard that nobody chose.
--
-- Deals with no contact, or no reply before their creation, stay unattributed.
-- That is the honest answer and it is better than a guess.
-- ---------------------------------------------------------------------------
WITH first_reply AS (
  SELECT DISTINCT ON (d.id)
    d.id           AS deal_id,
    ca.campaign_id AS campaign_id,
    ca.step_id     AS step_id
  FROM deals d
  JOIN campaign_activities ca
    ON ca.contact_id = d.contact_id
   AND ca.activity_type = 'replied'
   AND ca.occurred_at <= d.created_at
  WHERE d.contact_id IS NOT NULL
    AND d.source_campaign_id IS NULL
  ORDER BY d.id, ca.occurred_at DESC
)
UPDATE deals d
SET source_campaign_id = fr.campaign_id,
    source_step_id     = fr.step_id,
    attribution        = 'reply',
    attributed_at      = now()
FROM first_reply fr
WHERE d.id = fr.deal_id;
