-- 092: Snooze a conversation, get nudged when nobody answers, and hand a
-- conversation to a teammate.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- Snooze and assignment reuse columns migration 071 added for the reply
-- queue (snoozed_until, snooze_note, assigned_to, assigned_at,
-- assigned_by). They are declared again below with IF NOT EXISTS so this
-- file stands on its own; on a database that already ran 071 those lines
-- do nothing. What is new:
--
--   nudge_at          On a message we sent: when to look for an answer.
--                     "Remind me if no reply in 3 days" sets it to now + 3d.
--   nudge_fired_at    Set when that look found nothing. It is the "No reply
--                     yet" marker, and it is cleared the moment they answer.
--   resurfaced_at     When a snooze ended or a nudge fired. The inbox sorts
--                     these first until the conversation is opened, so it
--                     comes back at the top rather than at the date it was
--                     originally received, three pages down.
--   resurfaced_reason 'snooze' or 'nudge', so the row can say which.
--
-- Columns on inbox_messages rather than a table of their own: every one of
-- these is read by the inbox list on every page load, and a join on each of
-- those reads costs more than four nullable columns, which Postgres adds
-- without rewriting the table.
--
-- Two functions do the sweeps the scheduler runs each minute. Each is one
-- statement, so a conversation is either woken or not, and two servers
-- running the same tick cannot both fire one nudge (SKIP LOCKED). Both are
-- for the server only: EXECUTE is revoked from everyone else.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS snooze_note text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nudge_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_fired_at timestamptz,
  ADD COLUMN IF NOT EXISTS resurfaced_at timestamptz,
  ADD COLUMN IF NOT EXISTS resurfaced_reason text;

-- Added on its own, by name, so a second run finds it and skips it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbox_messages_resurfaced_reason_check'
      AND conrelid = 'inbox_messages'::regclass
  ) THEN
    ALTER TABLE inbox_messages
      ADD CONSTRAINT inbox_messages_resurfaced_reason_check
      CHECK (resurfaced_reason IS NULL OR resurfaced_reason IN ('snooze', 'nudge'));
  END IF;
END $$;

COMMENT ON COLUMN inbox_messages.nudge_at IS
  'On a sent message: when to check whether they answered.';
COMMENT ON COLUMN inbox_messages.nudge_fired_at IS
  'The check found no answer. Shown as "No reply yet"; cleared when they reply.';
COMMENT ON COLUMN inbox_messages.resurfaced_at IS
  'A snooze ended or a nudge fired. Sorted first in the inbox until opened.';

-- Nudges that are waiting to be checked: a small slice, oldest first.
CREATE INDEX IF NOT EXISTS idx_inbox_nudge_due
  ON inbox_messages (nudge_at)
  WHERE nudge_at IS NOT NULL AND nudge_fired_at IS NULL;

-- Snoozes to wake. 071's idx_inbox_snoozed only covers unanswered inbound
-- replies; a snoozed conversation can end in a message we sent.
CREATE INDEX IF NOT EXISTS idx_inbox_snooze_wake
  ON inbox_messages (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- The rows the inbox sorts to the top.
CREATE INDEX IF NOT EXISTS idx_inbox_resurfaced
  ON inbox_messages (user_id, resurfaced_at DESC)
  WHERE resurfaced_at IS NOT NULL;

-- "Assigned to me", whether or not it has been answered. 071's index stops
-- at the first response, which is the queue's question, not the inbox's.
CREATE INDEX IF NOT EXISTS idx_inbox_assigned_any
  ON inbox_messages (assigned_to, received_at DESC)
  WHERE assigned_to IS NOT NULL;

-- ------------------------------------------------------------------------
-- Wake snoozed conversations whose time has come.
--
-- Every due row loses its snooze and is stamped resurfaced. Only the newest
-- row per conversation (same mailbox owner, same other party) is marked
-- unread: a conversation of five messages coming back is one thing to read,
-- not five, and the unread badge should say one.
-- ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inbox_wake_snoozed(p_limit integer DEFAULT 500)
RETURNS TABLE (user_id uuid, message_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT m.id, m.user_id, m.received_at,
           lower(coalesce(CASE WHEN m.direction = 'outbound' THEN m.to_email ELSE m.from_email END, '')) AS who
    FROM inbox_messages m
    WHERE m.snoozed_until IS NOT NULL
      AND m.snoozed_until <= now()
    ORDER BY m.snoozed_until
    LIMIT greatest(coalesce(p_limit, 500), 1)
    FOR UPDATE SKIP LOCKED
  ),
  newest AS (
    SELECT DISTINCT ON (d.user_id, d.who) d.id
    FROM due d
    ORDER BY d.user_id, d.who, d.received_at DESC
  )
  UPDATE inbox_messages AS t
  SET snoozed_until = NULL,
      snooze_note = NULL,
      resurfaced_at = now(),
      resurfaced_reason = 'snooze',
      is_read = CASE WHEN t.id IN (SELECT n.id FROM newest n) THEN false ELSE t.is_read END
  FROM due d
  WHERE t.id = d.id
  RETURNING t.user_id, t.id;
END;
$$;

-- ------------------------------------------------------------------------
-- Check every nudge that has come due.
--
-- An answer is any inbound message in the same mailbox, received after
-- ours, that is from the person we wrote to, or in the same thread, or a
-- direct reply to our message (a colleague answering on their behalf
-- counts). An out-of-office does not: a robot saying they are away is
-- exactly the case where somebody needs reminding.
--
-- Answered: the nudge is cleared and nothing else changes.
-- Not answered: the row is marked "No reply yet", unread, taken out of the
-- archive if it was there, and resurfaced to the top of the inbox.
-- ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inbox_fire_nudges(p_limit integer DEFAULT 500)
RETURNS TABLE (user_id uuid, message_id uuid, outcome text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT m.id, m.user_id, m.to_email, m.thread_id, m.message_id, m.received_at
    FROM inbox_messages m
    WHERE m.nudge_at IS NOT NULL
      AND m.nudge_fired_at IS NULL
      AND m.nudge_at <= now()
    ORDER BY m.nudge_at
    LIMIT greatest(coalesce(p_limit, 500), 1)
    FOR UPDATE SKIP LOCKED
  ),
  judged AS (
    SELECT d.id,
      EXISTS (
        SELECT 1 FROM inbox_messages r
        WHERE r.user_id = d.user_id
          AND (r.direction IS NULL OR r.direction = 'inbound')
          AND r.auto_reply_kind IS NULL
          AND r.received_at > d.received_at
          AND (
            lower(r.from_email) = lower(d.to_email)
            OR (d.thread_id IS NOT NULL AND r.thread_id = d.thread_id)
            OR (d.message_id IS NOT NULL AND r.in_reply_to = d.message_id)
          )
      ) AS replied
    FROM due d
  )
  UPDATE inbox_messages AS t
  SET nudge_at          = CASE WHEN j.replied THEN NULL ELSE t.nudge_at END,
      nudge_fired_at    = CASE WHEN j.replied THEN NULL ELSE now() END,
      resurfaced_at     = CASE WHEN j.replied THEN t.resurfaced_at ELSE now() END,
      resurfaced_reason = CASE WHEN j.replied THEN t.resurfaced_reason ELSE 'nudge' END,
      is_read           = CASE WHEN j.replied THEN t.is_read ELSE false END,
      is_archived       = CASE WHEN j.replied THEN t.is_archived ELSE false END
  FROM judged j
  WHERE t.id = j.id
  RETURNING t.user_id, t.id, CASE WHEN j.replied THEN 'replied' ELSE 'fired' END;
END;
$$;

-- For the server alone, like every function since 084. A signed-in user
-- calling either over the REST API would wake or fire other accounts' rows.
DO $$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['inbox_wake_snoozed(integer)', 'inbox_fire_nudges(integer)'] LOOP
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
