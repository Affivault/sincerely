-- 086: Re-importing a CSV fills gaps; it never blanks what is already there.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The import used to upsert on (user_id, email). PostgREST sends the union
-- of every row's columns, so a column one row left out was written as its
-- default: re-importing a file without a phone column set every existing
-- contact's phone to NULL, custom_fields was replaced wholesale, and the
-- contact's original source was overwritten with 'csv_import'.
--
-- This function is the import's write instead. For a new address it inserts
-- the row. For an existing one it only fills columns that are empty now,
-- merges custom_fields with the existing values winning, and never touches
-- source. It also says which rows were new, so the import can report
-- "12 new, 30 updated" rather than one number for both.
--
-- p_rows is a JSON array of objects. Only the keys named below are read, so
-- a caller cannot reach user_id, lifecycle or any other column through it.

CREATE OR REPLACE FUNCTION import_contacts_merge(p_user_id uuid, p_rows jsonb)
RETURNS TABLE (id uuid, email text, inserted boolean)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'import_contacts_merge: p_user_id is required';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT r.value AS r, r.ordinality AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality)
    WHERE jsonb_typeof(r.value) = 'object'
  ),
  cleaned AS (
    -- One row per address (the last one wins), or the upsert would try to
    -- update the same row twice and fail the whole batch.
    SELECT DISTINCT ON (lower(btrim(s.r->>'email')))
      lower(btrim(s.r->>'email'))                    AS email,
      NULLIF(btrim(s.r->>'first_name'), '')          AS first_name,
      NULLIF(btrim(s.r->>'last_name'), '')           AS last_name,
      NULLIF(btrim(s.r->>'company'), '')             AS company,
      NULLIF(btrim(s.r->>'job_title'), '')           AS job_title,
      NULLIF(btrim(s.r->>'phone'), '')               AS phone,
      NULLIF(btrim(s.r->>'linkedin_url'), '')        AS linkedin_url,
      NULLIF(btrim(s.r->>'website'), '')             AS website,
      NULLIF(btrim(s.r->>'location'), '')            AS location,
      CASE WHEN jsonb_typeof(s.r->'custom_fields') = 'object'
           THEN s.r->'custom_fields' ELSE '{}'::jsonb END AS custom_fields,
      COALESCE(NULLIF(btrim(s.r->>'source'), ''), 'csv_import') AS source,
      NULLIF(btrim(s.r->>'import_source'), '')       AS import_source,
      CASE WHEN NULLIF(btrim(s.r->>'import_source'), '') IS NOT NULL
           THEN now() ELSE NULL END                  AS imported_at
    FROM src s
    WHERE NULLIF(btrim(s.r->>'email'), '') IS NOT NULL
    ORDER BY lower(btrim(s.r->>'email')), s.ord DESC
  )
  INSERT INTO contacts AS c (
    user_id, email, first_name, last_name, company, job_title, phone,
    linkedin_url, website, location, custom_fields, source,
    import_source, imported_at
  )
  SELECT
    p_user_id, x.email, x.first_name, x.last_name, x.company, x.job_title, x.phone,
    x.linkedin_url, x.website, x.location, x.custom_fields, x.source,
    x.import_source, x.imported_at
  FROM cleaned x
  ON CONFLICT (user_id, email) DO UPDATE SET
    first_name    = COALESCE(NULLIF(c.first_name, ''),   EXCLUDED.first_name),
    last_name     = COALESCE(NULLIF(c.last_name, ''),    EXCLUDED.last_name),
    company       = COALESCE(NULLIF(c.company, ''),      EXCLUDED.company),
    job_title     = COALESCE(NULLIF(c.job_title, ''),    EXCLUDED.job_title),
    phone         = COALESCE(NULLIF(c.phone, ''),        EXCLUDED.phone),
    linkedin_url  = COALESCE(NULLIF(c.linkedin_url, ''), EXCLUDED.linkedin_url),
    website       = COALESCE(NULLIF(c.website, ''),      EXCLUDED.website),
    location      = COALESCE(NULLIF(c.location, ''),     EXCLUDED.location),
    -- Right-hand side wins in ||, so what is already there is kept.
    custom_fields = COALESCE(EXCLUDED.custom_fields, '{}'::jsonb) || COALESCE(c.custom_fields, '{}'::jsonb),
    -- source is deliberately absent: where a contact came from does not
    -- change because it later appeared in a spreadsheet.
    import_source = COALESCE(c.import_source, EXCLUDED.import_source),
    imported_at   = COALESCE(c.imported_at,   EXCLUDED.imported_at)
  RETURNING c.id, c.email, (c.xmax = 0) AS inserted;
END;
$$;

-- Server-only, like every other function since 084.
DO $$
DECLARE
  v_role text;
BEGIN
  REVOKE ALL ON FUNCTION import_contacts_merge(uuid, jsonb) FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION import_contacts_merge(uuid, jsonb) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION import_contacts_merge(uuid, jsonb) TO service_role;
  END IF;
END $$;
