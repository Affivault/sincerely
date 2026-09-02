-- 061: What happens after a deal is won.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The gap this closes is the one both halves of the market leave open. An
-- outreach tool does not know a deal exists, so it stops at the reply. A CRM
-- knows the deal but its sequencer only takes a static list somebody exports
-- and re-imports, so the renewal becomes a calendar reminder a human sets and
-- then ignores. A renewal is the most predictable revenue event in B2B and
-- it is the one nobody automates.
--
-- This app already knows the term, when the deal closed, who the people are,
-- and it owns the sending. That is everything needed to turn a closed deal
-- into a dated sequence that runs backwards from the renewal date, without
-- anybody exporting a CSV.
--
-- Three parts:
--   1. deals learn when they come up again, and what happened when they did
--   2. campaigns learn who they are for and what starts them
--   3. a ledger, so an automatic enrolment can never happen twice

-- ---------------------------------------------------------------------------
-- 1. The renewal
--
-- Stored rather than computed on read. A contract signed in March that starts
-- in April renews in April, and no arithmetic on closed_at will ever know
-- that - so the derived value is a starting point somebody can correct, not a
-- truth. It also has to be indexable: the worker's question is "which deals
-- come up in the next N days", and that is a range scan or it is a sequential
-- scan of every deal you have ever won.
-- ---------------------------------------------------------------------------

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS renewal_date         date,
  -- Where this renewal stands. Null until the deal is won.
  ADD COLUMN IF NOT EXISTS renewal_status       text,
  -- The deal the renewal became, so a second year is traceable to its first
  -- and the same revenue is never counted as new twice.
  ADD COLUMN IF NOT EXISTS renewed_to_deal_id   uuid REFERENCES deals(id) ON DELETE SET NULL,
  -- Contracts that auto-renew unless cancelled N days out. That notice date,
  -- not the renewal date, is the real deadline, and it is the one people miss.
  ADD COLUMN IF NOT EXISTS renewal_notice_days  integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_renewal_status_known') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_renewal_status_known
      CHECK (renewal_status IS NULL
             OR renewal_status IN ('upcoming', 'renewed', 'churned', 'not_applicable'));
  END IF;

  -- A negative notice period would push the deadline past the renewal, which
  -- reads as "you have longer than you do".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_renewal_notice_sane') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_renewal_notice_sane
      CHECK (renewal_notice_days IS NULL
             OR (renewal_notice_days >= 0 AND renewal_notice_days <= 365));
  END IF;

  -- A deal cannot be its own renewal. Without this one mis-click makes a
  -- cycle that every chain walk has to defend against forever.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_renewal_not_self') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_renewal_not_self
      CHECK (renewed_to_deal_id IS NULL OR renewed_to_deal_id <> id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Filling it in.
--
-- A trigger rather than application code, because deals are written from
-- several places - the board, lead conversion, imports - and a renewal date
-- that only appears when one of those paths is used is worse than none.
--
-- Deliberately written as a transition rather than as "fill any blank". The
-- obvious version - derive whenever renewal_date IS NULL - resurrects a date
-- somebody has just deleted, on the next unrelated edit to the deal. Renewal
-- dates get diarised and acted on; one that comes back after being removed is
-- worse than one that was never there.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deal_set_renewal_on_won()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entering_won  boolean;
  term_just_set boolean;
BEGIN
  entering_won := NEW.stage = 'won'
    AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'won');

  -- The other honest moment to derive: a deal that was already won and had
  -- no term recorded, where somebody has now filled the term in. Nobody has
  -- expressed a view about its renewal yet, so there is nothing to overwrite.
  term_just_set := TG_OP = 'UPDATE'
    AND NEW.stage = 'won'
    AND OLD.stage = 'won'
    AND NEW.renewal_date IS NULL
    AND NEW.renewal_status IS NULL
    AND OLD.term_months IS DISTINCT FROM NEW.term_months;

  IF (entering_won OR term_just_set) AND NEW.closed_at IS NOT NULL THEN
    -- The term is what was agreed. No default is applied on purpose: a
    -- guessed twelve months would put an invented date in front of somebody
    -- as though it were a fact.
    IF NEW.renewal_date IS NULL AND NEW.term_months IS NOT NULL AND NEW.term_months > 0 THEN
      NEW.renewal_date := (NEW.closed_at + make_interval(months => NEW.term_months))::date;
    END IF;

    IF NEW.renewal_status IS NULL AND NEW.renewal_date IS NOT NULL THEN
      NEW.renewal_status := 'upcoming';
    END IF;
  END IF;

  -- Reopened, or moved back out of won: the renewal is no longer a fact
  -- about this deal. The date is kept - it was probably right - but it stops
  -- being counted or acted on.
  IF NEW.stage <> 'won' AND NEW.renewal_status = 'upcoming' THEN
    NEW.renewal_status := NULL;
  END IF;

  -- An upcoming renewal with no date cannot be scheduled, reported or acted
  -- on, and would sit in the queue as a row nothing can be done about.
  IF NEW.renewal_status = 'upcoming' AND NEW.renewal_date IS NULL THEN
    NEW.renewal_status := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_set_renewal_on_won ON deals;
CREATE TRIGGER trg_deal_set_renewal_on_won
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION deal_set_renewal_on_won();

-- The two questions asked constantly once this exists: what is coming up,
-- and what came up and was never dealt with. Partial, because deals with no
-- renewal are the majority and indexing them buys nothing.
CREATE INDEX IF NOT EXISTS idx_deals_renewal_due
  ON deals (user_id, renewal_date)
  WHERE renewal_status = 'upcoming' AND renewal_date IS NOT NULL;

-- Backfill won deals that already have a term. Same rule as the trigger:
-- only where nobody has said otherwise.
UPDATE deals
   SET renewal_date = (closed_at + make_interval(months => term_months))::date,
       renewal_status = 'upcoming'
 WHERE stage = 'won'
   AND closed_at IS NOT NULL
   AND term_months IS NOT NULL
   AND term_months > 0
   AND renewal_date IS NULL
   AND renewal_status IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Who a campaign is for
--
-- Every campaign until now was cold, and the enrolment guards assume it:
-- somebody on an open deal is refused, and so is somebody who lives only in
-- a CRM contact list. Both of those are exactly right for a pitch and exactly
-- wrong for a renewal, where being a customer is the entry condition rather
-- than a reason to stay away. So a campaign has to say which it is, and the
-- guards have to read it, instead of a flag being smuggled in per call.
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS audience            text NOT NULL DEFAULT 'cold',
  -- What starts it. Null or 'manual' means a person does.
  ADD COLUMN IF NOT EXISTS trigger_event       text,
  -- For renewal_due, how many days BEFORE the renewal it begins. For the
  -- others, how many days after the event.
  ADD COLUMN IF NOT EXISTS trigger_offset_days integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_audience_known') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_audience_known
      CHECK (audience IN ('cold', 'post_sale'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_trigger_known') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_trigger_known
      CHECK (trigger_event IS NULL
             OR trigger_event IN ('manual', 'deal_won', 'renewal_due', 'deal_lost'));
  END IF;

  -- An automatic trigger on a cold campaign would enrol customers into a
  -- pitch. Refused in the database because it is the one mistake here that
  -- reaches a real person before anybody notices.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_trigger_needs_post_sale') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_trigger_needs_post_sale
      CHECK (trigger_event IS NULL
             OR trigger_event = 'manual'
             OR audience = 'post_sale');
  END IF;

  -- Nobody schedules a renewal sequence to start after the renewal, and a
  -- negative offset would mean exactly that.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_trigger_offset_sane') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_trigger_offset_sane
      CHECK (trigger_offset_days >= 0 AND trigger_offset_days <= 365);
  END IF;
END;
$$;

-- The worker's question every tick: which campaigns fire off CRM state?
CREATE INDEX IF NOT EXISTS idx_campaigns_triggered
  ON campaigns (user_id, trigger_event)
  WHERE trigger_event IS NOT NULL AND trigger_event <> 'manual';

-- ---------------------------------------------------------------------------
-- 3. The ledger
--
-- An automatic enrolment has to be exactly-once, and "did we already do this?"
-- cannot be answered from campaign_contacts alone. That table is unique on
-- (campaign_id, contact_id) and holds current state, so a customer renewing
-- three years running looks identical to one enrolled once - and deleting
-- last year's row to make room would erase the fact it ever ran.
--
-- The cycle key is what separates one occasion from the next: the renewal
-- date for a renewal, the close date for a won or lost deal. Next year is a
-- new key and enrols again; this year cannot enrol twice however many times
-- the worker ticks.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lifecycle_enrolments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id         uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  deal_id             uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Which trigger put them here, kept so a run can be explained a year later.
  trigger_event       text NOT NULL,
  -- The occasion. Renewal date, or close date.
  cycle_key           date NOT NULL,
  -- The row in campaign_contacts this drove, so the send can be followed.
  campaign_contact_id uuid REFERENCES campaign_contacts(id) ON DELETE SET NULL,
  enrolled_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, deal_id, contact_id, cycle_key)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_enrolments_deal
  ON lifecycle_enrolments (deal_id, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_enrolments_user
  ON lifecycle_enrolments (user_id, enrolled_at DESC);

ALTER TABLE lifecycle_enrolments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'lifecycle_enrolments'
       AND policyname = 'Users can manage their own lifecycle enrolments'
  ) THEN
    CREATE POLICY "Users can manage their own lifecycle enrolments"
      ON lifecycle_enrolments FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;
