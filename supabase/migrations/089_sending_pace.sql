-- 089: Sending pace per mailbox, follow-up reply mode, unsubscribe on by default.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- 1. Spacing between sends, per mailbox.
--    A mailbox sent as fast as the worker could hand it contacts: a burst
--    of forty emails in a minute, which is the pattern providers filter.
--    Each mailbox now waits a random gap between campaign sends, chosen
--    between send_gap_min_seconds and send_gap_max_seconds. The default,
--    2 to 5 minutes, is the recommended pace; it can be changed per mailbox.
--    next_send_allowed_at is when it may send again.
--
-- 2. The daily limit for NEW mailboxes defaults to the recommended 40.
--    Existing mailboxes keep whatever limit they have.
--
-- 3. reserve_warmup_send, the one lock every campaign send already takes on
--    its mailbox, now also enforces the gap. Two sends racing for the same
--    mailbox cannot both get through inside it. refund_warmup_send gives
--    the gap back when the send did not happen.
--
-- 4. campaign_steps.thread_mode: how a follow-up goes out.
--      'reply'  as a reply in the same thread ("Re: <previous subject>")
--      'new'    as a new email with its own subject
--      NULL     as before: a reply when the subject is blank or repeats
--               the previous one, otherwise a new email
--
-- 5. New campaigns include an unsubscribe link unless it is switched off.
--    Existing campaigns are unchanged.

ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS send_gap_min_seconds integer NOT NULL DEFAULT 120;
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS send_gap_max_seconds integer NOT NULL DEFAULT 300;
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS next_send_allowed_at timestamptz;
ALTER TABLE smtp_accounts ALTER COLUMN daily_send_limit SET DEFAULT 40;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtp_accounts_send_gap_check') THEN
    ALTER TABLE smtp_accounts
      ADD CONSTRAINT smtp_accounts_send_gap_check
      CHECK (send_gap_min_seconds >= 0
             AND send_gap_max_seconds >= send_gap_min_seconds
             AND send_gap_max_seconds <= 3600);
  END IF;
END $$;

ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS thread_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_steps_thread_mode_check') THEN
    ALTER TABLE campaign_steps
      ADD CONSTRAINT campaign_steps_thread_mode_check
      CHECK (thread_mode IS NULL OR thread_mode IN ('reply', 'new'));
  END IF;
END $$;

ALTER TABLE campaigns ALTER COLUMN include_unsubscribe SET DEFAULT true;

-- The daily cap and the gap, taken under one row lock.
-- p_limit <= 0 means no daily cap, as before.
CREATE OR REPLACE FUNCTION reserve_warmup_send(p_account_id uuid, p_limit integer)
RETURNS boolean AS $$
DECLARE
  v_current integer;
  v_min     integer;
  v_max     integer;
  v_next    timestamptz;
  v_gap     integer;
BEGIN
  SELECT sends_today,
         GREATEST(COALESCE(send_gap_min_seconds, 0), 0),
         GREATEST(COALESCE(send_gap_max_seconds, 0), 0),
         next_send_allowed_at
    INTO v_current, v_min, v_max, v_next
  FROM smtp_accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN false;
  END IF;

  IF p_limit > 0 AND v_current + 1 > p_limit THEN
    RETURN false;
  END IF;

  IF v_next IS NOT NULL AND v_next > now() THEN
    RETURN false;
  END IF;

  IF v_max < v_min THEN
    v_max := v_min;
  END IF;
  v_gap := v_min + floor(random() * (v_max - v_min + 1))::integer;

  UPDATE smtp_accounts
  SET sends_today = sends_today + 1,
      next_send_allowed_at = CASE WHEN v_gap > 0
                                  THEN now() + make_interval(secs => v_gap)
                                  ELSE NULL END
  WHERE id = p_account_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- A reserved send that did not happen gives back its slot and its gap.
CREATE OR REPLACE FUNCTION refund_warmup_send(p_account_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE smtp_accounts
  SET sends_today = GREATEST(sends_today - 1, 0),
      next_send_allowed_at = NULL
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- Server-only, as every function since 084. CREATE OR REPLACE keeps the
-- existing grants; this restates them for a database that skipped 084.
DO $$
DECLARE
  v_sig  text;
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'reserve_warmup_send(uuid, integer)',
    'refund_warmup_send(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_sig, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END IF;
  END LOOP;
END $$;
