-- 030: SARA → CRM auto-deals toggle. Run in the Supabase SQL Editor. Idempotent.
-- When ON (default), SARA creates a qualified deal + follow-up task whenever a
-- reply is classified as interested/meeting. Users can turn it off in Settings.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS crm_auto_deals boolean DEFAULT true;
