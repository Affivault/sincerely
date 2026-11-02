-- 107: the account's own currency.
--
-- Settings > General > Currency. Totals, forecasts and revenue figures are
-- shown in it, and a new deal or lead starts in it. Deals keep their own
-- currency column (025), so a deal priced in euros stays in euros.
--
-- Safe to run more than once.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_currency_code') THEN
    ALTER TABLE user_settings ADD CONSTRAINT user_settings_currency_code
      CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
