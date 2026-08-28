-- 056: Link stored email to the people it is actually with, and reclassify.
-- Run in the Supabase SQL Editor. Idempotent. Run 055 first.
--
-- inbox_messages.contact_id was only ever set as a side effect of campaign
-- matching: the sync looked the sender up by address, and then threw the
-- result away unless that person also had a live campaign enrolment. An
-- email from somebody unambiguously in your contacts, who had never been
-- enrolled, was stored with no contact attached at all.
--
-- The consequence was quiet and wide. The email history on a contact page,
-- the conversation on a deal page, and every engagement signal derived
-- from correspondence all read that column, and it was empty for almost
-- everything.
--
-- The sync itself is fixed. This repairs what is already stored, and then
-- reruns the lifecycle classification now that "somebody emailed you"
-- counts - which it should always have.

-- 1. Attach stored messages to the contact at the other end.
--
-- Matched on the counterparty address: who sent it for inbound mail, who it
-- went to for outbound. Lowercased on both sides because addresses are
-- case-insensitive in practice and are not stored consistently.
UPDATE inbox_messages m
   SET contact_id = c.id
  FROM contacts c
 WHERE m.contact_id IS NULL
   AND c.user_id = m.user_id
   AND lower(c.email) = lower(
         CASE WHEN m.direction = 'outbound' THEN m.to_email ELSE m.from_email END
       );

-- Reading a person's whole correspondence is now a real query rather than
-- a scan, and it happens on every contact and deal page.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_contact
  ON inbox_messages (contact_id, received_at DESC) WHERE contact_id IS NOT NULL;

/*
 * 2. Reclassify, now that correspondence counts.
 *
 * Still guarded on engaged_at IS NULL, so this only ever touches people
 * who have never been classified. Anybody promoted or demoted by hand
 * since 055 keeps whatever was decided about them.
 *
 * Auto-replies are excluded deliberately. An out-of-office is not somebody
 * deciding to talk to you, and counting it would put every bounced holiday
 * responder in the CRM - exactly the noise the lifecycle split exists to
 * keep out.
 */
WITH engaged AS (
  SELECT DISTINCT c.id
  FROM contacts c
  WHERE c.engaged_at IS NULL
    AND EXISTS (
      SELECT 1 FROM inbox_messages m
      WHERE m.contact_id = c.id
        AND m.direction = 'inbound'
        AND (m.auto_reply_kind IS NULL OR m.auto_reply_kind = '')
    )
)
UPDATE contacts c
   SET lifecycle = 'contact',
       engaged_at = COALESCE(c.updated_at, c.created_at, now()),
       promoted_by = 'backfill_inbound_email'
  FROM engaged
 WHERE c.id = engaged.id;

/*
 * 3. Deals that name somebody only by address.
 *
 * A deal can carry contact_email with no contact_id - the app has an
 * auto-link helper precisely because that is common - and 055 matched on
 * contact_id alone, so those deals promoted nobody. Worth repairing the
 * link itself and not just the lifecycle, because the deal page reads
 * contact_id to show who it is with.
 */
UPDATE deals d
   SET contact_id = c.id
  FROM contacts c
 WHERE d.contact_id IS NULL
   AND d.contact_email IS NOT NULL
   AND c.user_id = d.user_id
   AND lower(c.email) = lower(d.contact_email);

WITH on_deals AS (
  SELECT DISTINCT c.id, bool_or(d.stage = 'won') AS has_won
  FROM contacts c
  JOIN deals d ON d.contact_id = c.id
  WHERE c.engaged_at IS NULL
  GROUP BY c.id
)
UPDATE contacts c
   SET lifecycle = CASE WHEN on_deals.has_won THEN 'customer' ELSE 'contact' END,
       engaged_at = COALESCE(c.updated_at, c.created_at, now()),
       promoted_by = 'backfill_deal_by_email'
  FROM on_deals
 WHERE c.id = on_deals.id;
