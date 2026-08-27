-- 049: Atomic dedup for open/click tracking events
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- tracking.routes.ts recorded opens/clicks with a non-atomic
-- "SELECT count(*), then INSERT if zero" pattern. Two near-simultaneous
-- requests for the same tracking id (Apple Mail Privacy Protection
-- prefetching the pixel, Gmail's image proxy plus the real client, Outlook
-- Safe Links prefetching a link right before the user's own click) could
-- both pass the count check before either insert landed, producing
-- duplicate campaign_activities rows and firing email.opened/email.clicked
-- webhooks twice for one real event. This partial unique index plus RPC
-- replaces check-then-act with a single atomic insert-or-ignore, the same
-- reserve-then-refund style already used elsewhere in this schema (036).

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_activities_open_click_dedup
  ON campaign_activities (campaign_contact_id, step_id, activity_type)
  WHERE activity_type IN ('opened', 'clicked');

-- Inserts the activity row and returns whether it was actually a new event
-- (false if an 'opened'/'clicked' row for this contact+step already existed).
CREATE OR REPLACE FUNCTION record_tracking_event(
  p_campaign_id uuid,
  p_campaign_contact_id uuid,
  p_contact_id uuid,
  p_step_id uuid,
  p_activity_type text,
  p_metadata jsonb
)
RETURNS boolean AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO campaign_activities (
    campaign_id, campaign_contact_id, contact_id, step_id, activity_type, occurred_at, metadata
  ) VALUES (
    p_campaign_id, p_campaign_contact_id, p_contact_id, p_step_id, p_activity_type, now(), p_metadata
  )
  ON CONFLICT (campaign_contact_id, step_id, activity_type) WHERE activity_type IN ('opened', 'clicked')
  DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql;
