-- 017: Free-text location on contacts (e.g. "London, England, United Kingdom").
-- Populated via manual entry, CSV import mapping, or enrichment; surfaced as
-- an optional column on the Leads table.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS location text;
