-- Per-inbox email signatures.
-- Each SMTP account can carry its own HTML signature, and optionally have it
-- auto-added to every new message/reply sent from that inbox.

ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS signature_html text,
  ADD COLUMN IF NOT EXISTS signature_auto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN smtp_accounts.signature_html IS 'HTML signature for this inbox, shown/inserted in the composer.';
COMMENT ON COLUMN smtp_accounts.signature_auto IS 'When true, the signature is added by default on every new compose/reply from this inbox ("always display").';
