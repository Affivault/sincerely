-- ============================================================================
-- 118 - Two-way sync with HubSpot and Pipedrive.
--
-- Until now a CRM connection only pushed: a reply or an interested lead was
-- copied into the CRM. This adds what a two-way sync needs to remember.
--
-- 1. user_integrations gains:
--      sync_settings   what to sync, the field mapping, the deal pipeline and
--                      stage, what a won or lost deal does to the sequence.
--      sync_cursors    how far the last run read each CRM feed (people,
--                      deals, Sincerely edits), so each run only reads what
--                      changed since.
--      last_sync_at, next_sync_at, last_sync_error   for the status page and
--                      the scheduler.
--
-- 2. crm_links: which CRM record each Sincerely contact is, and the values of
--    the mapped fields both sides last agreed on. Comparing each side with
--    that snapshot is how a run knows which side was edited; when both were,
--    the most recent edit wins.
--
-- 3. crm_sync_log: every item moved in either direction, and every failure
--    with the reason. A failure that can be sent again keeps what is needed
--    to send it (retry), so the status page can retry it and the scheduler
--    retries it on its own a few times.
--
-- 4. crm_list_syncs: a HubSpot list or Pipedrive filter pulled into a
--    Sincerely list and kept up to date.
--
-- 5. Existing HubSpot and Pipedrive connections also receive unsubscribes
--    and bounces, so those reach the CRM without anyone reconnecting.
--
-- Server-only tables: row level security on, no policies, so only the
-- service role (the API server) can read or write them.
--
-- Depends on: user_integrations (035), contacts, contact_lists.
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS sync_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS sync_cursors jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS next_sync_at timestamptz;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE INDEX IF NOT EXISTS idx_user_integrations_next_sync
  ON user_integrations (next_sync_at)
  WHERE is_active AND provider IN ('hubspot', 'pipedrive');

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  integration_id    uuid NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  external_id       text NOT NULL,
  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  remote_updated_at timestamptz,
  deal_id           text,
  deal_status       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, contact_id),
  UNIQUE (integration_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_links_contact ON crm_links (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_links_user ON crm_links (user_id);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  integration_id  uuid NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('to_crm', 'from_crm')),
  kind            text NOT NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email           text,
  status          text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  summary         text NOT NULL,
  error           text,
  retry           jsonb,
  attempts        integer NOT NULL DEFAULT 1,
  retried_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_sync_log_integration
  ON crm_sync_log (integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sync_log_retry
  ON crm_sync_log (integration_id, created_at)
  WHERE status = 'failed' AND retry IS NOT NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm_list_syncs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  integration_id  uuid NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  external_name   text NOT NULL,
  list_id         uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
  enabled         boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  last_status     text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, external_id)
);

-- ---------------------------------------------------------------------------

ALTER TABLE crm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_list_syncs ENABLE ROW LEVEL SECURITY;

-- Existing connections: unsubscribes and bounces now reach the CRM too.
UPDATE user_integrations
SET events = (
  SELECT array_agg(DISTINCT e)
  FROM unnest(events || ARRAY['lead.unsubscribed', 'email.bounced']::text[]) AS e
)
WHERE provider IN ('hubspot', 'pipedrive')
  AND NOT (events @> ARRAY['lead.unsubscribed', 'email.bounced']::text[]);

-- The first scheduled run, a few minutes after this is applied.
UPDATE user_integrations
SET next_sync_at = now() + interval '5 minutes'
WHERE provider IN ('hubspot', 'pipedrive') AND is_active AND next_sync_at IS NULL;

-- So the API sees the new columns and tables straight away.
NOTIFY pgrst, 'reload schema';
