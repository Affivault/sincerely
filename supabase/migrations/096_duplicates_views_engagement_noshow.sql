-- 096: Duplicate contacts and merging, saved contact views, bulk custom
-- fields, an engagement score per contact, and no-show follow-ups.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- Every function here is for the server alone (EXECUTE is revoked from
-- PUBLIC, anon and authenticated at the end), and every statement inside one
-- is scoped by p_user_id, because the server calls them with the service
-- role and nothing else would stop one account reaching another's rows.
-- The new tables have row level security switched on and no policies, for
-- the same reason as 084: the browser never reads them directly.


-- ---------------------------------------------------------------------------
-- 1. Engagement score columns on contacts
-- ---------------------------------------------------------------------------
--
-- The score itself is computed by the server (services/engagement), from the
-- one definition in shared/src/engagement.ts, and written back here so the
-- contacts list can sort by it. engagement_factors is the small breakdown
-- the score came from, kept so a list row can explain itself without the
-- server recounting a contact's history.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_score integer;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_factors jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_engagement_score_range') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_engagement_score_range
      CHECK (engagement_score IS NULL OR (engagement_score >= 0 AND engagement_score <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_user_engagement
  ON contacts (user_id, engagement_score DESC NULLS LAST);

-- A rescore must not look like an edit. contacts.updated_at is what the
-- merge screen uses to decide which value is newest, and a job that rewrote
-- every active contact's score every few hours would make all of them
-- "edited just now". So the timestamp trigger now skips an update that
-- changed nothing but the engagement columns; any other update, including a
-- no-op one, still stamps updated_at exactly as before.
DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  WHEN (
    (to_jsonb(OLD) - ARRAY['engagement_score', 'engagement_factors', 'engagement_updated_at', 'updated_at'])
      IS DISTINCT FROM
    (to_jsonb(NEW) - ARRAY['engagement_score', 'engagement_factors', 'engagement_updated_at', 'updated_at'])
    OR (
      OLD.engagement_score IS NOT DISTINCT FROM NEW.engagement_score
      AND OLD.engagement_factors IS NOT DISTINCT FROM NEW.engagement_factors
      AND OLD.engagement_updated_at IS NOT DISTINCT FROM NEW.engagement_updated_at
    )
  )
  EXECUTE FUNCTION update_updated_at();


-- ---------------------------------------------------------------------------
-- 2. Saved views on the contacts and leads pages
-- ---------------------------------------------------------------------------
--
-- A named set of filters, search and tab. Per user and per page, because the
-- leads page and the contacts page are set up for different work.

CREATE TABLE IF NOT EXISTS contact_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page text NOT NULL DEFAULT 'contact',
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_saved_views_page_known CHECK (page IN ('lead', 'contact')),
  CONSTRAINT contact_saved_views_name_sane CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT contact_saved_views_config_object CHECK (jsonb_typeof(config) = 'object')
);

-- One "Hot in London" per page, whatever the capitals.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_saved_views_name
  ON contact_saved_views (user_id, page, lower(btrim(name)));

ALTER TABLE contact_saved_views ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 3. "These are not the same person"
-- ---------------------------------------------------------------------------
--
-- A group the user has looked at and said is not a duplicate. Keyed by the
-- sorted ids of the group, so the same people stop being offered, but a new
-- third contact joining them makes a new group that is offered again.

CREATE TABLE IF NOT EXISTS contact_duplicate_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_key),
  CONSTRAINT contact_duplicate_dismissals_key_sane CHECK (length(group_key) BETWEEN 1 AND 4000)
);

ALTER TABLE contact_duplicate_dismissals ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 4. No-shows
-- ---------------------------------------------------------------------------
--
-- 'no_show' is a status of its own rather than free text in outcome, so it
-- can be counted, filtered and acted on. The constraint from 062 is widened
-- rather than dropped, so anything else is still refused.

ALTER TABLE crm_events DROP CONSTRAINT IF EXISTS crm_events_status_known;
ALTER TABLE crm_events ADD CONSTRAINT crm_events_status_known
  CHECK (status IN ('confirmed', 'cancelled', 'tentative', 'no_show'));

ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS no_show_at timestamptz;
-- Claimed before the email is sent, so two clicks (or an auto-send racing a
-- click) send one email, not two.
ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS no_show_followup_sent_at timestamptz;

-- Off by default: an email that goes out on its own, in the account's name,
-- is not something to switch on for somebody. The app offers to send instead.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS no_show_auto_send boolean NOT NULL DEFAULT false;
-- NULL means "use the built-in wording" (shared/src/no-show.ts), so the
-- default can be improved later without overwriting anyone's own words.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS no_show_subject text;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS no_show_body text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_no_show_template_sane') THEN
    ALTER TABLE user_settings ADD CONSTRAINT user_settings_no_show_template_sane
      CHECK ((no_show_subject IS NULL OR length(no_show_subject) <= 200)
         AND (no_show_body IS NULL OR length(no_show_body) <= 5000));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 5. Matching keys for duplicate detection
-- ---------------------------------------------------------------------------
--
-- These must agree with matchEmail / matchLinkedin in
-- shared/src/contact-hygiene.ts, which the merge screen uses to explain a
-- match. An address is compared ignoring case and any +tag, and for Gmail
-- also ignoring dots (Gmail delivers ada.l+x@gmail.com to adal@gmail.com).
-- Plus tags are dropped for every domain: nearly every business mail host
-- treats them as the same mailbox, and this only ever suggests a merge.

CREATE OR REPLACE FUNCTION contact_match_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(btrim(coalesce(p_email, '')));
  v_at integer;
  v_local text;
  v_domain text;
BEGIN
  v_at := strpos(reverse(v), '@');
  IF v = '' OR v_at = 0 THEN
    RETURN NULL;
  END IF;
  v_local := left(v, length(v) - v_at);
  v_domain := right(v, v_at - 1);
  IF v_domain = 'googlemail.com' THEN
    v_domain := 'gmail.com';
  END IF;
  v_local := split_part(v_local, '+', 1);
  IF v_domain = 'gmail.com' THEN
    v_local := replace(v_local, '.', '');
  END IF;
  IF v_local = '' OR v_domain = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_local || '@' || v_domain;
END;
$$;

-- linkedin.com/in/ada-lovelace, however it was pasted: with or without the
-- scheme, www or a country subdomain, a trailing slash or a tracking query.
CREATE OR REPLACE FUNCTION contact_match_linkedin(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(btrim(coalesce(p_url, '')));
  v_slug text;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');
  v := regexp_replace(v, '[?#].*$', '');
  v := regexp_replace(v, '/+$', '');
  v_slug := substring(v FROM '(?:^|\.)linkedin\.com/(?:in|pub)/([^/]+)');
  IF v_slug IS NOT NULL AND v_slug <> '' THEN
    RETURN 'in/' || v_slug;
  END IF;
  -- Not a profile address. Still comparable to itself, but only once it is
  -- recognisably a LinkedIn one: two contacts with "n/a" are not a match.
  IF v ~ '(^|\.)linkedin\.com/.+' THEN
    RETURN regexp_replace(v, '^([a-z]{2,3}\.|www\.)', '');
  END IF;
  RETURN NULL;
END;
$$;


-- ---------------------------------------------------------------------------
-- 6. find_contact_duplicates
-- ---------------------------------------------------------------------------
--
-- Groups of an account's contacts that are probably the same person, by
-- four rules: the same address (see above), the same LinkedIn profile, or
-- the same first and last name at the same company name or the same company
-- domain. Each row is one rule's group; a contact can be in more than one,
-- and the server joins overlapping groups into clusters.
--
-- p_free_domains is the consumer-mail list from shared/src/free-mail.ts,
-- passed in so it is defined once: two Ada Lovelaces at gmail.com are not
-- evidence of anything. Groups larger than 25 are left out, because a rule
-- that matches that many people has matched a placeholder, not a person.

CREATE OR REPLACE FUNCTION find_contact_duplicates(
  p_user_id uuid,
  p_contact_id uuid DEFAULT NULL,
  p_free_domains text[] DEFAULT '{}'::text[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE (reason text, match_key text, contact_ids uuid[])
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      c.id,
      contact_match_email(c.email) AS em,
      contact_match_linkedin(c.linkedin_url) AS li,
      CASE
        WHEN btrim(coalesce(c.first_name, '')) <> '' AND btrim(coalesce(c.last_name, '')) <> ''
        THEN lower(btrim(c.first_name)) || ' ' || lower(btrim(c.last_name))
      END AS nm,
      nullif(regexp_replace(lower(coalesce(c.company, '')), '[^a-z0-9]+', '', 'g'), '') AS co,
      coalesce(
        nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(c.website, ''))),
          '^[a-z][a-z0-9+.-]*://', ''), '^www\.', ''), '[/?#:].*$', ''), ''),
        CASE
          WHEN split_part(lower(c.email), '@', 2) <> ''
           AND NOT (split_part(lower(c.email), '@', 2) = ANY (coalesce(p_free_domains, '{}'::text[])))
          THEN split_part(lower(c.email), '@', 2)
        END
      ) AS dom
    FROM contacts c
    WHERE c.user_id = p_user_id
      AND c.email NOT LIKE '%@reply-check.invalid'
  ),
  keyed AS (
    SELECT id, 'email'::text AS reason, em AS k FROM base WHERE em IS NOT NULL
    UNION ALL
    SELECT id, 'linkedin', li FROM base WHERE li IS NOT NULL
    UNION ALL
    SELECT id, 'name_company', nm || ' @ ' || co FROM base WHERE nm IS NOT NULL AND co IS NOT NULL
    UNION ALL
    SELECT id, 'name_domain', nm || ' @ ' || dom FROM base
     WHERE nm IS NOT NULL AND dom IS NOT NULL
       AND NOT (dom = ANY (coalesce(p_free_domains, '{}'::text[])))
  ),
  grouped AS (
    SELECT keyed.reason, keyed.k, array_agg(DISTINCT keyed.id) AS ids
    FROM keyed
    GROUP BY keyed.reason, keyed.k
    HAVING count(DISTINCT keyed.id) BETWEEN 2 AND 25
  )
  SELECT g.reason, g.k, g.ids
  FROM grouped g
  WHERE p_contact_id IS NULL OR p_contact_id = ANY (g.ids)
  ORDER BY cardinality(g.ids) DESC, g.reason, g.k
  LIMIT greatest(1, least(coalesce(p_limit, 200), 2000));
$$;


-- ---------------------------------------------------------------------------
-- 7. merge_contacts
-- ---------------------------------------------------------------------------
--
-- Folds p_other_ids into p_primary_id, in one transaction, so a failure part
-- way leaves nothing half-moved: either every related row now belongs to the
-- primary and the others are gone, or nothing changed at all.
--
-- p_fields carries the values the user chose for the primary (only the keys
-- listed below are read). Everything else is decided here:
--   lifecycle        the best of them: customer > contact > prospect
--   engaged_at       the earliest
--   created_at       the earliest, so "added" means when we first had them
--   is_unsubscribed  true if any of them was: an opt-out is never merged away
--   is_bounced       likewise
--   tags, lists      the union
--   enrolments       one per campaign: when two of them are in the same
--                    campaign, the most advanced enrolment is kept (replied,
--                    then completed, then a stopping status, then live, then
--                    the furthest step) and the other's activity moves onto it
--   open leads       one: the primary's, else the newest; others are archived
--   everything else  moved to the primary as it is
--
-- Any other table that references contacts (one added after this was
-- written) has its rows moved too, by the generic sweep near the end, so a
-- new table cannot quietly lose its rows to the cascade.

CREATE OR REPLACE FUNCTION merge_contacts(
  p_user_id uuid,
  p_primary_id uuid,
  p_other_ids uuid[],
  p_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_others uuid[];
  v_all uuid[];
  v_found integer;
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_collapsed integer := 0;
  v_email text;
  v_emails text;
  v_lifecycle text;
  v_engaged timestamptz;
  v_created timestamptz;
  v_unsub boolean;
  v_bounced boolean;
  v_custom jsonb;
  v_company_id uuid;
  v_src contacts%ROWTYPE;
  v_primary contacts%ROWTYPE;
  r record;
  fk record;
BEGIN
  IF p_user_id IS NULL OR p_primary_id IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: p_user_id and p_primary_id are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_fields) <> 'object' THEN
    RAISE EXCEPTION 'merge_contacts: p_fields must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_others
  FROM unnest(coalesce(p_other_ids, '{}'::uuid[])) AS x
  WHERE x IS NOT NULL AND x <> p_primary_id;

  IF v_others IS NULL OR cardinality(v_others) = 0 THEN
    RAISE EXCEPTION 'merge_contacts: nothing to merge' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_others) > 20 THEN
    RAISE EXCEPTION 'merge_contacts: at most 20 contacts at a time' USING ERRCODE = '22023';
  END IF;
  v_all := v_others || p_primary_id;

  -- Lock every row being merged, in a fixed order so two merges touching
  -- the same people cannot deadlock, then prove they are all this account's.
  PERFORM 1 FROM contacts
   WHERE user_id = p_user_id AND id = ANY (v_all)
   ORDER BY id
   FOR UPDATE;
  SELECT count(*) INTO v_found FROM contacts WHERE user_id = p_user_id AND id = ANY (v_all);
  IF v_found <> cardinality(v_all) THEN
    RAISE EXCEPTION 'merge_contacts: contact not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_primary FROM contacts WHERE user_id = p_user_id AND id = p_primary_id;

  -- What the merged contact will be, read before the others are deleted.
  SELECT
    CASE max(CASE lifecycle WHEN 'customer' THEN 3 WHEN 'contact' THEN 2 ELSE 1 END)
      WHEN 3 THEN 'customer' WHEN 2 THEN 'contact' ELSE 'prospect' END,
    min(engaged_at),
    min(created_at),
    bool_or(is_unsubscribed),
    bool_or(is_bounced),
    string_agg(email, ', ' ORDER BY email) FILTER (WHERE id <> p_primary_id)
  INTO v_lifecycle, v_engaged, v_created, v_unsub, v_bounced, v_emails
  FROM contacts
  WHERE user_id = p_user_id AND id = ANY (v_all);

  -- Custom fields: the union, with the primary's own values winning, unless
  -- the caller chose the whole set.
  IF v_fields ? 'custom_fields' AND jsonb_typeof(v_fields -> 'custom_fields') = 'object' THEN
    v_custom := v_fields -> 'custom_fields';
  ELSE
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_custom
    FROM (
      SELECT DISTINCT ON (kv.key) kv.key, kv.value
      FROM contacts c, jsonb_each(coalesce(c.custom_fields, '{}'::jsonb)) AS kv
      WHERE c.user_id = p_user_id AND c.id = ANY (v_all)
        AND kv.value IS NOT NULL AND kv.value <> 'null'::jsonb AND kv.value <> '""'::jsonb
      ORDER BY kv.key, (c.id = p_primary_id) DESC, c.updated_at DESC
    ) e;
  END IF;

  -- The address, if the caller picked one, must be one of these contacts'
  -- own: anything else could collide with somebody outside the merge.
  v_email := v_primary.email;
  IF v_fields ? 'email' THEN
    v_email := lower(btrim(coalesce(v_fields ->> 'email', '')));
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE user_id = p_user_id AND id = ANY (v_all) AND email = v_email) THEN
      RAISE EXCEPTION 'merge_contacts: the address must be one of the merged contacts''' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO v_src FROM contacts WHERE user_id = p_user_id AND id = ANY (v_all) AND email = v_email LIMIT 1;

  v_company_id := v_primary.company_id;
  IF v_fields ? 'company_id' THEN
    v_company_id := nullif(v_fields ->> 'company_id', '')::uuid;
    IF v_company_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM companies WHERE id = v_company_id AND user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'merge_contacts: company not found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id FROM contacts
     WHERE user_id = p_user_id AND id = ANY (v_others) AND company_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  -- -- Campaign enrolments: one per campaign ---------------------------------
  FOR r IN
    WITH ranked AS (
      SELECT cc.id, cc.campaign_id,
        row_number() OVER (
          PARTITION BY cc.campaign_id
          ORDER BY
            CASE cc.status
              WHEN 'replied' THEN 9
              WHEN 'completed' THEN 8
              WHEN 'unsubscribed' THEN 7
              WHEN 'bounced' THEN 7
              WHEN 'suppressed' THEN 7
              WHEN 'auto_reply' THEN 6
              WHEN 'active' THEN 5
              WHEN 'paused' THEN 4
              WHEN 'pending' THEN 3
              WHEN 'error' THEN 1
              ELSE 0
            END DESC,
            cc.current_step_order DESC,
            (cc.contact_id = p_primary_id) DESC,
            cc.created_at ASC,
            cc.id
        ) AS rn
      FROM campaign_contacts cc
      JOIN campaigns c ON c.id = cc.campaign_id AND c.user_id = p_user_id
      WHERE cc.contact_id = ANY (v_all)
    )
    SELECT l.id AS loser_id, w.id AS winner_id, l.campaign_id
    FROM ranked l
    JOIN ranked w ON w.campaign_id = l.campaign_id AND w.rn = 1
    WHERE l.rn > 1
  LOOP
    -- Opens and clicks are de-duplicated per enrolment and step (049, 085).
    -- The kept enrolment already counting one wins; the copy is dropped.
    DELETE FROM campaign_activities a
     WHERE a.campaign_contact_id = r.loser_id
       AND a.campaign_id = r.campaign_id
       AND a.activity_type IN ('opened', 'clicked', 'machine_open', 'machine_click')
       AND EXISTS (
         SELECT 1 FROM campaign_activities b
          WHERE b.campaign_contact_id = r.winner_id
            AND b.step_id = a.step_id
            AND b.activity_type = a.activity_type
       );
    UPDATE campaign_activities
       SET campaign_contact_id = r.winner_id, contact_id = p_primary_id
     WHERE campaign_contact_id = r.loser_id
       AND campaign_id = r.campaign_id;
    UPDATE inbox_messages SET campaign_contact_id = r.winner_id
     WHERE user_id = p_user_id AND campaign_contact_id = r.loser_id;
    UPDATE crm_tasks SET campaign_contact_id = r.winner_id
     WHERE user_id = p_user_id AND campaign_contact_id = r.loser_id;
    DELETE FROM campaign_contacts cc
     USING campaigns c
     WHERE cc.id = r.loser_id AND c.id = cc.campaign_id AND c.user_id = p_user_id;
    v_collapsed := v_collapsed + 1;
  END LOOP;

  UPDATE campaign_contacts cc SET contact_id = p_primary_id
    FROM campaigns c
   WHERE cc.contact_id = ANY (v_others) AND c.id = cc.campaign_id AND c.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('campaign_contacts', v_n, 'enrolments_collapsed', v_collapsed);

  UPDATE campaign_activities a SET contact_id = p_primary_id
    FROM campaigns c
   WHERE a.contact_id = ANY (v_others) AND c.id = a.campaign_id AND c.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('campaign_activities', v_n);

  -- -- Tags and list memberships: the union ----------------------------------
  INSERT INTO contact_tags (contact_id, tag_id)
  SELECT DISTINCT p_primary_id, ct.tag_id
    FROM contact_tags ct
    JOIN tags t ON t.id = ct.tag_id AND t.user_id = p_user_id
   WHERE ct.contact_id = ANY (v_others)
  ON CONFLICT DO NOTHING;
  DELETE FROM contact_tags ct
   USING contacts c
   WHERE ct.contact_id = ANY (v_others) AND c.id = ct.contact_id AND c.user_id = p_user_id;

  INSERT INTO list_contacts (list_id, contact_id, added_at)
  SELECT lc.list_id, p_primary_id, min(lc.added_at)
    FROM list_contacts lc
    JOIN contact_lists l ON l.id = lc.list_id AND l.user_id = p_user_id
   WHERE lc.contact_id = ANY (v_others)
   GROUP BY lc.list_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('list_memberships', v_n);
  DELETE FROM list_contacts lc
   USING contacts c
   WHERE lc.contact_id = ANY (v_others) AND c.id = lc.contact_id AND c.user_id = p_user_id;

  -- -- Deals --------------------------------------------------------------------
  UPDATE deals SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('deals', v_n);

  -- One row per person per deal (052): a duplicate already on the deal is
  -- the same person twice, so the copy goes.
  DELETE FROM deal_participants d
   WHERE d.user_id = p_user_id
     AND d.contact_id = ANY (v_others)
     AND EXISTS (
       SELECT 1 FROM deal_participants k
        WHERE k.user_id = p_user_id AND k.deal_id = d.deal_id
          AND (k.contact_id = p_primary_id
               OR (k.contact_id = ANY (v_others) AND k.id < d.id))
     );
  UPDATE deal_participants SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('deal_participants', v_n);

  -- -- Leads: one open lead per contact (054) -----------------------------------
  UPDATE leads SET status = 'archived', archived_at = now(),
         archived_reason = coalesce(archived_reason, 'Merged into another contact')
   WHERE user_id = p_user_id
     AND status = 'open'
     AND contact_id = ANY (v_all)
     AND id <> (
       SELECT k.id FROM leads k
        WHERE k.user_id = p_user_id AND k.status = 'open' AND k.contact_id = ANY (v_all)
        ORDER BY (k.contact_id = p_primary_id) DESC, k.created_at DESC, k.id
        LIMIT 1
     );
  UPDATE leads SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('leads', v_n);

  -- -- Booking page visits: one per link per contact per day (067) ------------
  DELETE FROM booking_link_visits v
   WHERE v.user_id = p_user_id
     AND v.contact_id = ANY (v_others)
     AND EXISTS (
       SELECT 1 FROM booking_link_visits k
        WHERE k.user_id = p_user_id
          AND k.link_id = v.link_id
          AND (k.created_at AT TIME ZONE 'UTC')::date = (v.created_at AT TIME ZONE 'UTC')::date
          AND (k.contact_id = p_primary_id
               OR (k.contact_id = ANY (v_others) AND k.id < v.id))
     );
  UPDATE booking_link_visits SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);

  -- -- Everything with a plain contact_id and the owner on the row --------------
  UPDATE inbox_messages SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('inbox_messages', v_n);

  UPDATE crm_tasks SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tasks', v_n);

  UPDATE crm_events SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('meetings', v_n);

  UPDATE crm_notes SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('notes', v_n);

  UPDATE signals SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  UPDATE linkedin_agent_log SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  UPDATE prospect_reveals SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);
  UPDATE prospect_credit_ledger SET contact_id = p_primary_id
   WHERE user_id = p_user_id AND contact_id = ANY (v_others);

  -- -- Anything else that points at a contact -----------------------------------
  -- A table added after this function was written. Its rows move rather
  -- than being cascaded away or orphaned; if it has a unique rule they
  -- would break, the whole merge fails and nothing has changed.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col,
           EXISTS (
             SELECT 1 FROM pg_attribute u
              WHERE u.attrelid = c.conrelid AND u.attname = 'user_id' AND NOT u.attisdropped
           ) AS has_user
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.contacts'::regclass
       AND cardinality(c.conkey) = 1
       AND c.conrelid::regclass::text NOT IN (
         'contact_tags', 'campaign_contacts', 'campaign_activities', 'inbox_messages',
         'list_contacts', 'deals', 'crm_tasks', 'crm_events', 'prospect_credit_ledger',
         'prospect_reveals', 'crm_notes', 'deal_participants', 'leads',
         'booking_link_visits', 'signals', 'linkedin_agent_log'
       )
  LOOP
    IF fk.has_user THEN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE user_id = $2 AND %I = ANY ($3)', fk.tbl, fk.col, fk.col)
        USING p_primary_id, p_user_id, v_others;
    ELSE
      -- No owner column: the ids were proven to be this account's above,
      -- so matching on them is already scoped to it.
      EXECUTE format(
        'UPDATE %s t SET %I = $1 WHERE t.%I = ANY ($3) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = t.%I AND c.user_id = $2)',
        fk.tbl, fk.col, fk.col, fk.col)
        USING p_primary_id, p_user_id, v_others;
    END IF;
  END LOOP;

  -- -- A line on the contact's history, then the others go --------------------
  INSERT INTO crm_notes (user_id, contact_id, body)
  VALUES (
    p_user_id, p_primary_id,
    'Merged ' || cardinality(v_others) || ' duplicate' || CASE WHEN cardinality(v_others) = 1 THEN '' ELSE 's' END
      || ' into this contact: ' || coalesce(v_emails, '')
  );

  DELETE FROM contacts WHERE user_id = p_user_id AND id = ANY (v_others);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- -- The primary, with the chosen and the combined values -------------------
  UPDATE contacts SET
    email          = v_email,
    first_name     = CASE WHEN v_fields ? 'first_name'   THEN nullif(btrim(v_fields ->> 'first_name'), '')   ELSE first_name END,
    last_name      = CASE WHEN v_fields ? 'last_name'    THEN nullif(btrim(v_fields ->> 'last_name'), '')    ELSE last_name END,
    company        = CASE WHEN v_fields ? 'company'      THEN nullif(btrim(v_fields ->> 'company'), '')      ELSE company END,
    job_title      = CASE WHEN v_fields ? 'job_title'    THEN nullif(btrim(v_fields ->> 'job_title'), '')    ELSE job_title END,
    phone          = CASE WHEN v_fields ? 'phone'        THEN nullif(btrim(v_fields ->> 'phone'), '')        ELSE phone END,
    linkedin_url   = CASE WHEN v_fields ? 'linkedin_url' THEN nullif(btrim(v_fields ->> 'linkedin_url'), '') ELSE linkedin_url END,
    website        = CASE WHEN v_fields ? 'website'      THEN nullif(btrim(v_fields ->> 'website'), '')      ELSE website END,
    location       = CASE WHEN v_fields ? 'location'     THEN nullif(btrim(v_fields ->> 'location'), '')     ELSE location END,
    company_id     = v_company_id,
    custom_fields  = coalesce(v_custom, '{}'::jsonb),
    lifecycle      = v_lifecycle,
    engaged_at     = CASE WHEN v_lifecycle = 'prospect' THEN engaged_at ELSE coalesce(v_engaged, engaged_at, now()) END,
    created_at     = least(created_at, v_created),
    is_unsubscribed = coalesce(v_unsub, is_unsubscribed),
    is_bounced     = coalesce(v_bounced, is_bounced),
    -- The verification belongs to the address, so it travels with it.
    dcs_score       = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_score       ELSE dcs_score END,
    dcs_syntax_ok   = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_syntax_ok   ELSE dcs_syntax_ok END,
    dcs_domain_ok   = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_domain_ok   ELSE dcs_domain_ok END,
    dcs_smtp_ok     = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_smtp_ok     ELSE dcs_smtp_ok END,
    dcs_verified_at = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_verified_at ELSE dcs_verified_at END,
    dcs_fail_reason = CASE WHEN v_src.id <> p_primary_id THEN v_src.dcs_fail_reason ELSE dcs_fail_reason END,
    -- Rescored by the server straight after; a stale number would mislead.
    engagement_score = NULL,
    engagement_factors = NULL,
    engagement_updated_at = NULL
  WHERE user_id = p_user_id AND id = p_primary_id;

  RETURN jsonb_build_object(
    'primary_id', p_primary_id,
    'merged', v_n,
    'moved', v_counts
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- 8. Writing scores, and setting one custom field on many contacts
-- ---------------------------------------------------------------------------

-- p_rows: [{ "id": uuid, "score": 0..100, "factors": {...} }]. One statement
-- for a whole batch, and only rows whose score or factors actually moved are
-- written, so a sweep over a quiet account writes nothing.
CREATE OR REPLACE FUNCTION set_engagement_scores(p_user_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;
  UPDATE contacts c
     SET engagement_score = s.score,
         engagement_factors = s.factors,
         engagement_updated_at = now()
    FROM (
      SELECT DISTINCT ON ((r ->> 'id'))
             (r ->> 'id')::uuid AS id,
             least(100, greatest(0, round((r ->> 'score')::numeric)))::integer AS score,
             CASE WHEN jsonb_typeof(r -> 'factors') = 'object' THEN r -> 'factors' END AS factors
        FROM jsonb_array_elements(p_rows) AS r
       WHERE jsonb_typeof(r) = 'object'
         AND (r ->> 'id') ~ '^[0-9a-fA-F-]{36}$'
         AND (r ->> 'score') ~ '^[0-9]+(\.[0-9]+)?$'
    ) s
   WHERE c.user_id = p_user_id
     AND c.id = s.id
     AND (c.engagement_score IS DISTINCT FROM s.score OR c.engagement_factors IS DISTINCT FROM s.factors);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Bulk edit of one custom field. PostgREST can only replace custom_fields
-- whole, which would mean reading and writing every row one by one; this is
-- one statement. A NULL value removes the field.
CREATE OR REPLACE FUNCTION contacts_set_custom_field(
  p_user_id uuid,
  p_contact_ids uuid[],
  p_key text,
  p_value text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_key IS NULL OR btrim(p_key) = '' OR length(p_key) > 64 THEN
    RAISE EXCEPTION 'contacts_set_custom_field: a field name is required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(coalesce(p_contact_ids, '{}'::uuid[])) > 5000 THEN
    RAISE EXCEPTION 'contacts_set_custom_field: at most 5000 contacts at a time' USING ERRCODE = '22023';
  END IF;
  UPDATE contacts
     SET custom_fields = CASE
           WHEN p_value IS NULL THEN coalesce(custom_fields, '{}'::jsonb) - p_key
           ELSE coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
         END
   WHERE user_id = p_user_id
     AND id = ANY (coalesce(p_contact_ids, '{}'::uuid[]));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;


-- ---------------------------------------------------------------------------
-- 9. For the server alone
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'contact_match_email(text)',
    'contact_match_linkedin(text)',
    'find_contact_duplicates(uuid, uuid, text[], integer)',
    'merge_contacts(uuid, uuid, uuid[], jsonb)',
    'set_engagement_scores(uuid, jsonb)',
    'contacts_set_custom_field(uuid, uuid[], text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;
END $$;
