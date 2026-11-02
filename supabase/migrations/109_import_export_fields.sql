-- ============================================================================
-- 109 - Import and export: the fields other tools send, and a choice of
--       what a re-import does to people already here.
--
-- 1. Contacts get country, city, state and industry as real columns. They
--    used to arrive from every CSV and land in custom fields, where they
--    could not be filtered, segmented or used cleanly as merge tags.
-- 2. Companies get a phone (the HQ / switchboard number lead tools export).
-- 3. import_contacts_merge gains a third argument, p_mode:
--      'fill'      - existing people only get their empty fields filled
--                    (what it always did, and still the default)
--      'overwrite' - values in the file replace what is stored; a blank
--                    cell in the file still never blanks a stored value
--      'skip'      - existing people are left exactly as they are
--    and it now fills the company record: a row with a company name and
--    company details (website, LinkedIn, size, industry, location, phone)
--    finds or creates that company, using the same normalised-name match
--    as migration 038, and links the contact to it.
--
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country  text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city     text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state    text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS industry text;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_contacts_user_country  ON contacts(user_id, country);
CREATE INDEX IF NOT EXISTS idx_contacts_user_industry ON contacts(user_id, industry);

-- The two-argument version is replaced, not overloaded: with both present,
-- a call naming only p_user_id and p_rows would be ambiguous.
DROP FUNCTION IF EXISTS import_contacts_merge(uuid, jsonb);

CREATE OR REPLACE FUNCTION import_contacts_merge(p_user_id uuid, p_rows jsonb, p_mode text DEFAULT 'fill')
RETURNS TABLE (id uuid, email text, inserted boolean)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_mode text := CASE WHEN p_mode IN ('fill', 'overwrite', 'skip') THEN p_mode ELSE 'fill' END;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'import_contacts_merge: p_user_id is required';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN;
  END IF;

  -- Companies first, so the contacts below can be linked to them.
  WITH src AS (
    SELECT r.value AS r, r.ordinality AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality)
    WHERE jsonb_typeof(r.value) = 'object'
  ),
  co AS (
    SELECT DISTINCT ON (normalize_company_name(btrim(s.r->>'company')))
      btrim(s.r->>'company')                          AS name,
      NULLIF(btrim(s.r->>'company_website'), '')      AS website,
      NULLIF(btrim(s.r->>'company_linkedin'), '')     AS linkedin_url,
      NULLIF(btrim(s.r->>'company_size'), '')         AS size,
      NULLIF(btrim(s.r->>'company_industry'), '')     AS industry,
      NULLIF(btrim(s.r->>'company_location'), '')     AS location,
      NULLIF(btrim(s.r->>'company_phone'), '')        AS phone
    FROM src s
    WHERE NULLIF(btrim(s.r->>'company'), '') IS NOT NULL
      AND normalize_company_name(btrim(s.r->>'company')) IS NOT NULL
      AND (
        NULLIF(btrim(s.r->>'company_website'), '') IS NOT NULL OR
        NULLIF(btrim(s.r->>'company_linkedin'), '') IS NOT NULL OR
        NULLIF(btrim(s.r->>'company_size'), '') IS NOT NULL OR
        NULLIF(btrim(s.r->>'company_industry'), '') IS NOT NULL OR
        NULLIF(btrim(s.r->>'company_location'), '') IS NOT NULL OR
        NULLIF(btrim(s.r->>'company_phone'), '') IS NOT NULL
      )
    ORDER BY normalize_company_name(btrim(s.r->>'company')), s.ord DESC
  )
  INSERT INTO companies AS k (user_id, name, website, domain, linkedin_url, size, industry, location, phone)
  SELECT
    p_user_id, co.name, co.website,
    NULLIF(lower(regexp_replace(regexp_replace(co.website, '^(https?://)?(www\.)?', '', 'i'), '[/:?#].*$', '')), ''),
    co.linkedin_url, co.size, co.industry, co.location, co.phone
  FROM co
  ON CONFLICT (user_id, normalized_name) WHERE normalized_name IS NOT NULL DO UPDATE SET
    website      = CASE v_mode WHEN 'skip' THEN k.website      WHEN 'overwrite' THEN COALESCE(EXCLUDED.website, k.website)           ELSE COALESCE(NULLIF(k.website, ''), EXCLUDED.website) END,
    domain       = CASE v_mode WHEN 'skip' THEN k.domain       WHEN 'overwrite' THEN COALESCE(EXCLUDED.domain, k.domain)             ELSE COALESCE(NULLIF(k.domain, ''), EXCLUDED.domain) END,
    linkedin_url = CASE v_mode WHEN 'skip' THEN k.linkedin_url WHEN 'overwrite' THEN COALESCE(EXCLUDED.linkedin_url, k.linkedin_url) ELSE COALESCE(NULLIF(k.linkedin_url, ''), EXCLUDED.linkedin_url) END,
    size         = CASE v_mode WHEN 'skip' THEN k.size         WHEN 'overwrite' THEN COALESCE(EXCLUDED.size, k.size)                 ELSE COALESCE(NULLIF(k.size, ''), EXCLUDED.size) END,
    industry     = CASE v_mode WHEN 'skip' THEN k.industry     WHEN 'overwrite' THEN COALESCE(EXCLUDED.industry, k.industry)         ELSE COALESCE(NULLIF(k.industry, ''), EXCLUDED.industry) END,
    location     = CASE v_mode WHEN 'skip' THEN k.location     WHEN 'overwrite' THEN COALESCE(EXCLUDED.location, k.location)         ELSE COALESCE(NULLIF(k.location, ''), EXCLUDED.location) END,
    phone        = CASE v_mode WHEN 'skip' THEN k.phone        WHEN 'overwrite' THEN COALESCE(EXCLUDED.phone, k.phone)               ELSE COALESCE(NULLIF(k.phone, ''), EXCLUDED.phone) END;

  RETURN QUERY
  WITH src AS (
    SELECT r.value AS r, r.ordinality AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality)
    WHERE jsonb_typeof(r.value) = 'object'
  ),
  cleaned AS (
    SELECT DISTINCT ON (lower(btrim(s.r->>'email')))
      lower(btrim(s.r->>'email'))                    AS email,
      NULLIF(btrim(s.r->>'first_name'), '')          AS first_name,
      NULLIF(btrim(s.r->>'last_name'), '')           AS last_name,
      NULLIF(btrim(s.r->>'company'), '')             AS company,
      NULLIF(btrim(s.r->>'job_title'), '')           AS job_title,
      NULLIF(btrim(s.r->>'phone'), '')               AS phone,
      NULLIF(btrim(s.r->>'linkedin_url'), '')        AS linkedin_url,
      -- A file with only a company website still gives the contact one,
      -- which is what the {{website}} merge tag has always meant.
      COALESCE(NULLIF(btrim(s.r->>'website'), ''), NULLIF(btrim(s.r->>'company_website'), '')) AS website,
      NULLIF(btrim(s.r->>'location'), '')            AS location,
      NULLIF(btrim(s.r->>'country'), '')             AS country,
      NULLIF(btrim(s.r->>'city'), '')                AS city,
      NULLIF(btrim(s.r->>'state'), '')               AS state,
      NULLIF(btrim(s.r->>'industry'), '')            AS industry,
      CASE WHEN jsonb_typeof(s.r->'custom_fields') = 'object'
           THEN s.r->'custom_fields' ELSE '{}'::jsonb END AS custom_fields,
      COALESCE(NULLIF(btrim(s.r->>'source'), ''), 'csv_import') AS source,
      NULLIF(btrim(s.r->>'import_source'), '')       AS import_source,
      CASE WHEN NULLIF(btrim(s.r->>'import_source'), '') IS NOT NULL
           THEN now() ELSE NULL END                  AS imported_at
    FROM src s
    WHERE NULLIF(btrim(s.r->>'email'), '') IS NOT NULL
    ORDER BY lower(btrim(s.r->>'email')), s.ord DESC
  ),
  linked AS (
    SELECT x.*, k.id AS company_id
    FROM cleaned x
    LEFT JOIN companies k
      ON k.user_id = p_user_id
     AND x.company IS NOT NULL
     AND k.normalized_name = normalize_company_name(x.company)
  )
  INSERT INTO contacts AS c (
    user_id, email, first_name, last_name, company, company_id, job_title, phone,
    linkedin_url, website, location, country, city, state, industry,
    custom_fields, source, import_source, imported_at
  )
  SELECT
    p_user_id, x.email, x.first_name, x.last_name, x.company, x.company_id, x.job_title, x.phone,
    x.linkedin_url, x.website, x.location, x.country, x.city, x.state, x.industry,
    x.custom_fields, x.source, x.import_source, x.imported_at
  FROM linked x
  ON CONFLICT (user_id, email) DO UPDATE SET
    first_name    = CASE v_mode WHEN 'skip' THEN c.first_name   WHEN 'overwrite' THEN COALESCE(EXCLUDED.first_name, c.first_name)     ELSE COALESCE(NULLIF(c.first_name, ''),   EXCLUDED.first_name) END,
    last_name     = CASE v_mode WHEN 'skip' THEN c.last_name    WHEN 'overwrite' THEN COALESCE(EXCLUDED.last_name, c.last_name)       ELSE COALESCE(NULLIF(c.last_name, ''),    EXCLUDED.last_name) END,
    company       = CASE v_mode WHEN 'skip' THEN c.company      WHEN 'overwrite' THEN COALESCE(EXCLUDED.company, c.company)           ELSE COALESCE(NULLIF(c.company, ''),      EXCLUDED.company) END,
    company_id    = CASE v_mode WHEN 'skip' THEN c.company_id   WHEN 'overwrite' THEN COALESCE(EXCLUDED.company_id, c.company_id)     ELSE COALESCE(c.company_id,               EXCLUDED.company_id) END,
    job_title     = CASE v_mode WHEN 'skip' THEN c.job_title    WHEN 'overwrite' THEN COALESCE(EXCLUDED.job_title, c.job_title)       ELSE COALESCE(NULLIF(c.job_title, ''),    EXCLUDED.job_title) END,
    phone         = CASE v_mode WHEN 'skip' THEN c.phone        WHEN 'overwrite' THEN COALESCE(EXCLUDED.phone, c.phone)               ELSE COALESCE(NULLIF(c.phone, ''),        EXCLUDED.phone) END,
    linkedin_url  = CASE v_mode WHEN 'skip' THEN c.linkedin_url WHEN 'overwrite' THEN COALESCE(EXCLUDED.linkedin_url, c.linkedin_url) ELSE COALESCE(NULLIF(c.linkedin_url, ''), EXCLUDED.linkedin_url) END,
    website       = CASE v_mode WHEN 'skip' THEN c.website      WHEN 'overwrite' THEN COALESCE(EXCLUDED.website, c.website)           ELSE COALESCE(NULLIF(c.website, ''),      EXCLUDED.website) END,
    location      = CASE v_mode WHEN 'skip' THEN c.location     WHEN 'overwrite' THEN COALESCE(EXCLUDED.location, c.location)         ELSE COALESCE(NULLIF(c.location, ''),     EXCLUDED.location) END,
    country       = CASE v_mode WHEN 'skip' THEN c.country      WHEN 'overwrite' THEN COALESCE(EXCLUDED.country, c.country)           ELSE COALESCE(NULLIF(c.country, ''),      EXCLUDED.country) END,
    city          = CASE v_mode WHEN 'skip' THEN c.city         WHEN 'overwrite' THEN COALESCE(EXCLUDED.city, c.city)                 ELSE COALESCE(NULLIF(c.city, ''),         EXCLUDED.city) END,
    state         = CASE v_mode WHEN 'skip' THEN c.state        WHEN 'overwrite' THEN COALESCE(EXCLUDED.state, c.state)               ELSE COALESCE(NULLIF(c.state, ''),        EXCLUDED.state) END,
    industry      = CASE v_mode WHEN 'skip' THEN c.industry     WHEN 'overwrite' THEN COALESCE(EXCLUDED.industry, c.industry)         ELSE COALESCE(NULLIF(c.industry, ''),     EXCLUDED.industry) END,
    custom_fields = CASE v_mode
                      WHEN 'skip'      THEN c.custom_fields
                      WHEN 'overwrite' THEN COALESCE(c.custom_fields, '{}'::jsonb) || COALESCE(EXCLUDED.custom_fields, '{}'::jsonb)
                      ELSE COALESCE(EXCLUDED.custom_fields, '{}'::jsonb) || COALESCE(c.custom_fields, '{}'::jsonb)
                    END,
    import_source = COALESCE(c.import_source, EXCLUDED.import_source),
    imported_at   = COALESCE(c.imported_at,   EXCLUDED.imported_at)
  RETURNING c.id, c.email, (c.xmax = 0) AS inserted;
END;
$$;

DO $$
DECLARE
  v_role text;
BEGIN
  REVOKE ALL ON FUNCTION import_contacts_merge(uuid, jsonb, text) FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION import_contacts_merge(uuid, jsonb, text) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION import_contacts_merge(uuid, jsonb, text) TO service_role;
  END IF;
END $$;

-- PostgREST caches function signatures; tell it the argument list changed.
NOTIFY pgrst, 'reload schema';
