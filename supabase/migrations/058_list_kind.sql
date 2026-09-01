-- 058: Lead lists and contact lists are different things.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Every list in this app has been a cold-outreach audience, because that is
-- all there was: campaigns.list_id points at contact_lists, and any list was
-- fair game. Now that prospects and contacts are separated, the lists have to
-- separate with them. A CRM list holds people you have relationships with -
-- customers, replied-to contacts, accounts you are working - and pointing a
-- cold sequence at that list is the single worst thing this product could do
-- to somebody's business.
--
-- So lists carry a kind. Lead lists feed campaigns. Contact lists never do,
-- and the database is what says so rather than the six code paths that reach
-- campaigns.list_id. An app bug should be a bug, not an apology to a customer.
--
-- Existing lists all become lead lists. That is what they have been used as,
-- and inventing a split for data that predates the idea would put people in
-- CRM lists nobody put there.

ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'lead';
ALTER TABLE list_folders  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'lead';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_lists_kind_known') THEN
    ALTER TABLE contact_lists ADD CONSTRAINT contact_lists_kind_known
      CHECK (kind IN ('lead', 'contact'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'list_folders_kind_known') THEN
    ALTER TABLE list_folders ADD CONSTRAINT list_folders_kind_known
      CHECK (kind IN ('lead', 'contact'));
  END IF;
END;
$$;

-- Both rails read "my lists of this kind, in order" on every page load.
CREATE INDEX IF NOT EXISTS idx_contact_lists_user_kind ON contact_lists (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_list_folders_user_kind  ON list_folders (user_id, kind);

-- The guard itself.
--
-- A cross-table rule cannot be a CHECK constraint, so it is a trigger: any
-- attempt to point a campaign at a contact list is refused outright. This
-- fires on the campaign side rather than the list side because that is where
-- the damage would be done, and it runs for every writer - the app, a
-- migration, somebody in the SQL editor at midnight.
CREATE OR REPLACE FUNCTION campaign_list_must_be_lead_kind()
RETURNS trigger AS $$
DECLARE
  v_kind text;
  v_name text;
BEGIN
  IF NEW.list_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kind, name INTO v_kind, v_name FROM contact_lists WHERE id = NEW.list_id;

  IF v_kind = 'contact' THEN
    RAISE EXCEPTION
      'Campaign cannot send to "%": that is a contact list, not a lead list. Cold outreach only goes to lead lists.',
      COALESCE(v_name, NEW.list_id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaign_list_kind ON campaigns;
CREATE TRIGGER trg_campaign_list_kind
  BEFORE INSERT OR UPDATE OF list_id ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign_list_must_be_lead_kind();

-- The other direction: a lead list already feeding a campaign must not be
-- quietly reclassified as a contact list, which would leave a running
-- campaign pointed at something the trigger above would now refuse.
CREATE OR REPLACE FUNCTION list_kind_change_must_not_orphan_campaign()
RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.kind = 'contact' AND OLD.kind IS DISTINCT FROM NEW.kind THEN
    SELECT count(*) INTO v_count FROM campaigns WHERE list_id = NEW.id;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Cannot make "%" a contact list: % campaign(s) still send to it. Point them at another lead list first.',
        NEW.name, v_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_list_kind_change ON contact_lists;
CREATE TRIGGER trg_list_kind_change
  BEFORE UPDATE OF kind ON contact_lists
  FOR EACH ROW EXECUTE FUNCTION list_kind_change_must_not_orphan_campaign();
