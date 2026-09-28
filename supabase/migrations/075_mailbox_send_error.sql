-- 075: Why a mailbox stopped sending.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- When a campaign send is refused because the mailbox's password no longer
-- works (changed, revoked app password, SMTP sign-in switched off), the
-- mailbox is taken out of rotation so the other mailboxes carry on - and the
-- server's reason is kept here so the mailbox list can say "Sign-in refused"
-- with the actual message, instead of a vague "Not tested".
--
-- Cleared automatically by the next successful connection test or a new
-- password. The app works without this column; only the reason text is lost.

ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS last_send_error text,
  ADD COLUMN IF NOT EXISTS last_send_error_at timestamptz;
