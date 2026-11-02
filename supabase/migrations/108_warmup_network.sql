-- 108: the shared warm-up network.
--
-- A mailbox that joins sends warm-up mail to, and receives it from, other
-- Sincerely mailboxes that have joined too, not only the owner's own. Off
-- by default: nothing is shared until the owner switches it on in Warm-up.
--
-- Safe to run more than once.

ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS warmup_network boolean NOT NULL DEFAULT false;

-- The warm-up tick looks up who is in the network on every run.
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_warmup_network
  ON smtp_accounts (warmup_network) WHERE warmup_network = true;

-- Counting what each mailbox sent and received today, and over 7 days.
CREATE INDEX IF NOT EXISTS idx_warmup_emails_from_account
  ON warmup_emails (from_account_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_warmup_emails_to_account_sent
  ON warmup_emails (to_account_id, sent_at);

NOTIFY pgrst, 'reload schema';
