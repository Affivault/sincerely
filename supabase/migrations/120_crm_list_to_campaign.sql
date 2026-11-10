-- ============================================================================
-- 120 - A HubSpot list or Pipedrive filter can feed a campaign.
--
-- A list pulled in from the CRM (migration 118) can now also add the people
-- it brings in to a campaign, so "new people in my HubSpot list" become
-- "new people in my sequence" with nothing to do by hand. People the
-- campaign cannot take (already in it, unsubscribed, bounced, suppressed)
-- are skipped the same way as everywhere else.
--
-- Depends on: 118. Safe to run more than once.
-- ============================================================================

ALTER TABLE crm_list_syncs ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

-- So the API sees the new column straight away.
NOTIFY pgrst, 'reload schema';
