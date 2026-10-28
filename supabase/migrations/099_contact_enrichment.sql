-- 099: Contact enrichment (the Enrich button) and real email verification.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- email_verified_by says who gave the verdict on an address:
--   icypeas      a paid mailbox check through Icypeas
--   mail_server  our own server asked the recipient's mail server directly
--   dns          only the format and the domain could be checked
--
-- enrichment holds the 360 profile from the last time somebody pressed
-- Enrich on the contact's page: their LinkedIn profile, their company and
-- the email check. profile_enriched_at is when that was. Enrichment is only
-- ever started by a person, never automatically.
--
-- The company record gets the same two columns, so a second person at the
-- same company reuses the company profile instead of paying for it again.


ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_verified_by text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrichment jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_enriched_at timestamptz;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS enrichment jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_enriched_at timestamptz;
