-- ============================================================================
-- 111 - Import history with undo, and Google Sheets sync.
--
-- 1. import_runs: one row per import - a file, a paste, or a Google Sheet
--    sync run - with what it did (added, updated, held without an email,
--    errors). The Import history page lists them.
--
-- 2. import_run_contacts: the people each import ADDED (not the ones that
--    were already here). Undo deletes exactly these, days later if need be.
--    A contact deleted some other way drops out of here on its own, so the
--    count of rows is "still here".
--
-- 3. import_run_tally(): adds a batch's counts to its import in one
--    statement, so batches arriving close together cannot lose a count.
--
-- 4. sheet_syncs: a Google Sheet imported into a list on a schedule with a
--    saved column mapping. Each run fills in new rows and gaps; it never
--    blanks a field and never deletes anyone.
--
-- Depends on: 004 (contact_lists), 110 (nothing, but run after it).
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sheet_syncs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  name           text NOT NULL,
  sheet_url      text NOT NULL,
  list_id        uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
  kind           text NOT NULL DEFAULT 'lead',
  mapping        jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode           text NOT NULL DEFAULT 'fill',
  keep_held      boolean NOT NULL DEFAULT true,
  enabled        boolean NOT NULL DEFAULT true,
  every_hours    integer NOT NULL DEFAULT 24,
  next_run_at    timestamptz,
  last_run_at    timestamptz,
  last_status    text,
  last_error     text,
  last_import_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_syncs_kind_known') THEN
    ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_kind_known CHECK (kind IN ('lead', 'contact'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_syncs_mode_known') THEN
    ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_mode_known CHECK (mode IN ('fill', 'overwrite', 'skip'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_syncs_every_hours_range') THEN
    ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_every_hours_range CHECK (every_hours BETWEEN 1 AND 168);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sheet_syncs_user ON sheet_syncs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_syncs_due ON sheet_syncs(next_run_at) WHERE enabled;

ALTER TABLE sheet_syncs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sheet_syncs' AND policyname = 'Users manage their own sheet syncs') THEN
    CREATE POLICY "Users manage their own sheet syncs" ON sheet_syncs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sheet_syncs_updated_at ON sheet_syncs;
CREATE TRIGGER trg_sheet_syncs_updated_at BEFORE UPDATE ON sheet_syncs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS import_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  source        text,
  origin        text NOT NULL DEFAULT 'file',
  list_id       uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
  sheet_sync_id uuid REFERENCES sheet_syncs(id) ON DELETE SET NULL,
  kind          text NOT NULL DEFAULT 'lead',
  status        text NOT NULL DEFAULT 'running',
  total         integer NOT NULL DEFAULT 0,
  created       integer NOT NULL DEFAULT 0,
  updated       integer NOT NULL DEFAULT 0,
  held          integer NOT NULL DEFAULT 0,
  errors        integer NOT NULL DEFAULT 0,
  undone_count  integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  undone_at     timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_runs_origin_known') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_origin_known CHECK (origin IN ('file', 'paste', 'sheet', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_runs_status_known') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_status_known CHECK (status IN ('running', 'done', 'cancelled', 'failed', 'undone'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_runs_kind_known') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_kind_known CHECK (kind IN ('lead', 'contact'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_runs_user ON import_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_runs_sync ON import_runs(sheet_sync_id, started_at DESC);

ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_runs' AND policyname = 'Users manage their own import runs') THEN
    CREATE POLICY "Users manage their own import runs" ON import_runs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS import_run_contacts (
  import_id  uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  PRIMARY KEY (import_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_import_run_contacts_contact ON import_run_contacts(contact_id);

ALTER TABLE import_run_contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_run_contacts' AND policyname = 'Users manage their own import run contacts') THEN
    CREATE POLICY "Users manage their own import run contacts" ON import_run_contacts FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION import_run_tally(
  p_id uuid,
  p_user_id uuid,
  p_created integer,
  p_updated integer,
  p_errors integer,
  p_held integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE import_runs
     SET created = created + GREATEST(COALESCE(p_created, 0), 0),
         updated = updated + GREATEST(COALESCE(p_updated, 0), 0),
         errors  = errors  + GREATEST(COALESCE(p_errors, 0), 0),
         held    = held    + GREATEST(COALESCE(p_held, 0), 0)
   WHERE id = p_id AND user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION import_run_tally(uuid, uuid, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_run_tally(uuid, uuid, integer, integer, integer, integer) TO service_role;
