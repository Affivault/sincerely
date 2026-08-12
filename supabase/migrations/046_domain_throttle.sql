-- ============================================================================
-- 046: Do not drop thirty emails into one company inside a minute.
--
-- Nothing has ever limited how fast a campaign reaches a single recipient
-- domain. A list sorted by company -- which is how most exports arrive --
-- sends every address at acme.com back to back, and that burst is exactly the
-- pattern a recipient's gateway is built to notice. It gets the sending domain
-- flagged at that organisation, so the one company you most wanted to reach is
-- the first to stop receiving you.
--
-- The counter is per account rather than per campaign: two campaigns hitting
-- the same company at once is the same problem, and the gateway on the other
-- side does not care which campaign a message came from.
--
-- Consumer providers are exempt in application code. gmail.com is not an
-- organisation, and throttling it as though it were would cap any campaign
-- aimed at freelancers and one-person businesses at a few sends an hour for
-- no benefit whatsoever.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The counter.
--
-- One row per account, domain and hour. period_start is the truncated hour, so
-- rows are naturally bucketed and old ones can be swept without touching live
-- counts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_send_counters (
  user_id      uuid        NOT NULL,
  domain       text        NOT NULL,
  period_start timestamptz NOT NULL,
  sent_count   integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, domain, period_start)
);

-- Sweeping expired buckets, and nothing else, so it is a cheap index to carry.
CREATE INDEX IF NOT EXISTS idx_domain_send_counters_period
  ON domain_send_counters (period_start);

ALTER TABLE domain_send_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'domain_send_counters' AND policyname = 'Users see their own domain counters'
  ) THEN
    CREATE POLICY "Users see their own domain counters"
      ON domain_send_counters FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Atomic reserve, mirroring reserve_campaign_daily_send from migration 036.
--
-- Check-then-increment in application code would let two overlapping worker
-- runs both pass the check before either wrote, which is precisely the burst
-- this is meant to prevent. SELECT ... FOR UPDATE serialises them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_domain_send(
  p_user_id uuid,
  p_domain text,
  p_period_start timestamptz,
  p_limit integer
)
RETURNS boolean AS $$
DECLARE
  v_current integer;
BEGIN
  -- p_limit <= 0 means unlimited, matching the daily_limit convention.
  IF p_limit <= 0 THEN
    RETURN true;
  END IF;

  INSERT INTO domain_send_counters (user_id, domain, period_start, sent_count, updated_at)
  VALUES (p_user_id, p_domain, p_period_start, 0, now())
  ON CONFLICT (user_id, domain, period_start) DO NOTHING;

  SELECT sent_count INTO v_current
  FROM domain_send_counters
  WHERE user_id = p_user_id AND domain = p_domain AND period_start = p_period_start
  FOR UPDATE;

  IF v_current + 1 > p_limit THEN
    RETURN false;
  END IF;

  UPDATE domain_send_counters
  SET sent_count = sent_count + 1, updated_at = now()
  WHERE user_id = p_user_id AND domain = p_domain AND period_start = p_period_start;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. Give back a reserved slot the send never used.
--
-- Floored at zero: a double refund must not lend the next hour extra capacity.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refund_domain_send(
  p_user_id uuid,
  p_domain text,
  p_period_start timestamptz
)
RETURNS void AS $$
BEGIN
  UPDATE domain_send_counters
  SET sent_count = GREATEST(sent_count - 1, 0), updated_at = now()
  WHERE user_id = p_user_id AND domain = p_domain AND period_start = p_period_start;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. The account's limit.
--
-- Five an hour to one organisation is unremarkable to a gateway and still
-- lets a campaign work through a large company over a day. Zero disables it,
-- matching how daily_limit already reads.
-- ----------------------------------------------------------------------------
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS domain_hourly_limit integer NOT NULL DEFAULT 5;

ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_domain_hourly_limit_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_domain_hourly_limit_check
  CHECK (domain_hourly_limit >= 0 AND domain_hourly_limit <= 10000);
