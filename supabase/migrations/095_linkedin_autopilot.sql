-- ============================================================================
-- 095 - LinkedIn on autopilot
--
-- The agent from 040 and 093 carried out the steps a campaign raised, and
-- nothing else. Everything a person still had to do by hand - notice an
-- invite was accepted, read a reply on LinkedIn, tidy up invites nobody
-- answered, copy a job title off a profile - is now the agent's, inside
-- the same working hours, gaps and caps as the rest of it:
--
--   * The agent switches itself on the first time the extension checks in,
--     unless the user has already chosen. enabled_explicitly records that
--     choice, so turning it off sticks.
--   * Invite tracking on the contact: pending, accepted or withdrawn, with
--     when each happened. "If connected" branches and "wait until
--     connected" message steps read it.
--   * A daily cap and counter for each new kind of action: acceptance
--     checks, inbox reads, withdrawals and profile enrichment.
--   * withdraw_after_days: invites still pending this long are withdrawn.
--     21 by default, 0 never.
--   * inbox_messages.channel, so a LinkedIn reply sits in the inbox with
--     the email ones and says where it came from.
--   * linkedin_agent_log, the record of what the agent did that is not a
--     campaign step, for the activity log on the LinkedIn page.
--   * claim_linkedin_upkeep hands out the next profile to check or invite
--     to withdraw, atomically, like claim_linkedin_task does for steps.
--   * linkedin_fill_contact_blanks writes what a profile visit read, into
--     empty fields only. A title somebody typed is never overwritten.
--   * linkedin_reply_watchlist names who to look for in the LinkedIn
--     inbox: people a campaign has invited or messaged and who are still
--     in it.
--
-- Safe to run more than once.
-- ============================================================================

-- -- Settings ----------------------------------------------------------------
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS enabled_explicitly boolean NOT NULL DEFAULT false;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS daily_check_limit integer NOT NULL DEFAULT 40;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS daily_withdraw_limit integer NOT NULL DEFAULT 10;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS daily_inbox_limit integer NOT NULL DEFAULT 8;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS daily_enrich_limit integer NOT NULL DEFAULT 60;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS withdraw_after_days integer NOT NULL DEFAULT 21;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS checks_today integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS withdrawals_today integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS inbox_reads_today integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS enrichments_today integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS last_inbox_read_at timestamptz;

-- Somebody whose extension has already been checking in while the agent
-- was off has seen it off and left it that way; switching it on behind
-- them would start sending invites they did not ask for. Everybody else
-- has never had the extension running, and gets the agent switched on
-- the first time it does.
UPDATE linkedin_settings
   SET enabled_explicitly = true
 WHERE enabled_explicitly = false
   AND (enabled = true OR last_seen_at IS NOT NULL);

-- -- Invite tracking, on the contact ------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_invite_status text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_invited_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_connected_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_withdrawn_at timestamptz;
-- When the agent last looked at the profile for this. Set when the look is
-- handed out, so it also stops two browsers looking at once.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_checked_at timestamptz;
-- The line under their name on LinkedIn. job_title and company already
-- exist; this is the one thing a profile says that had nowhere to go.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_headline text;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_linkedin_invite_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_linkedin_invite_status_check
  CHECK (linkedin_invite_status IS NULL OR linkedin_invite_status IN ('pending', 'accepted', 'withdrawn'));

-- The upkeep claim reads only pending invites, per account, oldest look first.
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_pending
  ON contacts (user_id, linkedin_checked_at)
  WHERE linkedin_invite_status = 'pending';

-- -- "Wait until connected" on a message step ---------------------------------
-- NULL or 0 sends straight away, as before. Otherwise the step waits up to
-- this many days for the invite to be accepted, then is skipped.
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS linkedin_wait_days integer;
ALTER TABLE campaign_steps DROP CONSTRAINT IF EXISTS campaign_steps_linkedin_wait_days_check;
ALTER TABLE campaign_steps
  ADD CONSTRAINT campaign_steps_linkedin_wait_days_check
  CHECK (linkedin_wait_days IS NULL OR (linkedin_wait_days >= 0 AND linkedin_wait_days <= 90));

-- When this enrolment started waiting. Cleared when it stops.
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS linkedin_wait_since timestamptz;
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_linkedin_wait
  ON campaign_contacts (contact_id)
  WHERE linkedin_wait_since IS NOT NULL;

-- -- LinkedIn replies in the inbox --------------------------------------------
-- NULL is email, as every row before this was.
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS inbox_messages_channel_check;
ALTER TABLE inbox_messages
  ADD CONSTRAINT inbox_messages_channel_check
  CHECK (channel IS NULL OR channel IN ('email', 'linkedin'));
CREATE INDEX IF NOT EXISTS idx_inbox_messages_linkedin
  ON inbox_messages (user_id, received_at DESC)
  WHERE channel = 'linkedin';

-- -- What the agent did that was not a campaign step ---------------------------
CREATE TABLE IF NOT EXISTS linkedin_agent_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- check, withdraw, inbox, enrich, attention
  kind         text NOT NULL,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contact_name text,
  -- done, skipped, failed
  outcome      text NOT NULL,
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linkedin_agent_log_user
  ON linkedin_agent_log (user_id, created_at DESC);
-- Server-only. No policies: the browser never reads it directly.
ALTER TABLE linkedin_agent_log ENABLE ROW LEVEL SECURITY;

-- -- Counting an action ---------------------------------------------------------
-- Same signature as 093, so a plain replace. Every counter rolls over with
-- the user's local day, the new ones included.
CREATE OR REPLACE FUNCTION record_linkedin_action(uid uuid, action text, local_date date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_week date := date_trunc('week', local_date)::date;
BEGIN
  INSERT INTO linkedin_settings (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE linkedin_settings
     SET counters_date  = local_date,
         connects_today = CASE WHEN counters_date < local_date THEN 0 ELSE connects_today END
                          + CASE WHEN action = 'linkedin_connect' THEN 1 ELSE 0 END,
         messages_today = CASE WHEN counters_date < local_date THEN 0 ELSE messages_today END
                          + CASE WHEN action = 'linkedin_message' THEN 1 ELSE 0 END,
         visits_today   = CASE WHEN counters_date < local_date THEN 0 ELSE visits_today END
                          + CASE WHEN action = 'linkedin_visit' THEN 1 ELSE 0 END,
         checks_today   = CASE WHEN counters_date < local_date THEN 0 ELSE checks_today END
                          + CASE WHEN action = 'linkedin_check' THEN 1 ELSE 0 END,
         withdrawals_today = CASE WHEN counters_date < local_date THEN 0 ELSE withdrawals_today END
                          + CASE WHEN action = 'linkedin_withdraw' THEN 1 ELSE 0 END,
         inbox_reads_today = CASE WHEN counters_date < local_date THEN 0 ELSE inbox_reads_today END
                          + CASE WHEN action = 'linkedin_inbox' THEN 1 ELSE 0 END,
         enrichments_today = CASE WHEN counters_date < local_date THEN 0 ELSE enrichments_today END
                          + CASE WHEN action = 'linkedin_enrich' THEN 1 ELSE 0 END,
         week_start     = v_week,
         connects_this_week = CASE WHEN week_start IS NULL OR week_start < v_week THEN 0 ELSE connects_this_week END
                          + CASE WHEN action = 'linkedin_connect' THEN 1 ELSE 0 END
   WHERE user_id = uid;
END;
$$;

-- -- The next profile to look at --------------------------------------------------
-- One profile per call, claimed by stamping linkedin_checked_at, so two
-- browsers on the same account never visit the same person twice.
--   withdraw - an invite pending longer than withdraw_after_days. Not
--              retried for six hours if a withdrawal did not go through.
--   check    - a pending invite at least half a day old and not looked at
--              for recheck_hours, or anybody a "wait until connected"
--              step is waiting on.
-- A withdrawal is preferred: the visit it costs answers the acceptance
-- question as well, since an accepted invite is not withdrawn.
CREATE OR REPLACE FUNCTION claim_linkedin_upkeep(
  uid uuid,
  recheck_hours integer DEFAULT 24,
  withdraw_after_days integer DEFAULT 21,
  allow_check boolean DEFAULT true,
  allow_withdraw boolean DEFAULT true
)
RETURNS TABLE (contact_id uuid, contact_name text, linkedin_url text, action text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_action text;
BEGIN
  IF allow_withdraw AND COALESCE(withdraw_after_days, 0) > 0 THEN
    SELECT c.id INTO v_id
      FROM contacts c
     WHERE c.user_id = uid
       AND c.linkedin_invite_status = 'pending'
       AND c.linkedin_url IS NOT NULL
       AND COALESCE(c.linkedin_invited_at, 'epoch'::timestamptz) < now() - make_interval(days => withdraw_after_days)
       AND (c.linkedin_checked_at IS NULL OR c.linkedin_checked_at < now() - interval '6 hours')
     ORDER BY c.linkedin_invited_at NULLS FIRST
     FOR UPDATE OF c SKIP LOCKED
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      v_action := 'withdraw';
    END IF;
  END IF;

  IF v_id IS NULL AND allow_check THEN
    SELECT c.id INTO v_id
      FROM contacts c
     WHERE c.user_id = uid
       AND c.linkedin_url IS NOT NULL
       AND (c.linkedin_checked_at IS NULL
            OR c.linkedin_checked_at < now() - make_interval(hours => GREATEST(1, COALESCE(recheck_hours, 24))))
       AND (
         (c.linkedin_invite_status = 'pending'
          AND COALESCE(c.linkedin_invited_at, 'epoch'::timestamptz) < now() - interval '12 hours')
         OR (
           COALESCE(c.linkedin_invite_status, '') <> 'accepted'
           AND EXISTS (
             SELECT 1
               FROM campaign_contacts cc
               JOIN campaigns ca ON ca.id = cc.campaign_id
              WHERE cc.contact_id = c.id
                AND cc.linkedin_wait_since IS NOT NULL
                AND cc.status = 'active'
                AND ca.status = 'running'
           )
         )
       )
     ORDER BY c.linkedin_checked_at NULLS FIRST
     FOR UPDATE OF c SKIP LOCKED
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      v_action := 'check';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE contacts c SET linkedin_checked_at = now() WHERE c.id = v_id;

  RETURN QUERY
  SELECT c.id,
         NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
         c.linkedin_url,
         v_action
    FROM contacts c
   WHERE c.id = v_id;
END;
$$;

-- -- Filling blanks from a profile ---------------------------------------------
-- Only fields that are empty now are written; anything a person or an
-- import put there stays. Returns how many fields were filled, so the
-- enrichment cap counts work done rather than visits made.
CREATE OR REPLACE FUNCTION linkedin_fill_contact_blanks(
  uid uuid,
  cid uuid,
  p_headline text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row contacts%ROWTYPE;
  v_headline text := left(NULLIF(btrim(p_headline), ''), 300);
  v_title text := left(NULLIF(btrim(p_title), ''), 200);
  v_company text := left(NULLIF(btrim(p_company), ''), 200);
  v_location text := left(NULLIF(btrim(p_location), ''), 200);
  v_filled integer := 0;
BEGIN
  SELECT * INTO v_row FROM contacts WHERE id = cid AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF NULLIF(btrim(v_row.linkedin_headline), '') IS NOT NULL THEN v_headline := NULL; END IF;
  IF NULLIF(btrim(v_row.job_title), '') IS NOT NULL THEN v_title := NULL; END IF;
  IF NULLIF(btrim(v_row.company), '') IS NOT NULL THEN v_company := NULL; END IF;
  IF NULLIF(btrim(v_row.location), '') IS NOT NULL THEN v_location := NULL; END IF;

  v_filled := (v_headline IS NOT NULL)::int + (v_title IS NOT NULL)::int
            + (v_company IS NOT NULL)::int + (v_location IS NOT NULL)::int;
  IF v_filled = 0 THEN
    RETURN 0;
  END IF;

  UPDATE contacts
     SET linkedin_headline = COALESCE(v_headline, linkedin_headline),
         job_title         = COALESCE(v_title, job_title),
         company           = COALESCE(v_company, company),
         location          = COALESCE(v_location, location)
   WHERE id = cid AND user_id = uid;
  RETURN v_filled;
END;
$$;

-- -- Who to look for in the LinkedIn inbox ---------------------------------------
-- People a campaign invited or messaged on LinkedIn in the last 60 days who
-- are still in that campaign. A reply from anybody else is not the
-- campaign's to act on, and reading the whole inbox would be both slower
-- and more than the user agreed to.
CREATE OR REPLACE FUNCTION linkedin_reply_watchlist(uid uuid, max_rows integer DEFAULT 100)
RETURNS TABLE (contact_id uuid, campaign_contact_id uuid, contact_name text, linkedin_url text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT w.contact_id, w.campaign_contact_id, w.contact_name, w.linkedin_url
    FROM (
      SELECT DISTINCT ON (c.id)
             c.id AS contact_id,
             cc.id AS campaign_contact_id,
             NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
             c.linkedin_url,
             t.completed_at
        FROM crm_tasks t
        JOIN campaign_contacts cc ON cc.id = t.campaign_contact_id
        JOIN campaigns ca ON ca.id = cc.campaign_id
        JOIN contacts c ON c.id = cc.contact_id
       WHERE t.user_id = uid
         AND t.channel IN ('linkedin_connect', 'linkedin_message')
         AND t.is_done = true
         AND t.last_error IS NULL
         AND t.completed_at > now() - interval '60 days'
         AND cc.status IN ('pending', 'active', 'paused')
         AND ca.status IN ('running', 'paused')
         AND c.user_id = uid
         AND c.linkedin_url IS NOT NULL
       ORDER BY c.id, t.completed_at DESC
    ) w
   ORDER BY w.completed_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(max_rows, 100), 500));
$$;

-- Server-only, like every other function since 084.
DO $$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'record_linkedin_action(uuid, text, date)',
    'claim_linkedin_upkeep(uuid, integer, integer, boolean, boolean)',
    'linkedin_fill_contact_blanks(uuid, uuid, text, text, text, text)',
    'linkedin_reply_watchlist(uuid, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;
END $$;
