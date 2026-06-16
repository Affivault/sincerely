-- 016: Per-user toggle for automatically verifying contacts in the background.
-- When enabled (default), a throttled worker drains unverified contacts
-- (dcs_verified_at IS NULL) through the DCS pipeline so the verification
-- status column stays populated — including freshly imported contacts.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS auto_verify_contacts boolean NOT NULL DEFAULT true;

-- Partial index to make the worker's "find unverified" scan cheap.
CREATE INDEX IF NOT EXISTS idx_contacts_unverified
  ON contacts (user_id)
  WHERE dcs_verified_at IS NULL;
