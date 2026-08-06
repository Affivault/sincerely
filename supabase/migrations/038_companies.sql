-- ============================================================================
-- 038 — Companies as a first-class object
--
-- Until now "company" was a text field on a contact, which meant the app could
-- not answer "who else works at Acme, and what deals do we have there?" —
-- the data simply didn't model it. This adds a real companies table and links
-- contacts and deals to it.
--
-- IMPORTANT: this migration is NON-DESTRUCTIVE. It creates the structure and
-- leaves your data alone. Collapsing free-text names ("Acme", "Acme Ltd",
-- "acme.com") into single records is a judgement call about YOUR data, so it
-- is a separate, opt-in step:
--
--     SELECT * FROM preview_company_backfill();   -- see exactly what would happen
--     SELECT backfill_companies();                -- do it
--
-- The preview is safe to run as often as you like and changes nothing.
-- ============================================================================

-- ── Name normalisation ──────────────────────────────────────────────────────
-- The matching key. Two contacts belong to the same company when their raw
-- company text normalises to the same thing. Deliberately conservative: it
-- folds casing, punctuation, legal suffixes and domain forms, and nothing else.
CREATE OR REPLACE FUNCTION normalize_company_name(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              -- A bare domain identifies a company as well as its name does:
              -- strip the scheme, www. and everything from the first dot.
              CASE
                WHEN lower(btrim(raw)) ~ '^(https?://)?(www\.)?[a-z0-9-]+\.[a-z.]{2,}$'
                THEN regexp_replace(regexp_replace(lower(btrim(raw)), '^(https?://)?(www\.)?', ''), '\..*$', '')
                ELSE lower(btrim(raw))
              END,
              '^the\s+', ''                      -- leading article
            ),
            '[.,''`&()/]', '', 'g'               -- punctuation
          ),
          '(^|\s+)(ltd|limited|llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|gmbh|ag|bv|nv|plc|sa|srl|spa|pty|pte|oy|ab|as)\s*$',
          '', 'g'                                -- trailing legal suffix
        ),
        '\s*-\s*', ' ', 'g'                      -- hyphens as spaces
      ),
      '\s+', ' ', 'g'                            -- collapse whitespace
    ),
  '');
$$;

-- ── The table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  name         text NOT NULL,
  /** Matching key, maintained by trigger — never set this by hand. */
  normalized_name text,
  domain       text,
  website      text,
  industry     text,
  size         text,
  location     text,
  linkedin_url text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One company per normalised name per user. This is what stops a second
-- "Acme Ltd" appearing next to "Acme" the next time a CSV lands.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_user_normalized
  ON companies(user_id, normalized_name)
  WHERE normalized_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_user ON companies(user_id, name);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(user_id, domain);

CREATE OR REPLACE FUNCTION companies_set_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_name := normalize_company_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_normalize ON companies;
CREATE TRIGGER trg_companies_normalize
BEFORE INSERT OR UPDATE OF name ON companies
FOR EACH ROW EXECUTE FUNCTION companies_set_normalized();

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'companies' AND policyname = 'Users manage their own companies') THEN
    CREATE POLICY "Users manage their own companies" ON companies FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Links ───────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL: deleting a company must never delete people or deals.
-- The free-text `company` column stays as-is, so nothing breaks before the
-- backfill runs and nothing is lost after it.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE deals    ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_company    ON deals(company_id);

-- ── Preview: what WOULD the backfill do? ────────────────────────────────────
-- Returns one row per company that would be created, the raw spellings that
-- would collapse into it, and a flag for the ones worth eyeballing.
CREATE OR REPLACE FUNCTION preview_company_backfill(uid uuid DEFAULT NULL)
RETURNS TABLE (
  proposed_name  text,
  normalized     text,
  contacts       bigint,
  variants       text[],
  variant_count  int,
  needs_review   boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT
      c.user_id,
      btrim(c.company)                        AS raw,
      normalize_company_name(c.company)       AS norm
    FROM contacts c
    WHERE c.company IS NOT NULL
      AND btrim(c.company) <> ''
      AND (uid IS NULL OR c.user_id = uid)
      AND normalize_company_name(c.company) IS NOT NULL
  ),
  grouped AS (
    SELECT
      norm,
      count(*)                                        AS contacts,
      array_agg(DISTINCT raw ORDER BY raw)            AS variants,
      -- The most common spelling wins as the display name; ties break
      -- alphabetically so the result is deterministic.
      (array_agg(raw ORDER BY cnt DESC, raw))[1]      AS proposed_name
    FROM (
      SELECT norm, raw, count(*) OVER (PARTITION BY norm, raw) AS cnt
      FROM src
    ) t
    GROUP BY norm
  )
  SELECT
    proposed_name,
    norm,
    contacts,
    variants,
    array_length(variants, 1),
    -- Worth a human glance when several distinct spellings collapse together.
    array_length(variants, 1) > 1
  FROM grouped
  ORDER BY (array_length(variants, 1) > 1) DESC, contacts DESC, norm;
$$;

-- ── The backfill itself ─────────────────────────────────────────────────────
-- Creates a company per distinct normalised name and links contacts and deals
-- to it. Idempotent: re-running adopts anything new and relinks nothing that
-- is already correct. Never overwrites a company_id you set by hand.
CREATE OR REPLACE FUNCTION backfill_companies(uid uuid DEFAULT NULL)
RETURNS TABLE (companies_created bigint, contacts_linked bigint, deals_linked bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  created bigint := 0;
  linked_contacts bigint := 0;
  linked_deals bigint := 0;
BEGIN
  WITH src AS (
    SELECT
      c.user_id,
      btrim(c.company) AS raw,
      normalize_company_name(c.company) AS norm
    FROM contacts c
    WHERE c.company IS NOT NULL
      AND btrim(c.company) <> ''
      AND (uid IS NULL OR c.user_id = uid)
      AND normalize_company_name(c.company) IS NOT NULL
  ),
  best AS (
    SELECT user_id, norm, (array_agg(raw ORDER BY cnt DESC, raw))[1] AS name
    FROM (SELECT user_id, norm, raw, count(*) OVER (PARTITION BY user_id, norm, raw) AS cnt FROM src) t
    GROUP BY user_id, norm
  ),
  ins AS (
    INSERT INTO companies (user_id, name)
    SELECT user_id, name FROM best
    ON CONFLICT (user_id, normalized_name) WHERE normalized_name IS NOT NULL
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO created FROM ins;

  WITH upd AS (
    UPDATE contacts c
       SET company_id = co.id
      FROM companies co
     WHERE co.user_id = c.user_id
       AND co.normalized_name = normalize_company_name(c.company)
       AND c.company_id IS NULL
       AND (uid IS NULL OR c.user_id = uid)
    RETURNING 1
  )
  SELECT count(*) INTO linked_contacts FROM upd;

  WITH upd AS (
    UPDATE deals d
       SET company_id = co.id
      FROM companies co
     WHERE co.user_id = d.user_id
       AND co.normalized_name = normalize_company_name(d.company)
       AND d.company_id IS NULL
       AND d.company IS NOT NULL
       AND (uid IS NULL OR d.user_id = uid)
    RETURNING 1
  )
  SELECT count(*) INTO linked_deals FROM upd;

  RETURN QUERY SELECT created, linked_contacts, linked_deals;
END;
$$;
