-- 067: Which sequence booked the meeting.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The question this product exists to answer, and the one every standalone
-- scheduler is structurally unable to: a booking page that does not own the
-- outreach cannot know which email produced the meeting.
--
-- 059 gave deals an attribution model with four strengths - thread, reply,
-- enrolment, manual - and was careful to record HOW a link was decided
-- rather than flattening it to a boolean. This adds a fifth, and it is the
-- strongest one there will ever be:
--
--   booking   they clicked the link in a specific step of a specific
--             sequence and put a meeting in the diary. Not "they replied
--             around then", not "they were enrolled at the time". They
--             acted, on that email, and the action is the meeting itself.
--
-- Nothing above 'thread' existed before because nothing could. This one is
-- not inference at all, which is why it sits at the top.

-- ---------------------------------------------------------------------------
-- 1. A booking remembers where it came from
-- ---------------------------------------------------------------------------

ALTER TABLE crm_events
  ADD COLUMN IF NOT EXISTS source_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_step_id     uuid REFERENCES campaign_steps(id) ON DELETE SET NULL;

-- "How many meetings did this sequence book" is the report this unlocks, and
-- it is a count over exactly this index.
CREATE INDEX IF NOT EXISTS idx_crm_events_source_campaign
  ON crm_events (source_campaign_id, starts_at)
  WHERE source_campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The strongest attribution there is
--
-- The constraint is replaced rather than altered, because a CHECK cannot be
-- extended in place. Dropping first is safe: no existing row can violate the
-- wider rule, since every permitted value is still permitted.
-- ---------------------------------------------------------------------------

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_attribution_known;

ALTER TABLE deals ADD CONSTRAINT deals_attribution_known
  CHECK (attribution IS NULL OR attribution IN ('booking', 'thread', 'reply', 'enrolment', 'manual'));

-- ---------------------------------------------------------------------------
-- 3. What a booking page may show somebody it recognises
--
-- A link that arrives in a campaign email carries a signed token naming the
-- send it came from. The page reads it to greet the person by name and fill
-- in the email it already knows, which is the difference between a form and
-- a confirmation.
--
-- The token is an HMAC of campaign_contact_id and step_id, verified by the
-- API - there is nothing to store here. What IS stored is the fact that a
-- link was opened from a campaign at all, so "this sequence produced eleven
-- page views and three meetings" is answerable without reading the token
-- back out of anything.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS booking_link_visits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      uuid NOT NULL REFERENCES booking_links(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Null for a link opened cold, from a signature or a website.
  campaign_id  uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  step_id      uuid REFERENCES campaign_steps(id) ON DELETE SET NULL,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Set when the visit turned into a meeting, so conversion is a join-free
  -- count rather than a correlation over timestamps.
  booked_event_id uuid REFERENCES crm_events(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_link_visits_link
  ON booking_link_visits (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_link_visits_campaign
  ON booking_link_visits (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- One visit row per contact per link per day. A prospect who opens the page
-- four times while deciding is one person thinking, not four leads, and a
-- conversion rate computed over raw opens is wrong in the flattering
-- direction.
--
-- The day is pinned to UTC rather than cast with a bare ::date. Casting a
-- timestamptz to a date reads the session's TimeZone, which makes it not
-- IMMUTABLE and so illegal in an index - and would quietly mean a different
-- thing depending on who was connected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_link_visits_daily
  ON booking_link_visits (link_id, contact_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE contact_id IS NOT NULL;

ALTER TABLE booking_link_visits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'booking_link_visits'
       AND policyname = 'Users can read their own booking link visits'
  ) THEN
    CREATE POLICY "Users can read their own booking link visits"
      ON booking_link_visits FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;
