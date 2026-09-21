-- 065: Repair the location_kind constraint on calendar_event_types.
-- Run in the Supabase SQL Editor. Idempotent. Safe whichever 062 you ran.
--
-- Why this exists.
--
-- Migration 062 as committed allows location_kind IN ('video', 'phone',
-- 'in_person', 'other'), which is what the application's EventLocationKind
-- type says and what the UI offers as "Something else". A copy of 062 that
-- went out for hand-running instead allowed 'none' in that fourth position
-- and seeded a type using it.
--
-- Either database works until somebody picks the fourth option in the type
-- editor. Against the 'none' constraint that write fails on a raw check
-- violation, which surfaces as a 500 and no saved change.
--
-- This file makes both databases agree with the code:
--   - any row already saying 'none' becomes 'other'
--   - the constraint is replaced with the one the code expects
--
-- On a database that ran the committed 062 this changes nothing: no rows
-- match, and the constraint is replaced with an identical one.

-- The constraint comes off FIRST, and the order is the whole point. On the
-- database this is meant to repair, the existing constraint permits 'none'
-- and forbids 'other' - so an UPDATE rewriting 'none' to 'other' is itself
-- a check violation while that constraint is still in place. Rows cannot be
-- corrected under the rule that made them wrong.
ALTER TABLE calendar_event_types
  DROP CONSTRAINT IF EXISTS calendar_event_types_location_known;

UPDATE calendar_event_types
   SET location_kind = 'other'
 WHERE location_kind = 'none';

-- Anything else unexpected also becomes 'other' rather than blocking the
-- constraint. 'other' is the honest answer for a value the app cannot name.
UPDATE calendar_event_types
   SET location_kind = 'other'
 WHERE location_kind NOT IN ('video', 'phone', 'in_person', 'other');

ALTER TABLE calendar_event_types
  ADD CONSTRAINT calendar_event_types_location_known
  CHECK (location_kind IN ('video', 'phone', 'in_person', 'other'));

-- The seeded set of meeting kinds also differed between the two copies. It
-- is not worth renaming anybody's types underneath them - they are the
-- account's own vocabulary and may already be in use on real meetings - but
-- a type named 'Internal' seeded with no location is the one row that was
-- never meant to exist, and it is only touched if nothing has used it.
UPDATE calendar_event_types t
   SET name = 'Follow-up internal'
 WHERE t.name = 'Internal'
   AND NOT EXISTS (SELECT 1 FROM crm_events e WHERE e.event_type_id = t.id)
   AND NOT EXISTS (
     SELECT 1 FROM calendar_event_types o
      WHERE o.user_id = t.user_id AND o.name = 'Follow-up internal'
   );

-- Every account must still have exactly one default, whichever 062 ran.
-- A partial index enforces "no more than one"; nothing enforces "at least
-- one", and a booking link with no kind behind it has no length.
UPDATE calendar_event_types t
   SET is_default = true
 WHERE t.archived_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM calendar_event_types d
      WHERE d.user_id = t.user_id AND d.is_default AND d.archived_at IS NULL
   )
   AND t.id = (
     SELECT x.id FROM calendar_event_types x
      WHERE x.user_id = t.user_id AND x.archived_at IS NULL
      ORDER BY x.created_at
      LIMIT 1
   );
