-- 057: Atomic clamped health-score adjustment
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- recordBounce/recordOpen in sse.service.ts adjusted smtp_accounts.health_score
-- via a plain read-then-write (select health_score, compute, update). Under
-- concurrent bounces or opens on the same account, two of those can race:
-- both read the same starting score, and the second write clobbers the
-- first's adjustment instead of stacking with it. Every other per-account
-- counter this codebase cares about getting right under concurrency
-- (reserve_warmup_send, reserve_campaign_daily_send) is already a single
-- atomic UPDATE for exactly this reason; health_score was the one left on
-- the racy path. A single UPDATE statement is atomic per row, so folding the
-- clamp into one lets Postgres serialize concurrent adjustments instead of
-- the application doing a lossy read-modify-write.
CREATE OR REPLACE FUNCTION adjust_health_score(p_account_id uuid, p_delta integer)
RETURNS integer AS $$
DECLARE
  v_new integer;
BEGIN
  UPDATE smtp_accounts
  SET health_score = LEAST(100, GREATEST(0, health_score + p_delta))
  WHERE id = p_account_id
  RETURNING health_score INTO v_new;

  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
