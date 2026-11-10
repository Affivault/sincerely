-- ============================================================================
-- 119 - The first sync with HubSpot or Pipedrive, with progress.
--
-- Connecting a CRM now starts with a short setup: which Sincerely contacts
-- go to the CRM (all, one list, or none) and which CRM contacts come into
-- Sincerely (a list, everyone, or none). That first sync runs in batches in
-- the background and can take a while for a big account, so its state and
-- progress are kept here, where the sync page reads them and the server
-- picks the work up again after a restart.
--
-- The same machinery sends people picked on the Leads or Contacts page
-- ("Send to HubSpot") in one go.
--
-- user_integrations.sync_backfill (jsonb):
--   status          'idle' | 'running' | 'done' | 'failed'
--   setup_done_at   when the setup was finished (the page stops showing it)
--   to_crm          { scope, list_id, ids, total, done, failed, cursor }
--   from_crm        { scope, external_id, external_name, list_id, total,
--                     done, added, cursor }
--   started_at, finished_at, error
--
-- Depends on: 118. Safe to run more than once.
-- ============================================================================

ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS sync_backfill jsonb NOT NULL DEFAULT '{}'::jsonb;

-- So the API sees the new column straight away.
NOTIFY pgrst, 'reload schema';
