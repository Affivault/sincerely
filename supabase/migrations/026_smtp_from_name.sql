-- 026_smtp_from_name.sql
-- Give every sending account an explicit "From name" — the human display name
-- that recipients see (e.g. "Thomas Vance"), separate from the internal label/tag.
-- Previously the label doubled as the From name, so accounts with a provider-name
-- or domain label sent mail with a non-personal From. Backfill from the label so
-- existing accounts keep their current behaviour until edited.

ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS from_name text;

UPDATE smtp_accounts
SET from_name = label
WHERE from_name IS NULL AND label IS NOT NULL AND btrim(label) <> '';
