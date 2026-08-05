-- 036: Atomic per-campaign daily send limit + SMTP warm-up ramp reservation
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- Both the campaign daily_limit and the warm-up ramp allowance were enforced
-- with a non-atomic "count/read, then send, then increment" pattern: two
-- overlapping processDueSteps() calls (the 30s worker tick racing a
-- launch()-triggered run) could both read the count/sends_today before
-- either finished sending, both pass the check, and both send — silently
-- exceeding the cap that's supposed to protect deliverability/reputation.
-- These RPCs replace check-then-act with the same reserve-then-refund-on-
-- failure pattern already used for the monthly email quota (see 020).

-- Per-campaign, per-business-day send counter. Keyed by the campaign's own
-- send-window start instant (already computed in app code via
-- startOfDayInTimezone) rather than a plain date, so it lines up exactly
-- with the timezone-aware window the app already reasons about.
CREATE TABLE IF NOT EXISTS campaign_daily_send_counters (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, period_start)
);

CREATE OR REPLACE FUNCTION reserve_campaign_daily_send(p_campaign_id uuid, p_period_start timestamptz, p_limit integer)
RETURNS boolean AS $$
DECLARE
  v_current integer;
BEGIN
  INSERT INTO campaign_daily_send_counters (campaign_id, period_start, sent_count, updated_at)
  VALUES (p_campaign_id, p_period_start, 0, now())
  ON CONFLICT (campaign_id, period_start) DO NOTHING;

  SELECT sent_count INTO v_current
  FROM campaign_daily_send_counters
  WHERE campaign_id = p_campaign_id AND period_start = p_period_start
  FOR UPDATE;

  -- p_limit <= 0 means unlimited (mirrors the app's daily_limit convention).
  IF p_limit > 0 AND v_current + 1 > p_limit THEN
    RETURN false;
  END IF;

  UPDATE campaign_daily_send_counters
  SET sent_count = sent_count + 1, updated_at = now()
  WHERE campaign_id = p_campaign_id AND period_start = p_period_start;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Give back a reserved-but-unused slot (the send never happened, or the
-- contact was claimed by a concurrent run instead).
CREATE OR REPLACE FUNCTION refund_campaign_daily_send(p_campaign_id uuid, p_period_start timestamptz)
RETURNS void AS $$
BEGIN
  UPDATE campaign_daily_send_counters
  SET sent_count = GREATEST(sent_count - 1, 0), updated_at = now()
  WHERE campaign_id = p_campaign_id AND period_start = p_period_start;
END;
$$ LANGUAGE plpgsql;

-- Atomic check-and-increment of an SMTP account's warm-up ramp counter.
-- Returns true and reserves the slot (increments sends_today) if within the
-- ramp allowance (or unlimited), false if it would exceed it.
CREATE OR REPLACE FUNCTION reserve_warmup_send(p_account_id uuid, p_limit integer)
RETURNS boolean AS $$
DECLARE
  v_current integer;
BEGIN
  SELECT sends_today INTO v_current
  FROM smtp_accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN false;
  END IF;

  -- p_limit <= 0 means unlimited (mirrors warmupAllowance()'s 0 = unlimited).
  IF p_limit > 0 AND v_current + 1 > p_limit THEN
    RETURN false;
  END IF;

  UPDATE smtp_accounts
  SET sends_today = sends_today + 1
  WHERE id = p_account_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Give back a reserved-but-unused warm-up slot (the send failed after the
-- slot was reserved), so failed sends don't burn ramp capacity.
CREATE OR REPLACE FUNCTION refund_warmup_send(p_account_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE smtp_accounts
  SET sends_today = GREATEST(sends_today - 1, 0)
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- Generic atomic single-column increment, used by sse.service.ts's
-- recordSend/recordBounce/recordOpen. It was referenced there already but
-- never actually defined, so every call silently fell through to a
-- non-atomic read-modify-write fallback — defining it closes that gap.
CREATE OR REPLACE FUNCTION increment_field(table_name text, field_name text, row_id uuid, delta integer DEFAULT 1)
RETURNS void AS $$
BEGIN
  EXECUTE format('UPDATE %I SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', table_name, field_name, field_name)
  USING delta, row_id;
END;
$$ LANGUAGE plpgsql;
