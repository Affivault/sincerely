-- 087: Control over when a prospect becomes a contact on its own.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- A prospect is moved to Contacts automatically when something shows a
-- real person engaged: a reply, a booked meeting, a lead or a deal. These
-- columns let each account decide which of those count, or switch the
-- automatic move off and do it by hand.
--
--   contact_auto_promote        master switch. Off = only manual moves.
--   contact_promote_on_reply    'any'      any reply written by a person
--                               'positive' only replies read as interested
--                                          or asking for a meeting
--                               'off'      replies never move anyone
--   contact_promote_on_meeting  a meeting booked or logged with them
--   contact_promote_on_deal     made a lead, or added to a deal
--
-- Auto-replies, out-of-office notes, bounces and unsubscribe requests
-- never count, whatever is chosen here. That is enforced in the server.
-- Defaults match what the app did before, so nothing changes until a
-- setting is changed.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS contact_auto_promote boolean NOT NULL DEFAULT true;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS contact_promote_on_reply text NOT NULL DEFAULT 'any';

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS contact_promote_on_meeting boolean NOT NULL DEFAULT true;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS contact_promote_on_deal boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_contact_promote_on_reply_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_contact_promote_on_reply_check
      CHECK (contact_promote_on_reply IN ('any', 'positive', 'off'));
  END IF;
END $$;
