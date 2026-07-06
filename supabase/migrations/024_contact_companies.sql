-- Distinct company list (with counts) for a user's contacts, powering the
-- "view leads by company" filter on the Lead Lists page.
CREATE OR REPLACE FUNCTION contact_companies(uid uuid)
RETURNS TABLE(company text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company, count(*)::bigint AS count
  FROM contacts
  WHERE user_id = uid
    AND company IS NOT NULL
    AND btrim(company) <> ''
  GROUP BY company
  ORDER BY count(*) DESC, company ASC
  LIMIT 500;
$$;
