-- 019: Billing — subscriptions + monthly usage counters
-- Run this in the Supabase SQL Editor. Idempotent.

-- Per-user subscription. Stripe columns are nullable so this works before
-- billing goes live (everyone defaults to the trial plan).
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);

-- Monthly metered usage (one row per user per calendar month).
CREATE TABLE IF NOT EXISTS usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  emails_sent integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user_period ON usage_counters(user_id, period_start);

-- Generic updated_at trigger fn (safe to (re)create).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Atomic monthly email increment — creates the current period row if needed.
CREATE OR REPLACE FUNCTION increment_email_usage(p_user_id uuid, p_count integer DEFAULT 1)
RETURNS void AS $$
  INSERT INTO usage_counters (user_id, period_start, emails_sent, updated_at)
  VALUES (p_user_id, date_trunc('month', now())::date, p_count, now())
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET emails_sent = usage_counters.emails_sent + p_count, updated_at = now();
$$ LANGUAGE sql;

-- RLS: a user may read their own subscription + usage. All writes happen
-- server-side with the service-role key (which bypasses RLS).
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own subscription" ON subscriptions;
CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own usage" ON usage_counters;
CREATE POLICY "Users can read own usage"
  ON usage_counters FOR SELECT
  USING (auth.uid() = user_id);
