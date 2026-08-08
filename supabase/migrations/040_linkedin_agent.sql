-- ============================================================================
-- 040 — LinkedIn agent
--
-- Turns the LinkedIn steps from 039 from "a task you do by hand" into "a task
-- the browser extension does for you", which is how lemlist, Apollo and
-- Snov.io all work: the action runs in YOUR logged-in browser, from your own
-- IP and session. Nothing about your LinkedIn login is ever sent to or stored
-- on a server — the extension only ever asks "what's next?" and reports back.
--
-- Everything here exists to keep that within limits LinkedIn tolerates. The
-- defaults are deliberately conservative: LinkedIn starts restricting accounts
-- somewhere around 100 invites a week, so 15 a day with an hour of jitter and
-- a working-hours window sits well under it.
--
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS linkedin_settings (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  /** Master switch. Off means the extension asks for nothing. */
  enabled       boolean NOT NULL DEFAULT false,

  /* Daily ceilings, per action type. */
  daily_connect_limit integer NOT NULL DEFAULT 15,
  daily_message_limit integer NOT NULL DEFAULT 40,
  daily_visit_limit   integer NOT NULL DEFAULT 60,

  /* Spacing between actions, in seconds. The agent picks a random gap in this
     range each time — a fixed interval is the most recognisable pattern there
     is, and the whole point is not to look like a machine. */
  min_gap_seconds integer NOT NULL DEFAULT 45,
  max_gap_seconds integer NOT NULL DEFAULT 180,

  /* Only act during the hours a person would. Stored as local wall-clock time
     in the user's timezone, same convention as campaign send windows. */
  work_start    text NOT NULL DEFAULT '09:00',
  work_end      text NOT NULL DEFAULT '17:00',
  /** ISO weekday numbers, 1 = Monday. Weekends off by default. */
  work_days     integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  timezone      text NOT NULL DEFAULT 'UTC',

  /* Today's tally. Rolled over by date rather than by a scheduled job, so a
     server that was asleep at midnight still counts correctly. */
  counters_date date NOT NULL DEFAULT CURRENT_DATE,
  connects_today integer NOT NULL DEFAULT 0,
  messages_today integer NOT NULL DEFAULT 0,
  visits_today   integer NOT NULL DEFAULT 0,

  /** Set when LinkedIn shows a checkpoint or the user hits pause. */
  paused_until  timestamptz,
  pause_reason  text,
  /** Last time the extension checked in — drives the "connected" indicator. */
  last_seen_at  timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE linkedin_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'linkedin_settings' AND policyname = 'Users manage their own linkedin settings'
  ) THEN
    CREATE POLICY "Users manage their own linkedin settings"
      ON linkedin_settings FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_linkedin_settings_updated_at ON linkedin_settings;
CREATE TRIGGER trg_linkedin_settings_updated_at BEFORE UPDATE ON linkedin_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Leasing a task ──────────────────────────────────────────────────────────
-- The extension asks for work, does it, and reports back. Between those two
-- moments the task must not be handed to a second browser — two tabs open on
-- the same account would otherwise both send the same invite.
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_agent_queue
  ON crm_tasks(user_id, channel, due_date)
  WHERE channel IS NOT NULL AND is_done = false;

-- ── Claiming, atomically ────────────────────────────────────────────────────
-- One statement so two pollers can't both take the same row: the UPDATE's
-- WHERE clause is the lock. Returns nothing when the lease is already held.
CREATE OR REPLACE FUNCTION claim_linkedin_task(uid uuid, lease_seconds integer DEFAULT 300)
RETURNS TABLE (
  id uuid, title text, channel text, payload text, target_url text,
  contact_id uuid, contact_name text, attempts integer
)
LANGUAGE sql
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
        -- Three failures is enough: something about this one is wrong, and
        -- retrying forever burns the daily allowance on a lost cause.
        AND c.attempts < 3
      ORDER BY c.due_date NULLS FIRST
      -- SKIP LOCKED so a concurrent claim picks the next row rather than
      -- blocking on this one.
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING t.id, t.title, t.channel, t.payload, t.target_url,
            t.contact_id, t.contact_name, t.attempts;
$$;

-- ── Counting a completed action ─────────────────────────────────────────────
-- Rolls the day over and increments in one statement, so the check and the
-- increment can't straddle midnight or race another tab.
CREATE OR REPLACE FUNCTION record_linkedin_action(uid uuid, action text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO linkedin_settings (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE linkedin_settings
     SET counters_date  = CURRENT_DATE,
         connects_today = CASE WHEN counters_date < CURRENT_DATE THEN 0 ELSE connects_today END
                          + CASE WHEN action = 'linkedin_connect' THEN 1 ELSE 0 END,
         messages_today = CASE WHEN counters_date < CURRENT_DATE THEN 0 ELSE messages_today END
                          + CASE WHEN action = 'linkedin_message' THEN 1 ELSE 0 END,
         visits_today   = CASE WHEN counters_date < CURRENT_DATE THEN 0 ELSE visits_today END
                          + CASE WHEN action = 'linkedin_visit' THEN 1 ELSE 0 END
   WHERE user_id = uid;
END;
$$;
