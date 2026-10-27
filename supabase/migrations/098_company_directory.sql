-- 098: Free company directory for the Prospector.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- Our own copy of the People Data Labs Free Company Dataset (about 22M
-- companies, licensed CC BY 4.0), so company search in the Prospector costs
-- no provider credits. It holds firmographics only: no people and no emails.
-- Finding people at a company, and finding or verifying their emails, still
-- goes through the paid provider (Icypeas).
--
-- This migration only creates the empty table. The rows are loaded with
-- server/scripts/import-company-directory.mts from the file PDL lets you
-- download. Until then the Prospector simply hides the Companies tab.
--
-- CC BY 4.0 requires attribution: the Prospector shows a credit line under
-- every set of directory results. Keep it if you change that screen.
--
-- PDL company ids are not persistent between their quarterly releases, so a
-- refresh is a full reload: TRUNCATE company_directory; then import again.
--
-- Server-only: row level security on and no policies, because the browser
-- never reads it directly.


CREATE TABLE IF NOT EXISTS company_directory (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  name_key      text GENERATED ALWAYS AS (lower(name)) STORED,
  domain        text,
  linkedin_url  text,
  founded       integer,
  size          text,
  industry      text,
  country       text,
  region        text,
  locality      text,
  source        text NOT NULL DEFAULT 'pdl_free',
  imported_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_directory ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Indexes for the Prospector's filters
-- ---------------------------------------------------------------------------
--
-- Results are paged in id order, so each filter column is indexed together
-- with id: Postgres can then read one filter's matches already in page order
-- instead of sorting millions of rows.
--
-- Industry, country, region and locality are stored lower case by the
-- importer, so plain equality matches them.

CREATE INDEX IF NOT EXISTS company_directory_name_key_idx ON company_directory (name_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS company_directory_domain_idx   ON company_directory (domain);
CREATE INDEX IF NOT EXISTS company_directory_industry_idx ON company_directory (industry, id);
CREATE INDEX IF NOT EXISTS company_directory_country_idx  ON company_directory (country, id);
CREATE INDEX IF NOT EXISTS company_directory_region_idx   ON company_directory (region, id);
CREATE INDEX IF NOT EXISTS company_directory_locality_idx ON company_directory (locality, id);
CREATE INDEX IF NOT EXISTS company_directory_size_idx     ON company_directory (size, id);
