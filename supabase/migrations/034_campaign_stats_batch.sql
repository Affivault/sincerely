-- 034: Batch campaign stats lookup for the campaigns list endpoint
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- campaignsService.list() previously called getStats() once per campaign,
-- and getStats() itself fires 13 separate count queries. A single page of
-- campaigns (default page size 25) could trigger up to 325 DB round-trips.
-- This RPC aggregates steps/contacts/activities for a whole batch of
-- campaign ids in one query so the list endpoint can fetch stats for an
-- entire page in a single call.
CREATE OR REPLACE FUNCTION get_campaigns_stats(p_campaign_ids uuid[])
RETURNS TABLE (
  campaign_id uuid,
  steps_count bigint,
  contacts_count bigint,
  sent_count bigint,
  opened_count bigint,
  clicked_count bigint,
  replied_count bigint,
  bounced_count bigint,
  active_contacts bigint,
  completed_contacts bigint,
  bounced_contacts bigint,
  unsubscribed_contacts bigint,
  suppressed_contacts bigint,
  error_contacts bigint
) AS $$
  SELECT
    ids.id AS campaign_id,
    COALESCE(steps.cnt, 0) AS steps_count,
    COALESCE(contacts.total, 0) AS contacts_count,
    COALESCE(acts.sent, 0) AS sent_count,
    COALESCE(acts.opened, 0) AS opened_count,
    COALESCE(acts.clicked, 0) AS clicked_count,
    COALESCE(acts.replied, 0) AS replied_count,
    COALESCE(acts.bounced, 0) AS bounced_count,
    COALESCE(contacts.active, 0) AS active_contacts,
    COALESCE(contacts.completed, 0) AS completed_contacts,
    COALESCE(contacts.bounced, 0) AS bounced_contacts,
    COALESCE(contacts.unsubscribed, 0) AS unsubscribed_contacts,
    COALESCE(contacts.suppressed, 0) AS suppressed_contacts,
    COALESCE(contacts.error, 0) AS error_contacts
  FROM unnest(p_campaign_ids) AS ids(id)
  LEFT JOIN (
    SELECT campaign_id, count(*) AS cnt
    FROM campaign_steps
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) steps ON steps.campaign_id = ids.id
  LEFT JOIN (
    SELECT
      campaign_id,
      count(*) AS total,
      count(*) FILTER (WHERE status = 'active') AS active,
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'bounced') AS bounced,
      count(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed,
      count(*) FILTER (WHERE status = 'suppressed') AS suppressed,
      count(*) FILTER (WHERE status = 'error') AS error
    FROM campaign_contacts
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) contacts ON contacts.campaign_id = ids.id
  LEFT JOIN (
    SELECT
      campaign_id,
      count(*) FILTER (WHERE activity_type = 'sent') AS sent,
      count(*) FILTER (WHERE activity_type = 'opened') AS opened,
      count(*) FILTER (WHERE activity_type = 'clicked') AS clicked,
      count(*) FILTER (WHERE activity_type = 'replied') AS replied,
      count(*) FILTER (WHERE activity_type = 'bounced') AS bounced
    FROM campaign_activities
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) acts ON acts.campaign_id = ids.id;
$$ LANGUAGE sql STABLE;
