-- 100: Credit billing - every paid action costs credits, and we can see what
-- each account costs us against what it pays.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- 1. Credits go to one decimal place, so a search page can cost 0.5 and a
--    deep email check 0.1. The ledger's delta becomes numeric and the spend
--    function takes a numeric amount.
-- 2. action on every ledger row (search, reveal, verify, enrich), on refunds
--    too, so the usage page can say what the credits went on.
-- 3. subscriptions.credit_allowance: a monthly credit allowance set by hand
--    for one account (a Scale deal), overriding the plan's. NULL = the plan's.
-- 4. provider_usage: one row per paid Icypeas call - who, which action, how
--    many Icypeas credits it burned and what that cost us in dollars.
-- 5. billing_payments: every Stripe payment, so revenue per account is a
--    query and not a guess.
-- 6. Two report functions for the admin "Usage and profit" page.


-- 1. Decimal credits ---------------------------------------------------------

ALTER TABLE prospect_credit_ledger
  ALTER COLUMN delta TYPE numeric(12,1) USING delta::numeric(12,1);

-- 2. What each movement was for ----------------------------------------------

ALTER TABLE prospect_credit_ledger ADD COLUMN IF NOT EXISTS action text;

UPDATE prospect_credit_ledger
   SET action = CASE
     WHEN kind = 'spend' THEN reason
     WHEN kind = 'refund' AND reason IN ('no_email_found', 'provider_error', 'contact_write_error', 'concurrent_reveal', 'reveal_insert_error') THEN 'reveal'
     WHEN kind = 'topup' THEN 'topup'
     ELSE NULL
   END
 WHERE action IS NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_ledger_created ON prospect_credit_ledger(created_at);

-- The integer version from 029 is replaced by a numeric one with an action.
DROP FUNCTION IF EXISTS try_spend_prospect_credits(uuid, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS try_spend_prospect_credits(uuid, numeric, numeric, text, text, text, text);

CREATE OR REPLACE FUNCTION try_spend_prospect_credits(
  p_user_id uuid,
  p_amount numeric,
  p_allowance numeric,             -- monthly allowance; -1 = unlimited
  p_reason text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_person_id text DEFAULT NULL,
  p_action text DEFAULT NULL
) RETURNS TABLE (spent_bucket text, plan_remaining numeric, purchased_remaining numeric) AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now());
  v_plan_balance numeric;
  v_purchased_balance numeric;
  v_bucket text;
BEGIN
  -- Serialize concurrent spends for the same user.
  PERFORM pg_advisory_xact_lock(hashtext('prospect_credits:' || p_user_id::text));

  IF p_allowance < 0 THEN
    v_plan_balance := 2147483647; -- unlimited
  ELSE
    SELECT p_allowance + COALESCE(SUM(delta), 0) INTO v_plan_balance
    FROM prospect_credit_ledger
    WHERE user_id = p_user_id AND bucket = 'plan' AND created_at >= v_month_start;
  END IF;

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
    -- Not enough credits anywhere: nothing is spent.
    RETURN QUERY SELECT NULL::text, v_plan_balance, v_purchased_balance;
    RETURN;
  END IF;

  INSERT INTO prospect_credit_ledger (user_id, delta, kind, reason, provider, provider_person_id, bucket, action)
  VALUES (p_user_id, -p_amount, 'spend', p_reason, p_provider, p_provider_person_id, v_bucket, COALESCE(p_action, p_reason));

  RETURN QUERY SELECT v_bucket, v_plan_balance, v_purchased_balance;
END;
$$ LANGUAGE plpgsql;

-- 3. A hand-set allowance for one account -------------------------------------

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credit_allowance numeric(12,1);

-- 4. What every paid provider call cost us -------------------------------------

CREATE TABLE IF NOT EXISTS provider_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,                                -- NULL = not on behalf of an account
  action text NOT NULL DEFAULT 'other',        -- search | reveal | verify | enrich | other
  provider text NOT NULL DEFAULT 'icypeas',
  endpoint text NOT NULL,
  provider_credits numeric(10,2) NOT NULL DEFAULT 0,
  cost_usd numeric(12,5) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_provider_usage_user_created ON provider_usage(user_id, created_at);
ALTER TABLE provider_usage ENABLE ROW LEVEL SECURITY;

-- 5. What every account has paid us ----------------------------------------------

CREATE TABLE IF NOT EXISTS billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  stripe_customer_id text,
  stripe_ref text NOT NULL,                    -- invoice id, or checkout session id for a one-off
  kind text NOT NULL DEFAULT 'subscription',   -- subscription | credit_pack
  amount_usd numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_ref)
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_paid ON billing_payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_billing_payments_user ON billing_payments(user_id);
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;

-- 6. Reports for the admin page --------------------------------------------------

CREATE OR REPLACE FUNCTION admin_provider_costs(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (user_id uuid, action text, calls bigint, provider_credits numeric, cost_usd numeric) AS $$
  SELECT u.user_id, u.action, COUNT(*), COALESCE(SUM(u.provider_credits), 0), COALESCE(SUM(u.cost_usd), 0)
  FROM provider_usage u
  WHERE u.created_at >= p_from AND u.created_at < p_to
  GROUP BY u.user_id, u.action;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION admin_credits_charged(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (user_id uuid, action text, credits numeric) AS $$
  SELECT l.user_id, COALESCE(l.action, 'other'), COALESCE(-SUM(l.delta), 0)
  FROM prospect_credit_ledger l
  WHERE l.created_at >= p_from AND l.created_at < p_to
    AND l.kind IN ('spend', 'refund')
  GROUP BY l.user_id, COALESCE(l.action, 'other');
$$ LANGUAGE sql STABLE;

-- Server only, like every other function (see 084).
DO $$
DECLARE
  f text;
  v_role text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'try_spend_prospect_credits(uuid, numeric, numeric, text, text, text, text)',
    'admin_provider_costs(timestamptz, timestamptz)',
    'admin_credits_charged(timestamptz, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;
