-- ============================================================================
-- 112 - Google Drive backup: every lead, contact, company and list, kept in
--       a spreadsheet in the customer's own Google Drive, about a minute
--       behind Sincerely.
--
-- 1. backup_connections: one per account. The Google connection (tokens
--    encrypted by the server), the spreadsheet it writes, and how far
--    behind it is.
--
-- 2. backup_outbox: a queue of changes. Triggers on contacts, list
--    membership, tags, companies, lists and people held without an email
--    add a row for every change - but only for accounts that have backup
--    switched on, so nobody else pays for it. The server empties the queue
--    into the spreadsheet about once a minute.
--
-- 3. backup_rows: which spreadsheet row holds which record, so a change
--    updates its own row instead of adding a new one.
--
-- 4. backup_tombstones: what a deleted record looked like, so the backup
--    keeps it (marked Deleted) even after a full rewrite.
--
-- Depends on: 004 (contact_lists), 110 (held_people), and companies.
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_connections (
  user_id          uuid PRIMARY KEY,
  provider         text NOT NULL DEFAULT 'google',
  account_email    text,
  access_token     text,
  refresh_token    text,
  expires_at       timestamptz,
  enabled          boolean NOT NULL DEFAULT true,
  spreadsheet_id   text,
  spreadsheet_url  text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_full       boolean NOT NULL DEFAULT true,
  busy_until       timestamptz,
  broken_at        timestamptz,
  broken_reason    text,
  last_error       text,
  last_flush_at    timestamptz,
  last_full_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE backup_connections ENABLE ROW LEVEL SECURITY;
-- Tokens live here: no policy, so only the server (service role) reads it.

DROP TRIGGER IF EXISTS trg_backup_connections_updated_at ON backup_connections;
CREATE TRIGGER trg_backup_connections_updated_at BEFORE UPDATE ON backup_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS backup_outbox (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  detail      text,
  snapshot    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_outbox_user ON backup_outbox(user_id, id);
ALTER TABLE backup_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS backup_rows (
  user_id    uuid NOT NULL,
  tab        text NOT NULL,
  entity_id  uuid NOT NULL,
  row_no     integer NOT NULL,
  PRIMARY KEY (user_id, tab, entity_id)
);
ALTER TABLE backup_rows ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS backup_tombstones (
  user_id    uuid NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid NOT NULL,
  data       jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_backup_tombstones_user ON backup_tombstones(user_id, entity, deleted_at DESC);
ALTER TABLE backup_tombstones ENABLE ROW LEVEL SECURITY;

-- Is backup on for this account? Every trigger asks first.
CREATE OR REPLACE FUNCTION backup_is_on(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM backup_connections b
     WHERE b.user_id = p_user AND b.enabled AND b.broken_at IS NULL
  );
$$;

-- The columns an update actually changed, ignoring bookkeeping that moves
-- on its own (engagement re-scores, counters, timestamps).
CREATE OR REPLACE FUNCTION backup_changed_columns(p_new jsonb, p_old jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(n.key, ',' ORDER BY n.key)
    FROM jsonb_each(p_new) n
   WHERE n.key <> ALL (ARRAY[
           'updated_at', 'engagement_score', 'engagement_factors', 'engagement_updated_at', 'engaged_at',
           'list_count', 'linkedin_checked_at', 'search_vector', 'fts', 'normalized_name', 'contact_count'
         ])
     AND n.value IS DISTINCT FROM (p_old -> n.key);
$$;

CREATE OR REPLACE FUNCTION backup_enqueue_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    uuid;
  v_entity  text := TG_ARGV[0];
  v_changed text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_user := OLD.user_id; ELSE v_user := NEW.user_id; END IF;
  IF v_user IS NULL OR NOT backup_is_on(v_user) THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO backup_outbox (user_id, entity, entity_id, action, detail)
    VALUES (v_user, v_entity, NEW.id, 'created',
            CASE WHEN v_entity IN ('person', 'held') THEN to_jsonb(NEW) ->> 'import_source' ELSE NULL END);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO backup_outbox (user_id, entity, entity_id, action, snapshot)
    VALUES (v_user, v_entity, OLD.id, 'deleted', to_jsonb(OLD) - 'enrichment' - 'engagement_factors' - 'access_token');
  ELSE
    v_changed := backup_changed_columns(to_jsonb(NEW), to_jsonb(OLD));
    IF v_changed IS NULL THEN RETURN NULL; END IF;
    INSERT INTO backup_outbox (user_id, entity, entity_id, action, detail)
    VALUES (v_user, v_entity, NEW.id, 'updated', v_changed);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION backup_enqueue_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_name text;
  v_contact uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_contact := OLD.contact_id; ELSE v_contact := NEW.contact_id; END IF;
  IF TG_TABLE_NAME = 'list_contacts' THEN
    SELECT l.user_id, l.name INTO v_user, v_name FROM contact_lists l
     WHERE l.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.list_id ELSE NEW.list_id END;
  ELSE
    SELECT t.user_id, t.name INTO v_user, v_name FROM tags t
     WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tag_id ELSE NEW.tag_id END;
  END IF;
  IF v_user IS NULL OR NOT backup_is_on(v_user) THEN RETURN NULL; END IF;
  INSERT INTO backup_outbox (user_id, entity, entity_id, action, detail)
  VALUES (v_user, 'person', v_contact,
          CASE
            WHEN TG_TABLE_NAME = 'list_contacts' AND TG_OP = 'INSERT' THEN 'list_added'
            WHEN TG_TABLE_NAME = 'list_contacts' THEN 'list_removed'
            WHEN TG_OP = 'INSERT' THEN 'tagged'
            ELSE 'untagged'
          END,
          v_name);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_backup_contacts ON contacts;
CREATE TRIGGER trg_backup_contacts AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_row('person');

DROP TRIGGER IF EXISTS trg_backup_companies ON companies;
CREATE TRIGGER trg_backup_companies AFTER INSERT OR UPDATE OR DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_row('company');

DROP TRIGGER IF EXISTS trg_backup_held_people ON held_people;
CREATE TRIGGER trg_backup_held_people AFTER INSERT OR UPDATE OR DELETE ON held_people
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_row('held');

DROP TRIGGER IF EXISTS trg_backup_contact_lists ON contact_lists;
CREATE TRIGGER trg_backup_contact_lists AFTER INSERT OR UPDATE OR DELETE ON contact_lists
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_row('list');

DROP TRIGGER IF EXISTS trg_backup_list_contacts ON list_contacts;
CREATE TRIGGER trg_backup_list_contacts AFTER INSERT OR DELETE ON list_contacts
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_membership();

DROP TRIGGER IF EXISTS trg_backup_contact_tags ON contact_tags;
CREATE TRIGGER trg_backup_contact_tags AFTER INSERT OR DELETE ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION backup_enqueue_membership();

-- Accounts with something waiting, oldest first, for the server's sweep.
CREATE OR REPLACE FUNCTION backup_pending_users(p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, pending bigint, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.user_id, count(*) AS pending, min(o.created_at) AS oldest
    FROM backup_outbox o
   GROUP BY o.user_id
   ORDER BY min(o.created_at)
   LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION backup_pending_users(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backup_pending_users(integer) TO service_role;
REVOKE ALL ON FUNCTION backup_is_on(uuid) FROM PUBLIC;
