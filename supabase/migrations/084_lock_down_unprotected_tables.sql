-- 084: lock down tables and functions that the public API key could reach.
--
-- On Supabase every table in the public schema is served by the REST API,
-- and the anon key that reaches it ships inside the web app. A table with
-- row level security switched off is therefore readable and writable by
-- anyone holding that key, across every account: deals, tasks, leads, team
-- members, connected integrations, the suppression list, the credit ledger.
--
-- The app never queries these tables from the browser. Every read and write
-- goes through the server, which uses the service role and bypasses RLS. So
-- switching RLS on with no policies (deny all for anon and authenticated)
-- closes the hole without changing anything the app does.
--
-- Safe to run more than once.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campaign_daily_send_counters',
    'crm_events',
    'crm_tasks',
    'deal_participants',
    'deal_stage_events',
    'deals',
    'integration_activity',
    'leads',
    'organizations',
    'prospect_credit_ledger',
    'prospect_reveals',
    'suppression_list',
    'team_invites',
    'team_members',
    'user_integrations',
    'warmup_emails'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- Functions. Supabase grants EXECUTE on every function in public to anon
-- and authenticated by default, and REVOKE ... FROM PUBLIC does not remove
-- those grants. Several are SECURITY DEFINER, which run with the owner's
-- rights and ignore RLS:
--   claim_booking_reminders returned every account's upcoming booked
--     meetings, manage tokens included (enough to cancel or move them), and
--     stamped them as reminded so the real reminders never went out;
--   contact_companies(uid) returned any account's company names and counts;
--   book_slot, increment_link_views, recount_contact_lists likewise.
-- Nothing outside the server calls a database function (the web app and the
-- extension only talk to the API), so EXECUTE is taken from anon and
-- authenticated on all of them and kept for the service role. Trigger
-- functions are skipped: triggers do not check EXECUTE.
DO $$
DECLARE
  f record;
  v_role text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f.sig, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;

-- And for functions added by later migrations (run as this same role), so
-- the next one is not exposed by default either.
DO $$
DECLARE
  v_role text;
BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
  END IF;
END $$;
