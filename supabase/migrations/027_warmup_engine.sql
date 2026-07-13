-- 027_warmup_engine.sql
-- Turns "warm-up" from a static cap into a real engine: a gradual send ramp for
-- new mailboxes plus a log of the warm-up emails exchanged between a user's own
-- inboxes (so they can be opened, replied to, and rescued from spam to build
-- genuine sender reputation).

-- Ramp configuration on each mailbox. warmup_mode + warmup_daily_target already
-- exist (002); warmup_daily_target is now the ramp TARGET.
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz;
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS warmup_start_volume integer NOT NULL DEFAULT 4;
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS warmup_ramp_days integer NOT NULL DEFAULT 30;
ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS warmup_sent_today integer NOT NULL DEFAULT 0;

-- Give the target a sensible default for accounts created before warm-up existed.
UPDATE smtp_accounts SET warmup_daily_target = 40 WHERE warmup_daily_target IS NULL OR warmup_daily_target = 20;

-- Log of warm-up messages exchanged between a user's mailboxes. Drives the
-- engagement loop (open / reply / rescue) and the progress metrics.
CREATE TABLE IF NOT EXISTS warmup_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_account_id uuid NOT NULL,
  to_account_id uuid NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  message_id text,
  token text NOT NULL,
  -- sent | opened | replied | rescued | failed
  status text NOT NULL DEFAULT 'sent',
  is_reply boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  replied_at timestamptz,
  rescued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warmup_emails_user ON warmup_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_warmup_emails_to_account ON warmup_emails(to_account_id);
CREATE INDEX IF NOT EXISTS idx_warmup_emails_token ON warmup_emails(token);
CREATE INDEX IF NOT EXISTS idx_warmup_emails_sent_at ON warmup_emails(sent_at);
