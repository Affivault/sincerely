-- 022: Clamp the monthly email counter at zero
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- Failed sends now refund their reserved quota slot by calling
-- increment_email_usage with a negative count. Clamp at 0 so refunds can
-- never drive the counter negative (which would grant extra quota).
CREATE OR REPLACE FUNCTION increment_email_usage(p_user_id uuid, p_count integer DEFAULT 1)
RETURNS void AS $$
  INSERT INTO usage_counters (user_id, period_start, emails_sent, updated_at)
  VALUES (p_user_id, date_trunc('month', now())::date, GREATEST(p_count, 0), now())
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET emails_sent = GREATEST(0, usage_counters.emails_sent + p_count), updated_at = now();
$$ LANGUAGE sql;
