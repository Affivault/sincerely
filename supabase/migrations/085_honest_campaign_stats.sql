-- 085: Honest campaign stats
-- Run this in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- 1. get_campaigns_stats counted reply MESSAGES, so a prospect who wrote
--    back twice was two replies and the reply rate could pass the number of
--    people ever emailed. Opened, clicked, replied and bounced are now the
--    number of distinct enrolments (campaign_contact_id) with at least one
--    such activity, which is what the funnel and step views already showed.
--    Three columns are added for honest denominators and progress:
--      contacts_reached   - enrolments with at least one 'sent' row
--                           (the denominator for open/click/reply rates)
--      contacts_attempted - enrolments with a 'sent' or a 'bounced' row
--                           (the bounce-rate denominator, so a refusal at
--                           send time, which has no 'sent' row, counts)
--      paused_contacts    - enrolments with status 'paused'
--    sent_count stays the number of emails sent. Every existing column keeps
--    its name and position; the new ones are appended. Dropped and recreated
--    because Postgres will not CREATE OR REPLACE a function whose return
--    type changes.
--
-- 2. get_engagement_summary(user, since, until) gives the dashboard a
--    cohort: the enrolments sent to in the window, and how many of THOSE
--    opened / clicked / replied within the same window. Dividing this
--    period's opens by this period's sends counted opens of last month's
--    emails against this week's sends and produced open rates over 100%.
--
-- 3. Machine traffic. Mail scanners (Safe Links, Mimecast, Proofpoint...)
--    and Apple Mail Privacy Protection fetch the pixel and the links before
--    the person does. The server now records those hits as 'machine_open' /
--    'machine_click' instead of 'opened' / 'clicked', so they never count
--    and never take the one-per-(contact, step) slot a real open needs.
--    record_tracking_event is replaced (same signature) with a conflict
--    clause that covers both dedup indexes, and a second partial unique
--    index keeps a scanner from writing a row per hit.

-- ---------------------------------------------------------------------------
-- 1. get_campaigns_stats
-- ---------------------------------------------------------------------------
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
  error_contacts        bigint,
  contacts_reached      bigint,
  contacts_attempted    bigint,
  paused_contacts       bigint
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
    COALESCE(contacts.error, 0)                   AS error_contacts,
    COALESCE(acts.reached, 0)                     AS contacts_reached,
    COALESCE(acts.attempted, 0)                   AS contacts_attempted,
    COALESCE(contacts.paused, 0)                  AS paused_contacts
  FROM unnest(p_campaign_ids) AS ids(id)

  LEFT JOIN (
    SELECT
      s.campaign_id,
      count(*) AS cnt
    FROM campaign_steps s
    WHERE s.campaign_id = ANY(p_campaign_ids)
    GROUP BY s.campaign_id
  ) steps ON steps.campaign_id = ids.id

  LEFT JOIN (
    SELECT
      cc.campaign_id,
      count(*)                                              AS total,
      count(*) FILTER (WHERE cc.status = 'active')          AS active,
      count(*) FILTER (WHERE cc.status = 'completed')       AS completed,
      count(*) FILTER (WHERE cc.status = 'replied')         AS replied,
      count(*) FILTER (WHERE cc.status = 'bounced')         AS bounced,
      count(*) FILTER (WHERE cc.status = 'unsubscribed')    AS unsubscribed,
      count(*) FILTER (WHERE cc.status = 'suppressed')      AS suppressed,
      count(*) FILTER (WHERE cc.status = 'error')           AS error,
      count(*) FILTER (WHERE cc.status = 'paused')          AS paused
    FROM campaign_contacts cc
    WHERE cc.campaign_id = ANY(p_campaign_ids)
    GROUP BY cc.campaign_id
  ) contacts ON contacts.campaign_id = ids.id

  LEFT JOIN (
    SELECT
      per.campaign_id,
      sum(per.sent_msgs)                                    AS sent,
      count(*) FILTER (WHERE per.sent_msgs > 0)             AS reached,
      count(*) FILTER (WHERE per.sent_msgs > 0 OR per.bounced) AS attempted,
      count(*) FILTER (WHERE per.opened)                    AS opened,
      count(*) FILTER (WHERE per.clicked)                   AS clicked,
      -- Auto-replies carry activity_type 'auto_reply' (migration 043), so
      -- they are excluded here by construction.
      count(*) FILTER (WHERE per.replied)                   AS replied,
      count(*) FILTER (WHERE per.bounced)                   AS bounced
    FROM (
      SELECT
        a.campaign_id,
        a.campaign_contact_id,
        count(*) FILTER (WHERE a.activity_type = 'sent')    AS sent_msgs,
        bool_or(a.activity_type = 'opened')                 AS opened,
        bool_or(a.activity_type = 'clicked')                AS clicked,
        bool_or(a.activity_type = 'replied')                AS replied,
        bool_or(a.activity_type = 'bounced')                AS bounced
      FROM campaign_activities a
      WHERE a.campaign_id = ANY(p_campaign_ids)
        AND a.activity_type IN ('sent', 'opened', 'clicked', 'replied', 'bounced')
      GROUP BY a.campaign_id, a.campaign_contact_id
    ) per
    GROUP BY per.campaign_id
  ) acts ON acts.campaign_id = ids.id;
$function$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION get_campaigns_stats(uuid[]) FROM PUBLIC;
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION get_campaigns_stats(uuid[]) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION get_campaigns_stats(uuid[]) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. get_engagement_summary
-- ---------------------------------------------------------------------------
-- The cohort is every enrolment of this account's campaigns with a 'sent'
-- row in [p_since, p_until). Engagement counts only for those enrolments and
-- only inside the same window, so the rate can never pass 100% and the
-- previous period is not flattered by having had longer to mature.
-- NULL p_since means from the beginning; NULL p_until means up to now.
CREATE OR REPLACE FUNCTION get_engagement_summary(
  p_user_id uuid,
  p_since   timestamptz DEFAULT NULL,
  p_until   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  sent_messages    bigint,
  contacts_sent    bigint,
  contacts_opened  bigint,
  contacts_clicked bigint,
  contacts_replied bigint
) AS $function$
  WITH acts AS (
    SELECT a.campaign_contact_id, a.activity_type
    FROM campaign_activities a
    JOIN campaigns c ON c.id = a.campaign_id
    WHERE c.user_id = p_user_id
      AND a.activity_type IN ('sent', 'opened', 'clicked', 'replied')
      AND (p_since IS NULL OR a.occurred_at >= p_since)
      AND (p_until IS NULL OR a.occurred_at < p_until)
  ),
  per AS (
    SELECT
      campaign_contact_id,
      count(*) FILTER (WHERE activity_type = 'sent') AS sent_msgs,
      bool_or(activity_type = 'opened')              AS opened,
      bool_or(activity_type = 'clicked')             AS clicked,
      bool_or(activity_type = 'replied')             AS replied
    FROM acts
    GROUP BY campaign_contact_id
  )
  SELECT
    COALESCE(sum(sent_msgs), 0)::bigint                        AS sent_messages,
    count(*) FILTER (WHERE sent_msgs > 0)::bigint              AS contacts_sent,
    count(*) FILTER (WHERE sent_msgs > 0 AND opened)::bigint   AS contacts_opened,
    count(*) FILTER (WHERE sent_msgs > 0 AND clicked)::bigint  AS contacts_clicked,
    count(*) FILTER (WHERE sent_msgs > 0 AND replied)::bigint  AS contacts_replied
  FROM per;
$function$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION get_engagement_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION get_engagement_summary(uuid, timestamptz, timestamptz) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION get_engagement_summary(uuid, timestamptz, timestamptz) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Machine opens and clicks: one row per (contact, step, type)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_activities_machine_dedup
  ON campaign_activities (campaign_contact_id, step_id, activity_type)
  WHERE activity_type IN ('machine_open', 'machine_click');

-- Same signature and result as migration 049. The conflict clause no longer
-- names one index, so a duplicate on either dedup index (human or machine)
-- is ignored rather than raised.
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
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION record_tracking_event(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION record_tracking_event(uuid, uuid, uuid, uuid, text, jsonb) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION record_tracking_event(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;
  END IF;
END $$;
