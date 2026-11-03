-- ============================================================================
-- 114 - Connect Outlook and Microsoft 365 mailboxes with Microsoft sign-in.
--
-- Microsoft has switched off password (and app password) sign-in for
-- Outlook.com, Hotmail and Live mailboxes, and is retiring it for Microsoft
-- 365. A mailbox connected with "Connect with Microsoft" sends and reads
-- with a sign-in token instead, renewed by the server as it expires.
--
-- 1. smtp_accounts.auth_kind: 'password' (as before) or 'microsoft'.
--
-- 2. mailbox_oauth: the Microsoft sign-in for such a mailbox. The renewal
--    token is encrypted by the server; only the server reads this table.
--
-- Depends on: smtp_accounts. Safe to run more than once.
-- ============================================================================

ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS auth_kind text NOT NULL DEFAULT 'password';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtp_accounts_auth_kind_known') THEN
    ALTER TABLE smtp_accounts ADD CONSTRAINT smtp_accounts_auth_kind_known CHECK (auth_kind IN ('password', 'microsoft'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mailbox_oauth (
  account_id     uuid PRIMARY KEY REFERENCES smtp_accounts(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  provider       text NOT NULL DEFAULT 'microsoft',
  account_email  text,
  tenant_id      text,
  access_token   text,
  refresh_token  text NOT NULL,
  expires_at     timestamptz,
  broken_at      timestamptz,
  broken_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_user ON mailbox_oauth(user_id);
ALTER TABLE mailbox_oauth ENABLE ROW LEVEL SECURITY;
-- Tokens live here: no policy, so only the server (service role) reads it.

DROP TRIGGER IF EXISTS trg_mailbox_oauth_updated_at ON mailbox_oauth;
CREATE TRIGGER trg_mailbox_oauth_updated_at BEFORE UPDATE ON mailbox_oauth
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
