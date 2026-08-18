-- ============================================================================
-- 045: Stop a campaign that is burning the sending domain, and say why.
--
-- bounce_rate is calculated and displayed on every campaign, and bounce_rate_7d
-- is stored per mailbox. Nothing has ever acted on either. Feed in a bought or
-- stale list and the platform sends through a 40% bounce rate until the run
-- finishes -- which is how a sending domain gets burned. Mailbox providers read
-- a high bounce rate as a spam signal, and the damage is not undone by pausing
-- afterwards.
--
-- The second half of this migration is the other side of the same coin. The
-- sending engine already computes precise reasons a campaign is not sending
-- ("All accounts have reached their daily sending limit", "No active, verified
-- SMTP accounts found") and throws the string away, so a campaign sits on
-- "running" with nothing happening and no explanation. These columns give that
-- reason somewhere to live, and the circuit breaker uses the same place to
-- explain itself.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Why a campaign is stopped, or stalled.
--
-- stall_reason is transient: the engine writes it when it cannot send and
-- clears it on the next successful send. paused_reason is durable and set only
-- when something stopped the campaign on the user's behalf.
-- ----------------------------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS paused_reason text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stall_reason text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stall_since timestamptz;

-- ----------------------------------------------------------------------------
-- 2. The circuit breaker's settings.
--
-- On by default, unlike the other opt-in features added recently. A safety
-- brake that ships switched off protects nobody, because the people who need
-- it are exactly the people who do not know they need it. The default of 8%
-- sits well clear of the 2-3% a healthy cold list bounces at, so a campaign
-- with good data will never see it; it fires on lists that are actually
-- broken.
--
-- The floor of 20 sends matters as much as the threshold. Judged on rate
-- alone, two bounces out of three is 67% and would pause a campaign on its
-- third send -- which would teach everyone to switch the protection off.
-- ----------------------------------------------------------------------------
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS bounce_guard_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS bounce_guard_threshold numeric NOT NULL DEFAULT 8;

ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_bounce_guard_threshold_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_bounce_guard_threshold_check
  CHECK (bounce_guard_threshold > 0 AND bounce_guard_threshold <= 100);

-- ----------------------------------------------------------------------------
-- 3. Index for the breaker's counting query.
--
-- After every bounce it counts sends and bounces for one campaign. Without a
-- composite index that reads every activity row the campaign has ever
-- produced, on the send path, which is the last place to add work.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaign_activities_campaign_type
  ON campaign_activities (campaign_id, activity_type);
