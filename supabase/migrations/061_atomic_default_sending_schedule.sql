-- 061: Atomic default-schedule swap
-- Run this in the Supabase SQL Editor. Idempotent.
--
-- sending-schedules.service.ts create()/update() cleared the old default
-- with one UPDATE, then set the new one with a second, separate write. If
-- that second write failed for any reason (a duplicate name, the row having
-- vanished, a concurrent request racing the same sequence), the old default
-- was already cleared and the account was left with zero default schedules
-- -- campaigns then silently fall back to hard-coded UTC 09:00-17:00
-- Mon-Fri instead of the user's real business hours, with no error shown.
-- A single UPDATE statement is atomic per Postgres semantics (it fully
-- applies or fully rolls back), so folding "clear the old default, set the
-- new one" into one statement removes the window where neither holds.
CREATE OR REPLACE FUNCTION set_default_sending_schedule(p_user_id uuid, p_schedule_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE sending_schedules
  SET is_default = (id = p_schedule_id)
  WHERE user_id = p_user_id AND (is_default = TRUE OR id = p_schedule_id);
END;
$$ LANGUAGE plpgsql;
