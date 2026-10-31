-- 104: Where each lead is in outreach, worked out by the database.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- No dependency on other pending migrations.
--
-- The Leads page filters by Not contacted / Queued / In sequence /
-- Sequence ended / Replied. This function is the single definition of those
-- states. PostgREST exposes it as a column on contacts, so the filter runs
-- here, over every lead, rather than on one page of rows in the app.
-- Read only: it adds no column and changes no data.
--
--   replied      - answered a campaign (any enrolment with status replied)
--   in_sequence  - waiting for or receiving a step in a campaign that is
--                  scheduled, running or paused
--   queued       - only enrolled in campaigns that have not launched (draft)
--   finished     - was in campaigns, all of them over, no reply
--   none         - never put in a campaign

CREATE OR REPLACE FUNCTION public.outreach_state(c public.contacts)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM campaign_contacts cc WHERE cc.contact_id = c.id
    ) THEN 'none'
    WHEN EXISTS (
      SELECT 1 FROM campaign_contacts cc
      WHERE cc.contact_id = c.id AND cc.status = 'replied'
    ) THEN 'replied'
    WHEN EXISTS (
      SELECT 1 FROM campaign_contacts cc
      JOIN campaigns k ON k.id = cc.campaign_id
      WHERE cc.contact_id = c.id
        AND cc.status IN ('pending', 'active', 'paused')
        AND k.status IN ('scheduled', 'running', 'paused')
    ) THEN 'in_sequence'
    WHEN EXISTS (
      SELECT 1 FROM campaign_contacts cc
      JOIN campaigns k ON k.id = cc.campaign_id
      WHERE cc.contact_id = c.id
        AND cc.status IN ('pending', 'active', 'paused')
        AND k.status = 'draft'
    ) THEN 'queued'
    ELSE 'finished'
  END
$$;

-- The lookups above go by contact; make sure that is indexed.
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact_id ON campaign_contacts (contact_id);

-- So the API sees the new function straight away.
NOTIFY pgrst, 'reload schema';
