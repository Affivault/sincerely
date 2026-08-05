-- ============================================================================
-- 036 — "Not in Lists"
--
-- Adds contacts.list_count: how many NON-TRASHED lead lists a contact belongs
-- to. This turns "show me everyone who isn't in a list" into an indexed
-- `list_count = 0` filter that composes with every other filter, sort and
-- page — instead of an anti-join whose id set would grow past what a
-- PostgREST request can carry.
--
-- The count deliberately ignores trashed lists: a list in the trash is not a
-- live list, so its members must resurface as unlisted. Restoring the list
-- puts them back.
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS list_count integer NOT NULL DEFAULT 0;

-- Every "Not in Lists" query is (user_id, list_count = 0).
CREATE INDEX IF NOT EXISTS idx_contacts_user_list_count ON contacts(user_id, list_count);

-- ── Recount helper ──────────────────────────────────────────────────────────
-- Single source of truth for the count. Triggers below only decide WHICH
-- contacts to recompute; they never do the arithmetic themselves, so the
-- definition can't drift between code paths.
CREATE OR REPLACE FUNCTION recount_contact_lists(cids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE contacts c
     SET list_count = (
           SELECT count(*)
             FROM list_contacts lc
             JOIN contact_lists cl ON cl.id = lc.list_id
            WHERE lc.contact_id = c.id
              AND cl.is_trashed IS NOT TRUE
         )
   WHERE c.id = ANY(cids);
$$;

-- ── Membership added / removed ──────────────────────────────────────────────
-- Statement-level with transition tables so a 10,000-row CSV import triggers
-- one recount, not 10,000. Deleting a list cascades to list_contacts, so the
-- delete trigger covers hard-deleted lists too.
CREATE OR REPLACE FUNCTION trg_list_contacts_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM recount_contact_lists(ARRAY(SELECT DISTINCT contact_id FROM new_rows));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_list_contacts_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM recount_contact_lists(ARRAY(SELECT DISTINCT contact_id FROM old_rows));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS list_contacts_after_insert ON list_contacts;
CREATE TRIGGER list_contacts_after_insert
AFTER INSERT ON list_contacts
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_list_contacts_added();

DROP TRIGGER IF EXISTS list_contacts_after_delete ON list_contacts;
CREATE TRIGGER list_contacts_after_delete
AFTER DELETE ON list_contacts
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_list_contacts_removed();

-- ── List trashed or restored ────────────────────────────────────────────────
-- No membership row changes here, but every member's count does.
CREATE OR REPLACE FUNCTION trg_contact_lists_trash_toggled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM recount_contact_lists(
    ARRAY(SELECT contact_id FROM list_contacts WHERE list_id = NEW.id)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contact_lists_after_trash_toggle ON contact_lists;
CREATE TRIGGER contact_lists_after_trash_toggle
AFTER UPDATE OF is_trashed ON contact_lists
FOR EACH ROW
WHEN (OLD.is_trashed IS DISTINCT FROM NEW.is_trashed)
EXECUTE FUNCTION trg_contact_lists_trash_toggled();

-- ── Backfill existing data ──────────────────────────────────────────────────
UPDATE contacts c
   SET list_count = (
         SELECT count(*)
           FROM list_contacts lc
           JOIN contact_lists cl ON cl.id = lc.list_id
          WHERE lc.contact_id = c.id
            AND cl.is_trashed IS NOT TRUE
       );
