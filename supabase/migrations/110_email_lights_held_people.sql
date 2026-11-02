-- ============================================================================
-- 110 - Email traffic lights: people with no email are kept, and campaigns
--       send only to the lights they are set to.
--
-- 1. held_people: leads and contacts imported without a usable email.
--    They used to be dropped from the import. Now they are kept in the
--    list they were imported into and shown as "No email", so an address
--    can be typed in, or the fixed file re-imported, and they move into the
--    list as ordinary leads. They are a separate table on purpose: contacts
--    are keyed by email everywhere (dedupe, suppression, campaigns), and a
--    person with no address cannot be sent to by anything.
--
-- 2. campaigns.send_lights: which lights a campaign emails.
--      green  verified
--      amber  risky / catch-all / not checked yet
--      red    invalid, no mail server, bounced
--    NULL means "no light gate", which is what every campaign created
--    before this migration gets, so nothing already running changes. New
--    campaigns are created with {green} unless the person chooses more.
--
-- Depends on: 004 (contact_lists). Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS held_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  list_id       uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
  -- linkedin profile, or first|last|company: how a re-import recognises them
  match_key     text NOT NULL,
  first_name    text,
  last_name     text,
  company       text,
  job_title     text,
  linkedin_url  text,
  -- every other field the row carried, in the shape the import sends a contact
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- what was in the email column when it was not an address ("n/a")
  raw_email     text,
  reason        text NOT NULL DEFAULT 'no_email',
  -- imported as a lead or as a contact: which page shows them, and what
  -- they become when an email arrives
  kind          text NOT NULL DEFAULT 'lead',
  import_source text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'held_people_reason_known') THEN
    ALTER TABLE held_people ADD CONSTRAINT held_people_reason_known CHECK (reason IN ('no_email', 'invalid_email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'held_people_kind_known') THEN
    ALTER TABLE held_people ADD CONSTRAINT held_people_kind_known CHECK (kind IN ('lead', 'contact'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_held_people_user_match ON held_people(user_id, match_key);
CREATE INDEX IF NOT EXISTS idx_held_people_user_list ON held_people(user_id, list_id);

-- The "No email" panel searches by name and company with ILIKE '%...%'.
-- pg_trgm and btree_gin are installed by an earlier migration (the contacts
-- search indexes); IF NOT EXISTS keeps this safe either way.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE INDEX IF NOT EXISTS idx_held_people_first_trgm ON held_people USING gin (user_id, first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_held_people_last_trgm  ON held_people USING gin (user_id, last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_held_people_company_trgm ON held_people USING gin (user_id, company gin_trgm_ops);

ALTER TABLE held_people ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'held_people' AND policyname = 'Users manage their own held people') THEN
    CREATE POLICY "Users manage their own held people" ON held_people FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_held_people_updated_at ON held_people;
CREATE TRIGGER trg_held_people_updated_at BEFORE UPDATE ON held_people
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_lights text[];

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_send_lights_known') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_send_lights_known
      CHECK (send_lights IS NULL OR send_lights <@ ARRAY['green', 'amber', 'red']::text[]);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
