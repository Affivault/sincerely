-- 028: Prospector — credit ledger, reveal dedupe, and atomic credit spend.
-- Run in the Supabase SQL Editor. Idempotent.

-- Every credit movement is a ledger row. Spends are negative, grants/refunds
-- positive. A user's balance for the current month =
--   plan allowance + sum(deltas this month).
CREATE TABLE IF NOT EXISTS prospect_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  kind text NOT NULL DEFAULT 'spend',          -- spend | refund | topup | adjustment
  reason text,
  provider text,
  provider_person_id text,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospect_ledger_user_created
  ON prospect_credit_ledger(user_id, created_at);

-- One row per person a user has ever revealed — a revealed prospect is never
-- charged twice, even across months.
CREATE TABLE IF NOT EXISTS prospect_reveals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_person_id text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, provider_person_id)
);
CREATE INDEX IF NOT EXISTS idx_prospect_reveals_user ON prospect_reveals(user_id);

-- Atomically spend prospect credits: takes a per-user lock, recomputes the
-- month's usage, and only inserts the spend if it fits the plan allowance.
-- Returns the remaining balance after the spend, or -1 when out of credits.
-- (p_allowance = -1 means unlimited.)
CREATE OR REPLACE FUNCTION try_spend_prospect_credits(
  p_user_id uuid,
  p_amount integer,
  p_allowance integer,
  p_reason text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_person_id text DEFAULT NULL
) RETURNS integer AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now());
  v_balance integer;
BEGIN
  -- Serialize concurrent spends for the same user.
  PERFORM pg_advisory_xact_lock(hashtext('prospect_credits:' || p_user_id::text));

  IF p_allowance >= 0 THEN
    SELECT p_allowance + COALESCE(SUM(delta), 0) INTO v_balance
    FROM prospect_credit_ledger
    WHERE user_id = p_user_id AND created_at >= v_month_start;

    IF v_balance < p_amount THEN
      RETURN -1;
    END IF;
  END IF;

  INSERT INTO prospect_credit_ledger (user_id, delta, kind, reason, provider, provider_person_id)
  VALUES (p_user_id, -p_amount, 'spend', p_reason, p_provider, p_provider_person_id);

  IF p_allowance < 0 THEN
    RETURN 2147483647; -- unlimited
  END IF;
  RETURN v_balance - p_amount;
END;
$$ LANGUAGE plpgsql;
