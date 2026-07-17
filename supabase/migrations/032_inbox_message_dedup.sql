-- Two overlapping inbox-sync runs for the same account (background worker running
-- longer than one scheduler tick, or a background sync overlapping a manual "sync now")
-- both do a SELECT-count-then-INSERT dedup check with no DB-level guard, so both can
-- see "not yet stored" and both insert the same message. Close the race with a unique
-- constraint; both call sites already log-and-skip on insert error, so this just makes
-- the second insert fail cleanly instead of silently duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_user_message_unique
  ON inbox_messages (user_id, message_id)
  WHERE message_id IS NOT NULL;
