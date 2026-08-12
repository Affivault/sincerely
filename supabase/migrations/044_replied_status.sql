-- 044: A reply is its own outcome.
--
-- ContactCampaignStatus.Replied has been in the enum since the beginning and
-- nothing has ever set it. When someone replied and stop_on_reply was on, the
-- engine marked them 'completed' — indistinguishable from a contact who sat
-- through all five steps in silence. The single most valuable segment in cold
-- email, the people who answered, could not be told from the people who
-- ignored you, and the campaign's contact filter had no option for it because
-- there was nothing to filter.
--
-- Worse, it only happened when their *next* step came due. A contact replying
-- after step two of a sequence whose step three waits five days stayed 'active'
-- for those five days: shown as still being worked, blocking the campaign from
-- auto-completing, and occupying a slot in the 50-row batch the sequence worker
-- pulls each tick, crowding out contacts genuinely due.

-- Backfill: contacts marked 'completed' who have a real reply recorded were
-- the people this status was meant for. Auto-replies are excluded — migration
-- 043 gave those their own activity type precisely so they would not count.
UPDATE campaign_contacts cc
SET status = 'replied'
WHERE cc.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM campaign_activities a
    WHERE a.campaign_contact_id = cc.id
      AND a.activity_type = 'replied'
  );

-- Stop everything else that is mid-flight for a person who has answered.
-- Opt-in: turning it on changes when live campaigns stop, which is not a
-- decision to make on someone's behalf.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS stop_all_campaigns_on_reply boolean NOT NULL DEFAULT false;

-- The campaign page counts and filters by this status, and the cross-campaign
-- stop looks up every live enrolment for one contact.
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact_active
  ON campaign_contacts (contact_id)
  WHERE status IN ('pending', 'active');

-- ─────────────────────────────────────────────────────────────────────────
-- The campaign stats RPC has to learn the status too.
--
-- Without this, the contact-progress bar on a campaign counts every replied
-- contact as "Pending" — it derives pending as total minus the statuses it
-- knows, so the best outcome a campaign can produce would show as not yet
-- started. Dropped rather than replaced because the return type changes.
DROP FUNCTION IF EXISTS get_campaigns_stats(uuid[]);

CREATE FUNCTION get_campaigns_stats(p_campaign_ids uuid[])
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
  replied_contacts bigint,
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
    COALESCE(contacts.replied, 0) AS replied_contacts,
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
      count(*) FILTER (WHERE status = 'replied') AS replied,
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
      -- Auto-replies have their own activity type (migration 043) and are
      -- excluded here by construction, not by remembering to exclude them.
      count(*) FILTER (WHERE activity_type = 'replied') AS replied,
      count(*) FILTER (WHERE activity_type = 'bounced') AS bounced
    FROM campaign_activities
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) acts ON acts.campaign_id = ids.id;
$$ LANGUAGE sql STABLE;
