-- 091: Closed days (blackout dates), and auto-pause on spam complaints and
-- on an open-rate collapse.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- 1. Closed days. user_settings.blackout_dates is the account's list,
--    campaigns.blackout_dates a campaign's extra one. The sequence engine
--    treats each as a day with no send window and rolls to the next open
--    day, on the campaign's clock (or the recipient's, when the campaign
--    sends on theirs). Entries are text:
--      'YYYY-MM-DD'  that one day
--      'MM-DD'       that day every year (Christmas Day is '12-25')
--    The server cleans every list before it is written; the CHECK below is
--    only the last line, so a hand-edited row cannot hold something the
--    engine would misread.
--
-- 2. Two more guards beside the bounce guard (045), on by default for the
--    same reason it is: a safety brake that ships switched off protects
--    nobody.
--      complaint_guard_*  pause when recipients mark a campaign as spam
--                         past the threshold (percent of sends; 0.3 is the
--                         line Gmail and Yahoo publish)
--      open_guard_*       pause when the human open rate falls this many
--                         percent below the campaign's own usual rate
--
-- 3. campaigns.paused_signal records which guard paused a campaign
--    ('bounce_rate', 'complaint_rate' or 'open_collapse'); NULL for a pause
--    the user made. paused_reason (045) still holds the sentence shown.
--    campaigns.guard_since is set when a campaign one of the new guards
--    paused is resumed: they count from then, so the evidence the user just
--    dealt with does not pause it again.
--
-- The server runs without this migration: no closed days, the guards on
-- with their defaults, and the reason written without paused_signal.

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS blackout_dates text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS complaint_guard_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS complaint_guard_threshold numeric NOT NULL DEFAULT 0.3;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS open_guard_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS open_guard_drop integer NOT NULL DEFAULT 60;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS blackout_dates text[] NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS paused_signal text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS guard_since timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_blackout_dates_check') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_blackout_dates_check
      CHECK (cardinality(blackout_dates) <= 200
             AND array_to_string(blackout_dates, ',') ~ '^((\d{4}-)?\d{2}-\d{2}(,|$))*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_blackout_dates_check') THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_blackout_dates_check
      CHECK (cardinality(blackout_dates) <= 200
             AND array_to_string(blackout_dates, ',') ~ '^((\d{4}-)?\d{2}-\d{2}(,|$))*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_complaint_guard_threshold_check') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_complaint_guard_threshold_check
      CHECK (complaint_guard_threshold > 0 AND complaint_guard_threshold <= 5);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_open_guard_drop_check') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_open_guard_drop_check
      CHECK (open_guard_drop BETWEEN 20 AND 95);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_paused_signal_check') THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_paused_signal_check
      CHECK (paused_signal IS NULL OR paused_signal IN ('bounce_rate', 'complaint_rate', 'open_collapse'));
  END IF;
END $$;

-- The open-rate guard reads a campaign's newest settled sends, then the
-- opens for those enrolments. The opens are served by the existing
-- (campaign_contact_id, step_id, activity_type) index; this one makes the
-- newest-first read of sends cheap on a big campaign.
CREATE INDEX IF NOT EXISTS idx_campaign_activities_campaign_type_time
  ON campaign_activities (campaign_id, activity_type, occurred_at DESC);
