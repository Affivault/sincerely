-- 042: Sending in the recipient's local time.
--
-- campaign_contacts.contact_timezone has existed since the very first schema
-- and has never been read or written by a single line of code. The feature it
-- was added for was never built, so every campaign sends on the *sender's*
-- clock: a London-configured send window reaches a San Francisco prospect at
-- one in the morning.
--
-- This turns that column on, and adds the per-campaign switch that decides
-- whether to use it.

-- Present since 001/003 on most installs; stated here so a database that
-- somehow lacks it still ends up correct.
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS contact_timezone text;

-- Opt in per campaign. Off by default: turning it on changes when existing
-- contacts are contacted, which is not a thing to do to a live campaign
-- without being asked.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_in_recipient_timezone boolean NOT NULL DEFAULT false;

-- The sequence worker reads contact_timezone for one contact at a time by
-- primary key, so it needs no index of its own. This one serves the coverage
-- readout on the campaign page ("612 of 800 placed"), which counts the rows
-- that have no zone.
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_missing_tz
  ON campaign_contacts (campaign_id)
  WHERE contact_timezone IS NULL;
