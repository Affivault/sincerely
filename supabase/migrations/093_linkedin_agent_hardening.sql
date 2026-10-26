-- ============================================================================
-- 093 - LinkedIn agent hardening
--
-- The agent from 040 could act on people it should have left alone, and
-- could leave people parked forever. This closes both:
--
--   * claim_linkedin_task only hands out a task whose contact is still
--     active in a running campaign. A reply, a pause or a deleted campaign
--     used to leave the task claimable, so the agent sent an invite to
--     somebody who had already answered.
--   * The claim skips channels that are at today's cap, so a full connect
--     allowance no longer holds every message and visit up behind it.
--   * A weekly invite counter beside the daily ones. LinkedIn restricts on
--     the week, not the day, so a daily cap alone could still reach 200.
--   * A setting for how long an undone LinkedIn task may sit before the
--     sequence gives up on it and moves on, and the query that finds them.
--   * A query for contacts parked on a task that was deleted or already
--     closed, which nothing could ever wake.
--   * pause_kind, so a checkpoint or restriction pause can wait for the
--     user to say they have looked, rather than lifting itself after an hour.
--
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS weekly_connect_limit integer NOT NULL DEFAULT 80;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS week_start date;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS connects_this_week integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS skip_task_after_days integer NOT NULL DEFAULT 7;
-- 'restricted' and 'logged_out' wait for a manual resume; NULL (or anything
-- else) lifts when paused_until passes, as before.
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS pause_kind text;

-- -- Counting a completed action ---------------------------------------------
-- Same signature as 048, so a plain replace. The week rolls over on the
-- user's own Monday, from the same local date the day does.
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
         week_start     = v_week,
         connects_this_week = CASE WHEN week_start IS NULL OR week_start < v_week THEN 0 ELSE connects_this_week END
                          + CASE WHEN action = 'linkedin_connect' THEN 1 ELSE 0 END
   WHERE user_id = uid;
END;
$$;

-- -- Claiming, atomically -----------------------------------------------------
-- The signature gains skip_channels, so the old one goes first; leaving it
-- would make the two-argument call ambiguous.
DROP FUNCTION IF EXISTS claim_linkedin_task(uuid, integer);

CREATE OR REPLACE FUNCTION claim_linkedin_task(
  uid uuid,
  lease_seconds integer DEFAULT 300,
  skip_channels text[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid, title text, channel text, payload text, target_url text,
  contact_id uuid, contact_name text, attempts integer
)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE crm_tasks t
     SET locked_until = now() + make_interval(secs => lease_seconds),
         attempts     = t.attempts + 1
   WHERE t.id = (
     SELECT c.id
       FROM crm_tasks c
      WHERE c.user_id = uid
        AND c.channel IS NOT NULL
        AND c.is_done = false
        AND (c.locked_until IS NULL OR c.locked_until < now())
        AND (c.due_date IS NULL OR c.due_date <= now())
        AND c.attempts < 3
        -- A channel already at today's cap would only be handed back, and
        -- would sit at the head of the queue in front of every other one.
        AND c.channel <> ALL (COALESCE(skip_channels, '{}'::text[]))
        -- A task a sequence raised is only still wanted while its contact is
        -- in flight. A reply, a pause, a removal or a deleted campaign all
        -- end that, and the invite must not go out after it.
        AND (
          c.campaign_contact_id IS NULL
          OR EXISTS (
            SELECT 1
              FROM campaign_contacts cc
              JOIN campaigns ca ON ca.id = cc.campaign_id
             WHERE cc.id = c.campaign_contact_id
               AND cc.status = 'active'
               AND ca.status = 'running'
          )
        )
      ORDER BY c.due_date NULLS FIRST
      FOR UPDATE OF c SKIP LOCKED
      LIMIT 1
   )
  RETURNING t.id, t.title, t.channel, t.payload, t.target_url,
            t.contact_id, t.contact_name, t.attempts;
$$;

-- -- Tasks the sequence should stop waiting for -------------------------------
-- Read-only: the server closes each one itself, because closing a task also
-- means logging the skip and moving the contact on, which lives in the app.
--   contact_gone - the contact left the campaign, or the campaign ended.
--                  Close it; there is nobody to move on.
--   agent_failed - three failed attempts, left over from before the agent
--                  closed these itself.
--   overdue      - undone for skip_task_after_days past its due date, and no
--                  agent has been working the queue in that time. While the
--                  extension is checking in, a long queue is the daily cap
--                  doing its job, not a task nobody will do.
CREATE OR REPLACE FUNCTION linkedin_tasks_to_skip(max_rows integer DEFAULT 200)
RETURNS TABLE (id uuid, user_id uuid, reason text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.user_id,
         CASE
           WHEN cc.id IS NULL OR cc.status NOT IN ('active', 'paused', 'pending')
                OR ca.status IN ('cancelled', 'completed') THEN 'contact_gone'
           WHEN t.attempts >= 3 THEN 'agent_failed'
           ELSE 'overdue'
         END AS reason
    FROM crm_tasks t
    LEFT JOIN campaign_contacts cc ON cc.id = t.campaign_contact_id
    LEFT JOIN campaigns ca ON ca.id = cc.campaign_id
    LEFT JOIN linkedin_settings s ON s.user_id = t.user_id
   WHERE t.campaign_contact_id IS NOT NULL
     AND t.channel IS NOT NULL
     AND t.is_done = false
     AND (t.locked_until IS NULL OR t.locked_until < now())
     AND (
       cc.id IS NULL
       OR cc.status NOT IN ('active', 'paused', 'pending')
       OR ca.status IN ('cancelled', 'completed')
       OR t.attempts >= 3
       OR (
         COALESCE(s.skip_task_after_days, 7) > 0
         AND cc.status = 'active'
         AND ca.status = 'running'
         AND t.due_date < now() - make_interval(days => COALESCE(s.skip_task_after_days, 7))
         AND NOT (
           COALESCE(s.enabled, false)
           AND s.last_seen_at IS NOT NULL
           AND s.last_seen_at > now() - make_interval(days => COALESCE(s.skip_task_after_days, 7))
         )
       )
     )
   ORDER BY t.due_date NULLS FIRST
   LIMIT GREATEST(1, LEAST(COALESCE(max_rows, 200), 1000));
$$;

-- -- Contacts parked on a task that can no longer wake them ------------------
-- Deleting a task used to leave its contact waiting on an id that no longer
-- exists, and a completion whose resume failed leaves it waiting on a task
-- that is already done. Neither ever moves again on its own, and the
-- stranded-contact reaper deliberately skips anything with
-- waiting_for_task_id set. task_exists says which of the two it is: a
-- missing task is logged as skipped, a done one is simply resumed.
CREATE OR REPLACE FUNCTION linkedin_contacts_orphaned(max_rows integer DEFAULT 200)
RETURNS TABLE (campaign_contact_id uuid, task_id uuid, task_exists boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cc.id, cc.waiting_for_task_id, (t.id IS NOT NULL)
    FROM campaign_contacts cc
    JOIN campaigns ca ON ca.id = cc.campaign_id
    LEFT JOIN crm_tasks t ON t.id = cc.waiting_for_task_id
   WHERE cc.waiting_for_task_id IS NOT NULL
     AND cc.status = 'active'
     AND ca.status = 'running'
     AND (t.id IS NULL OR t.is_done = true)
     -- A completion that is resuming right now gets a moment to finish.
     AND cc.updated_at < now() - interval '15 minutes'
   ORDER BY cc.updated_at
   LIMIT GREATEST(1, LEAST(COALESCE(max_rows, 200), 1000));
$$;

-- Server-only, like every other function since 084.
DO $$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'record_linkedin_action(uuid, text, date)',
    'claim_linkedin_task(uuid, integer, text[])',
    'linkedin_tasks_to_skip(integer)',
    'linkedin_contacts_orphaned(integer)'
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
