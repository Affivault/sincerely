-- ============================================================================
-- 121 - Meetings booked through Calendly or Cal.com.
--
-- Calendly and Cal.com can be connected listen-only: when somebody books
-- through the account's own Calendly or Cal.com link, the meeting is
-- recorded here like a Sincerely booking - on the calendar and the
-- contact's timeline, their sequences stopped, a deal opened, and passed on
-- to a connected HubSpot or Pipedrive.
--
-- crm_events.external_source / external_id say which booking in which tool
-- a meeting came from ('calendly', 'calcom'), so the same booking arriving
-- twice (an instant notification and a later check) is recorded once, and
-- a cancellation or a reschedule finds the meeting it belongs to.
--
-- Depends on: crm_events (025), 118 (user_integrations.sync_cursors and
-- next_sync_at, used to check for bookings on plans without notifications).
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_events_external
  ON crm_events (user_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Checking Calendly or Cal.com for new bookings on a schedule.
CREATE INDEX IF NOT EXISTS idx_user_integrations_scheduling_poll
  ON user_integrations (next_sync_at)
  WHERE is_active AND provider IN ('calendly', 'calcom');

-- So the API sees the new columns straight away.
NOTIFY pgrst, 'reload schema';
