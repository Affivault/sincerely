-- 103: Sign-ups open, invite-only or closed, set from the admin backend.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- Needs 102_admin_control.sql to have been run first (platform_settings).
--
-- The owners set platform_settings key 'signups' to
--   {"mode": "open" | "invite" | "closed", "allow": ["someone@x.com", "@company.com"]}
-- and this trigger enforces it on every new account, email or Google alike,
-- because Supabase creates the user before the app ever sees it.
--
--   open    - anyone can sign up (also when the setting is missing)
--   invite  - only addresses on the allow list, or at an @domain on it
--   closed  - nobody new
--
-- Existing accounts are never affected: this runs on INSERT only. If the
-- setting cannot be read for any reason, sign-ups stay open rather than
-- locking everyone out.

CREATE OR REPLACE FUNCTION public.enforce_signup_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_setting jsonb;
  v_mode text;
  v_email text := lower(coalesce(NEW.email, ''));
BEGIN
  BEGIN
    SELECT value INTO v_setting FROM public.platform_settings WHERE key = 'signups';
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  v_mode := coalesce(v_setting->>'mode', 'open');
  IF v_mode NOT IN ('invite', 'closed') THEN
    RETURN NEW;
  END IF;

  IF v_mode = 'invite' AND v_email <> '' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(coalesce(v_setting->'allow', '[]'::jsonb)) AS a(entry)
    WHERE lower(a.entry) = v_email
       OR (left(a.entry, 1) = '@' AND right(v_email, length(a.entry)) = lower(a.entry))
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SIGNUPS_CLOSED: sign-ups are %', v_mode USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS enforce_signup_mode ON auth.users;
CREATE TRIGGER enforce_signup_mode
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_mode();
