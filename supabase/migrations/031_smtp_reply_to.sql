-- 031: Optional reply-to address per sending mailbox. Run in the Supabase SQL
-- Editor. Idempotent. When set, replies are directed here instead of the From
-- address (e.g. send from outreach@, collect replies at inbox@).

ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS reply_to text;
