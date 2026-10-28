-- 101: Admin backend - manage accounts, and a record of every admin action.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- Needs 100_credit_billing.sql to have been run first.
--
-- 1. account_controls: one row per account the owner has acted on.
--    suspended_at / suspended_reason - a suspended account is signed out,
--    cannot sign in, sends nothing and spends no credits.
--    note - the owner's private note on the account.
--    This is its own table, not columns on subscriptions, because every
--    account can read its own subscriptions row (019); nobody but the
--    server can read this one.
-- 2. admin_audit_log: one row for every change made from the admin backend -
--    who made it, to which account, and what changed.


-- 1. Account controls ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_controls (
  user_id uuid PRIMARY KEY,
  suspended_at timestamptz,
  suspended_reason text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_controls_suspended
  ON account_controls(user_id) WHERE suspended_at IS NOT NULL;
ALTER TABLE account_controls ENABLE ROW LEVEL SECURITY;

-- 2. The audit log -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  action text NOT NULL,              -- plan | allowance | credits | suspend | unsuspend | note | lifetime_grant | lifetime_revoke
  target_user_id uuid,
  target_email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id, created_at DESC);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Server only: RLS on with no policies, and no grants to the client roles,
-- so only the service role can read or write either table.
DO $$
DECLARE
  t text;
  v_role text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_controls', 'admin_audit_log'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', t, v_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
