-- 029: Prospect credit packs — purchased credits that never expire, spent
-- after the plan's monthly allowance. Run in the Supabase SQL Editor. Idempotent.

-- 'plan' rows count against the monthly allowance window; 'purchased' rows
-- form a persistent balance (topups + their spends/refunds, all-time).
ALTER TABLE prospect_credit_ledger
  ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT 'plan';

-- Stripe checkout session id on topup rows — makes webhook grants idempotent
-- (a replayed webhook can't grant the same pack twice).
ALTER TABLE prospect_credit_ledger
  ADD COLUMN IF NOT EXISTS stripe_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_ledger_stripe_session
  ON prospect_credit_ledger(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Replace the spend function with a bucket-aware version: draw from the
-- monthly plan allowance first, then from the purchased balance.
DROP FUNCTION IF EXISTS try_spend_prospect_credits(uuid, integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION try_spend_prospect_credits(
  p_user_id uuid,
  p_amount integer,
  p_allowance integer,             -- monthly plan allowance; -1 = unlimited
  p_reason text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_person_id text DEFAULT NULL
) RETURNS TABLE (spent_bucket text, plan_remaining integer, purchased_remaining integer) AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now());
  v_plan_balance integer;
  v_purchased_balance integer;
  v_bucket text;
BEGIN
  -- Serialize concurrent spends for the same user.
  PERFORM pg_advisory_xact_lock(hashtext('prospect_credits:' || p_user_id::text));

  -- Plan balance: allowance + this month's plan-bucket movements.
  IF p_allowance < 0 THEN
    v_plan_balance := 2147483647; -- unlimited
  ELSE
    SELECT p_allowance + COALESCE(SUM(delta), 0) INTO v_plan_balance
    FROM prospect_credit_ledger
    WHERE user_id = p_user_id AND bucket = 'plan' AND created_at >= v_month_start;
  END IF;

  -- Purchased balance: all-time purchased-bucket movements.
  SELECT COALESCE(SUM(delta), 0) INTO v_purchased_balance
  FROM prospect_credit_ledger
  WHERE user_id = p_user_id AND bucket = 'purchased';

  IF v_plan_balance >= p_amount THEN
    v_bucket := 'plan';
    v_plan_balance := v_plan_balance - p_amount;
  ELSIF v_purchased_balance >= p_amount THEN
    v_bucket := 'purchased';
    v_purchased_balance := v_purchased_balance - p_amount;
  ELSE
    -- Not enough credits anywhere — no row inserted.
    RETURN QUERY SELECT NULL::text, v_plan_balance, v_purchased_balance;
    RETURN;
  END IF;

  INSERT INTO prospect_credit_ledger (user_id, delta, kind, reason, provider, provider_person_id, bucket)
  VALUES (p_user_id, -p_amount, 'spend', p_reason, p_provider, p_provider_person_id, v_bucket);

  RETURN QUERY SELECT v_bucket, v_plan_balance, v_purchased_balance;
END;
$$ LANGUAGE plpgsql;
