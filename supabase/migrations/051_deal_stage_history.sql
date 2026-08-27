-- 051: Deal stage history - every move a deal makes, recorded as it happens.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The pipeline could say a deal was stalled but never how it got there. A
-- deal sitting in Proposal for forty days is a different conversation
-- depending on whether it went Lead -> Qualified -> Proposal over a quarter
-- or was dropped straight into Proposal on day one and forgotten.
--
-- Recorded by a trigger rather than in application code on purpose: bulk
-- stage moves, the board's drag handler, the table's dropdown and anything
-- written directly against the database all go through the same one place,
-- so the history cannot be bypassed by a code path that forgot to log.

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- Null on the opening row: the deal did not come from anywhere.
  from_stage text,
  to_stage text NOT NULL,
  -- The won/lost reason as it stood at the moment of the move, if any.
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events (deal_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_user
  ON deal_stage_events (user_id, changed_at DESC);

-- One row per real transition. A write that sets stage to what it already
-- was is not a move and must not appear as one, or every form save would
-- look like progress.
CREATE OR REPLACE FUNCTION record_deal_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_events (user_id, deal_id, from_stage, to_stage, reason, changed_at)
    VALUES (NEW.user_id, NEW.id, NULL, NEW.stage, NEW.outcome_reason,
            COALESCE(NEW.stage_changed_at, NEW.created_at, now()));
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO deal_stage_events (user_id, deal_id, from_stage, to_stage, reason, changed_at)
    VALUES (NEW.user_id, NEW.id, OLD.stage, NEW.stage, NEW.outcome_reason,
            COALESCE(NEW.stage_changed_at, now()));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_stage_event ON deals;
CREATE TRIGGER trg_deals_stage_event
  AFTER INSERT OR UPDATE OF stage ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_event();

-- Backfill. There is no record of where existing deals have been, and
-- inventing a path would be worse than having none, so each one gets a
-- single honest row: it has been in its current stage since the timestamp
-- we do have. Guarded so re-running this file adds nothing.
INSERT INTO deal_stage_events (user_id, deal_id, from_stage, to_stage, reason, changed_at)
SELECT d.user_id, d.id, NULL, d.stage, d.outcome_reason,
       COALESCE(d.stage_changed_at, d.created_at, now())
FROM deals d
WHERE NOT EXISTS (
  SELECT 1 FROM deal_stage_events e WHERE e.deal_id = d.id
);
