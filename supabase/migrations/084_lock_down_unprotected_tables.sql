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

-- contact_companies(uid) is SECURITY DEFINER: it runs with the owner's
-- rights and ignores RLS. Callable by the anon key, it returned any account's
-- company names and contact counts to whoever passed that account's id.
-- recount_contact_lists(uuid[]) is the same shape. Both are only ever called
-- by the server, so only the service role keeps EXECUTE.
DO $$
DECLARE
  v_sig text;
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.contact_companies(uuid)',
    'public.recount_contact_lists(uuid[])'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
      FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_sig, v_role);
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
      END IF;
    END IF;
  END LOOP;
END $$;
