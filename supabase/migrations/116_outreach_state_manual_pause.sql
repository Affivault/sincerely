-- 116: A person stopped by hand is no longer "In sequence".
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- Depends on 104 (it replaces the function 104 created).
--
-- The inbox can now stop one person in one campaign ("Stop for them"), and
-- the command bar could already ("stop emailing bob@..."). Both leave the
-- enrolment as status 'paused' with an error_message starting
-- 'Paused by hand'. 104 counted every paused enrolment as a live sequence,
-- so the Leads page kept showing these people as In sequence. A by-hand
-- stop is a decision, not a wait: it now reads as Sequence ended, the same
-- as shared/lifecycle.types.ts summariseOutreach. A pause because a
-- colleague replied ('Paused: ...') still counts as In sequence.
-- Read only: it changes no data.

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
        AND NOT (cc.status = 'paused' AND coalesce(cc.error_message, '') LIKE 'Paused by hand%')
        AND k.status IN ('scheduled', 'running', 'paused')
    ) THEN 'in_sequence'
    WHEN EXISTS (
      SELECT 1 FROM campaign_contacts cc
      JOIN campaigns k ON k.id = cc.campaign_id
      WHERE cc.contact_id = c.id
        AND cc.status IN ('pending', 'active', 'paused')
        AND NOT (cc.status = 'paused' AND coalesce(cc.error_message, '') LIKE 'Paused by hand%')
        AND k.status = 'draft'
    ) THEN 'queued'
    ELSE 'finished'
  END
$$;

-- So the API sees the new definition straight away.
NOTIFY pgrst, 'reload schema';
