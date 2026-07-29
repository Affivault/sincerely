-- 035: RLS lockdown for tables that shipped without Row Level Security.
--
-- Every table below is only ever queried by the server using the service-role
-- key (which bypasses RLS), so this migration changes no app behavior. What it
-- closes is direct access via Supabase's auto-generated PostgREST API: the
-- anon key is public (shipped in the client bundle), so any table without RLS
-- is readable/writable by anyone who can call `${SUPABASE_URL}/rest/v1/<table>`
-- with that key. None of these tables have a legitimate direct-client use
-- case, so we lock them down entirely rather than trying to replicate the
-- server's per-tenant filtering in policy form.
-- Run in the Supabase SQL Editor. Idempotent.

ALTER TABLE suppression_list       ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_reveals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmup_emails          ENABLE ROW LEVEL SECURITY;

-- suppression_list has a user_id, so give it the same self-service policy
-- used everywhere else in this schema rather than a blanket deny.
DROP POLICY IF EXISTS "suppression_list_user_own" ON suppression_list;
CREATE POLICY "suppression_list_user_own" ON suppression_list FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "deals_user_own" ON deals;
CREATE POLICY "deals_user_own" ON deals FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "crm_tasks_user_own" ON crm_tasks;
CREATE POLICY "crm_tasks_user_own" ON crm_tasks FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "crm_events_user_own" ON crm_events;
CREATE POLICY "crm_events_user_own" ON crm_events FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "prospect_credit_ledger_user_own" ON prospect_credit_ledger;
CREATE POLICY "prospect_credit_ledger_user_own" ON prospect_credit_ledger FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "prospect_reveals_user_own" ON prospect_reveals;
CREATE POLICY "prospect_reveals_user_own" ON prospect_reveals FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "warmup_emails_user_own" ON warmup_emails;
CREATE POLICY "warmup_emails_user_own" ON warmup_emails FOR ALL USING (user_id = auth.uid());

-- organizations / team_members / team_invites have no direct-client access
-- path at all (server.service.ts does every read/write with supabaseAdmin).
-- team_invites in particular stores the join token, so it gets no policy at
-- all: RLS enabled + zero policies means default-deny for anon/authenticated,
-- while the service role (server) is unaffected.
DROP POLICY IF EXISTS "organizations_owner_only" ON organizations;
CREATE POLICY "organizations_owner_only" ON organizations FOR ALL USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "team_members_self_only" ON team_members;
CREATE POLICY "team_members_self_only" ON team_members FOR ALL USING (user_id = auth.uid());

-- Close a cross-tenant leak in the SECURITY DEFINER contact_companies() RPC:
-- it took an arbitrary `uid` argument instead of pinning to the caller's own
-- id, so any authenticated user could pass another tenant's user id and read
-- their company/lead breakdown. Pin it to auth.uid() instead of trusting the
-- argument.
CREATE OR REPLACE FUNCTION contact_companies(uid uuid)
RETURNS TABLE(company text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company, count(*)::bigint AS count
  FROM contacts
  WHERE user_id = auth.uid()
    AND company IS NOT NULL
    AND btrim(company) <> ''
  GROUP BY company
  ORDER BY count(*) DESC, company ASC
  LIMIT 500;
$$;

-- email_templates / sequence_templates used a single FOR ALL policy that let
-- any authenticated user UPDATE/DELETE the shared is_preset=true rows (the
-- built-in template library), since the same USING clause governs mutations
-- as well as reads. Split into a shared-read policy plus an owner-only
-- mutate policy.
DROP POLICY IF EXISTS "Users can manage their own email templates" ON email_templates;
CREATE POLICY "email_templates_select" ON email_templates
  FOR SELECT USING (auth.uid() = user_id OR is_preset = true);
CREATE POLICY "email_templates_insert" ON email_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "email_templates_update" ON email_templates
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "email_templates_delete" ON email_templates
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own sequence templates" ON sequence_templates;
CREATE POLICY "sequence_templates_select" ON sequence_templates
  FOR SELECT USING (auth.uid() = user_id OR is_preset = true);
CREATE POLICY "sequence_templates_insert" ON sequence_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sequence_templates_update" ON sequence_templates
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sequence_templates_delete" ON sequence_templates
  FOR DELETE USING (auth.uid() = user_id);
