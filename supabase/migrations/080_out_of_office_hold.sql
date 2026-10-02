-- 080: Out-of-office replies hold follow-ups until the person is back.
--
-- When an out-of-office arrives, the platform reads the return date from
-- it and moves the next email of every live sequence to that person until
-- the day after. These columns are the note on the contact that says so,
-- so nobody wonders why a sequence went quiet:
--
--   away_until       when the next email may go (the day after they are back,
--                    or a short default when no date was given)
--   away_returns_on  the date they gave, when they gave one
--   away_note        the words it was read from, e.g. "out of the office
--                    until Wednesday 14th October"
--
-- The holding itself needs nothing new: it moves next_send_at. Without
-- this migration follow-ups are still held; only the note is missing.
--
-- Safe to run more than once.

alter table contacts add column if not exists away_until timestamptz;
alter table contacts add column if not exists away_returns_on date;
alter table contacts add column if not exists away_note text;
