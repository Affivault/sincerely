-- 055: Prospects and contacts are not the same thing.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- This app manufactures thousands of records nobody has ever spoken to. A
-- CRM built the other way round - Pipedrive, say - never faces this,
-- because a human typed every contact in. Here, scraped strangers and real
-- relationships have been sharing one table, which means the contact list
-- is mostly noise, search returns junk, and a contact count answers
-- nothing.
--
-- One table with a lifecycle rather than two tables, deliberately. The
-- separate-table version is Salesforce's Lead-to-Contact conversion, and
-- its cost is well known: promotion means copying a row, and then every
-- email, campaign activity and tracking event pointing at the old row has
-- to be re-pointed or split. Here promotion is a column update. Nothing is
-- copied, nothing is re-pointed, the inbox and the deal pages keep working
-- through the same contact_id they already hold, and it is reversible.
--
--   prospect  scraped or imported, never engaged. Exists to be emailed.
--   contact   replied, met, or was deliberately added. Has a relationship.
--   customer  won a deal. Not a prospect any more, and should not be
--             cold-emailed by accident.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'prospect';
-- When they stopped being a stranger. Null for prospects.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engaged_at timestamptz;
-- What promoted them, so the decision is auditable rather than mysterious.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS promoted_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lifecycle_known') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_lifecycle_known
      CHECK (lifecycle IN ('prospect', 'contact', 'customer'));
  END IF;
END;
$$;

-- The CRM list is "engaged only", and it is the commonest query in the app
-- once this lands.
CREATE INDEX IF NOT EXISTS idx_contacts_user_lifecycle
  ON contacts (user_id, lifecycle);

/*
 * Backfill, from facts rather than guesses.
 *
 * Guarded on engaged_at IS NULL so re-running this file changes nothing,
 * and so a later manual demotion is never silently undone by somebody
 * running the migration again.
 *
 * Ordered deliberately: customer wins over contact, because somebody who
 * bought and also replied is a customer.
 */

-- Customers: anybody on a won deal, as the named contact or a participant.
WITH won AS (
  SELECT DISTINCT c.id
  FROM contacts c
  WHERE c.engaged_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage = 'won')
      OR EXISTS (
        SELECT 1 FROM deal_participants p
        JOIN deals d ON d.id = p.deal_id
        WHERE p.contact_id = c.id AND d.stage = 'won'
      )
    )
)
UPDATE contacts c
   SET lifecycle = 'customer',
       engaged_at = COALESCE(c.updated_at, c.created_at, now()),
       promoted_by = 'backfill_won_deal'
  FROM won
 WHERE c.id = won.id;

-- Contacts: anybody who replied, or who somebody has done CRM work against.
WITH engaged AS (
  SELECT DISTINCT c.id
  FROM contacts c
  WHERE c.engaged_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM campaign_activities a
        WHERE a.contact_id = c.id AND a.activity_type = 'replied'
      )
      OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM deal_participants p WHERE p.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM crm_events e WHERE e.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM crm_notes n WHERE n.contact_id = c.id)
    )
)
UPDATE contacts c
   SET lifecycle = 'contact',
       engaged_at = COALESCE(c.updated_at, c.created_at, now()),
       promoted_by = 'backfill_engaged'
  FROM engaged
 WHERE c.id = engaged.id;

/*
 * Everybody else stays a prospect, which is the column default, so no
 * update is needed and none is done. Deliberately not marking them
 * engaged_at: that column is the record of a real event, and writing a
 * timestamp for something that never happened would make the guard above
 * useless on the next run.
 */
