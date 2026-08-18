-- ============================================================================
-- 044: A reply is its own outcome.
--
-- ContactCampaignStatus.Replied has been in the enum since the beginning and
-- nothing has ever set it. When someone replied and stop_on_reply was on, the
-- engine marked them 'completed' -- indistinguishable from a contact who sat
-- through all five steps in silence. The single most valuable segment in cold
-- email, the people who answered, could not be told apart from the people who
-- ignored you, and the campaign's contact filter had no option for it because
-- there was nothing to filter.
--
-- Worse, it only happened when their *next* step came due. A contact replying
-- after step two of a sequence whose step three waits five days stayed
-- 'active' for those five days: shown as still being worked, blocking the
-- campaign from auto-completing, and occupying a slot in the 50-row batch the
-- sequence worker pulls each tick, crowding out contacts genuinely due.
--
-- Run migration 043 BEFORE this one. The backfill below relies on 043 having
-- given auto-replies their own activity type, so a fortnight of annual leave
-- is not backfilled as a reply.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Index campaign_activities by the contact it belongs to.
--
-- This is missing, and it is on the hottest path in the product. The sequence
-- engine filters campaign_activities by campaign_contact_id four times --
-- twice on every single send, to check whether the contact already replied
-- and whether this exact step was already sent. Neither had an index to use,
-- leaving only activity_type, which barely narrows anything.
--
-- It is created first so the backfill below uses it too.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaign_activities_contact_type
  ON campaign_activities (campaign_contact_id, activity_type);

-- ----------------------------------------------------------------------------
-- 2. Backfill.
--
-- Contacts marked 'completed' who have a real reply recorded are the people
-- this status was always meant for. Auto-replies carry activity_type
-- 'auto_reply' after migration 043 and so are excluded here by construction.
-- ----------------------------------------------------------------------------
UPDATE campaign_contacts cc
SET status = 'replied'
WHERE cc.status = 'completed'
  AND EXISTS (
    SELECT 1
    FROM campaign_activities a
    WHERE a.campaign_contact_id = cc.id
      AND a.activity_type = 'replied'
  );

-- ----------------------------------------------------------------------------
-- 3. Stop everything else that is mid-flight for a person who has answered.
--
-- Opt-in. Turning it on changes when live campaigns stop, which is not a
-- decision to make on someone's behalf.
-- ----------------------------------------------------------------------------
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS stop_all_campaigns_on_reply boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 4. Campaign page indexes.
--
-- The campaign page counts and filters by the new status, and the
-- cross-campaign stop looks up every live enrolment for one contact.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact_active
  ON campaign_contacts (contact_id)
  WHERE status IN ('pending', 'active');

-- ----------------------------------------------------------------------------
-- 5. The campaign stats function has to learn the status too.
--
-- Without this, the contact-progress bar on a campaign counts every replied
-- contact as "Pending" -- it derives pending as the total minus the statuses
-- it knows, so the best outcome a campaign can produce would display as not
-- yet started.
--
-- Dropped and recreated rather than CREATE OR REPLACE, because the return
-- type gains a column and Postgres will not replace a function whose
-- signature changed.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_campaigns_stats(uuid[]);

CREATE FUNCTION get_campaigns_stats(p_campaign_ids uuid[])
RETURNS TABLE (
  campaign_id           uuid,
  steps_count           bigint,
  contacts_count        bigint,
  sent_count            bigint,
  opened_count          bigint,
  clicked_count         bigint,
  replied_count         bigint,
  bounced_count         bigint,
  active_contacts       bigint,
  completed_contacts    bigint,
  replied_contacts      bigint,
  bounced_contacts      bigint,
  unsubscribed_contacts bigint,
  suppressed_contacts   bigint,
  error_contacts        bigint
) AS $function$
  SELECT
    ids.id                                        AS campaign_id,
    COALESCE(steps.cnt, 0)                        AS steps_count,
    COALESCE(contacts.total, 0)                   AS contacts_count,
    COALESCE(acts.sent, 0)                        AS sent_count,
    COALESCE(acts.opened, 0)                      AS opened_count,
    COALESCE(acts.clicked, 0)                     AS clicked_count,
    COALESCE(acts.replied, 0)                     AS replied_count,
    COALESCE(acts.bounced, 0)                     AS bounced_count,
    COALESCE(contacts.active, 0)                  AS active_contacts,
    COALESCE(contacts.completed, 0)               AS completed_contacts,
    COALESCE(contacts.replied, 0)                 AS replied_contacts,
    COALESCE(contacts.bounced, 0)                 AS bounced_contacts,
    COALESCE(contacts.unsubscribed, 0)            AS unsubscribed_contacts,
    COALESCE(contacts.suppressed, 0)              AS suppressed_contacts,
    COALESCE(contacts.error, 0)                   AS error_contacts
  FROM unnest(p_campaign_ids) AS ids(id)

  LEFT JOIN (
    SELECT
      campaign_id,
      count(*) AS cnt
    FROM campaign_steps
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) steps ON steps.campaign_id = ids.id

  LEFT JOIN (
    SELECT
      campaign_id,
      count(*)                                              AS total,
      count(*) FILTER (WHERE status = 'active')             AS active,
      count(*) FILTER (WHERE status = 'completed')          AS completed,
      count(*) FILTER (WHERE status = 'replied')            AS replied,
      count(*) FILTER (WHERE status = 'bounced')            AS bounced,
      count(*) FILTER (WHERE status = 'unsubscribed')       AS unsubscribed,
      count(*) FILTER (WHERE status = 'suppressed')         AS suppressed,
      count(*) FILTER (WHERE status = 'error')              AS error
    FROM campaign_contacts
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) contacts ON contacts.campaign_id = ids.id

  LEFT JOIN (
    SELECT
      campaign_id,
      count(*) FILTER (WHERE activity_type = 'sent')        AS sent,
      count(*) FILTER (WHERE activity_type = 'opened')      AS opened,
      count(*) FILTER (WHERE activity_type = 'clicked')     AS clicked,
      -- Auto-replies carry activity_type 'auto_reply' after migration 043, so
      -- they are excluded from the reply rate by construction rather than by
      -- every caller remembering to exclude them.
      count(*) FILTER (WHERE activity_type = 'replied')     AS replied,
      count(*) FILTER (WHERE activity_type = 'bounced')     AS bounced
    FROM campaign_activities
    WHERE campaign_id = ANY(p_campaign_ids)
    GROUP BY campaign_id
  ) acts ON acts.campaign_id = ids.id;
$function$ LANGUAGE sql STABLE;
