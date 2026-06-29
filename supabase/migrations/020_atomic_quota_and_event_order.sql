-- 020: Atomic email-quota reservation + webhook event-ordering guard
-- Run this in the Supabase SQL Editor. Idempotent.

-- Webhook ordering: remember the timestamp of the last Stripe event applied,
-- so an out-of-order / replayed event can't overwrite newer subscription state.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

-- Atomic check-and-increment of the monthly email counter. Returns true and
-- counts the send if it's within the plan limit (or the plan is unlimited),
-- false if it would exceed the cap. Row lock (FOR UPDATE) makes it safe under
-- concurrent sends. Replaces the old non-atomic check-then-increment.
CREATE OR REPLACE FUNCTION reserve_email_quota(p_user_id uuid, p_limit integer, p_count integer DEFAULT 1)
RETURNS boolean AS $$
DECLARE
  v_period date := date_trunc('month', now())::date;
  v_current integer;
BEGIN
  INSERT INTO usage_counters (user_id, period_start, emails_sent, updated_at)
  VALUES (p_user_id, v_period, 0, now())
  ON CONFLICT (user_id, period_start) DO NOTHING;

  SELECT emails_sent INTO v_current
  FROM usage_counters
  WHERE user_id = p_user_id AND period_start = v_period
  FOR UPDATE;

  -- p_limit < 0 means unlimited.
  IF p_limit >= 0 AND v_current + p_count > p_limit THEN
    RETURN false;
  END IF;

  UPDATE usage_counters
  SET emails_sent = emails_sent + p_count, updated_at = now()
  WHERE user_id = p_user_id AND period_start = v_period;

  RETURN true;
END;
$$ LANGUAGE plpgsql;
