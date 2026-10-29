-- 102: Admin control - sign an account out everywhere, per-account limits and
-- feature switches, a hold on an account's sending, and platform settings.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- Needs 101_admin_backend.sql to have been run first.
--
-- 1. account_controls gains:
--    sessions_revoked_at - tokens issued before this are refused (sign out everywhere)
--    limit_overrides     - per-account inboxes / emails a month, over the plan's
--    feature_overrides   - per-account feature switches, over the plan's
--    sending_paused_at   - while set, nothing of theirs sends
-- 2. platform_settings: one row per setting the owner can change without a
--    deploy (plan limits, credit prices, sign-ups, announcement, kill switch,
--    alerts). Server only.
-- 3. admin_sign_out_user(uuid): ends every session and refresh token of one
--    account, so it is signed out on every device. Server only.


-- 1. Account controls -------------------------------------------------------------

ALTER TABLE account_controls ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
ALTER TABLE account_controls ADD COLUMN IF NOT EXISTS limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE account_controls ADD COLUMN IF NOT EXISTS feature_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE account_controls ADD COLUMN IF NOT EXISTS sending_paused_at timestamptz;

-- 2. Platform settings -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE platform_settings FROM %I', v_role);
    END IF;
  END LOOP;
END $$;

-- 3. Sign out everywhere -------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_sign_out_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION admin_sign_out_user(uuid) FROM PUBLIC;
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION admin_sign_out_user(uuid) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION admin_sign_out_user(uuid) TO service_role;
  END IF;
END $$;
