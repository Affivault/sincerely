-- ============================================================================
-- 113 - Backups to OneDrive, Dropbox and S3-compatible storage.
--
-- The Google Drive backup (112) keeps a live spreadsheet. These keep files:
-- a "latest" folder rewritten a few minutes after anything changes, and a
-- dated copy every day, kept for 30 days (or however long is chosen).
--
-- 1. backup_destinations: one per account per provider. OAuth tokens or
--    S3 keys (encrypted by the server), where the files go, and how far
--    through the change queue it has read.
--
-- 2. backup_snapshots: the dated copies written, so the Backup page can
--    list them and old ones can be removed.
--
-- 3. backup_log and backup_state: the change log, kept once per account
--    and written into every destination's files.
--
-- 4. The change queue (112) now has several readers. Each keeps a cursor;
--    backup_prune() removes a change once every reader has passed it.
--    backup_is_on() now counts these destinations too, so the triggers
--    queue changes when any backup is on.
--
-- Depends on: 112 (backup_connections, backup_outbox). Safe to run more
-- than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_destinations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  provider         text NOT NULL,
  account_label    text,
  access_token     text,
  refresh_token    text,
  expires_at       timestamptz,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT true,
  cursor           bigint NOT NULL DEFAULT 0,
  keep_days        integer NOT NULL DEFAULT 30,
  needs_write      boolean NOT NULL DEFAULT true,
  busy_until       timestamptz,
  broken_at        timestamptz,
  broken_reason    text,
  last_error       text,
  last_write_at    timestamptz,
  last_snapshot_day date,
  last_bytes       bigint,
  last_counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backup_destinations_provider_known') THEN
    ALTER TABLE backup_destinations ADD CONSTRAINT backup_destinations_provider_known CHECK (provider IN ('onedrive', 'dropbox', 's3'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backup_destinations_keep_days_range') THEN
    ALTER TABLE backup_destinations ADD CONSTRAINT backup_destinations_keep_days_range CHECK (keep_days BETWEEN 1 AND 365);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_destinations_user_provider ON backup_destinations(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_backup_destinations_live ON backup_destinations(enabled, broken_at);

ALTER TABLE backup_destinations ENABLE ROW LEVEL SECURITY;
-- Tokens and keys live here: no policy, so only the server (service role) reads it.

DROP TRIGGER IF EXISTS trg_backup_destinations_updated_at ON backup_destinations;
CREATE TRIGGER trg_backup_destinations_updated_at BEFORE UPDATE ON backup_destinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id  uuid NOT NULL REFERENCES backup_destinations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  day             date NOT NULL,
  folder          text NOT NULL,
  files           integer NOT NULL DEFAULT 0,
  bytes           bigint NOT NULL DEFAULT 0,
  people          integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_snapshots_dest_day ON backup_snapshots(destination_id, day);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_user ON backup_snapshots(user_id, day DESC);
ALTER TABLE backup_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS backup_log (
  id       bigserial PRIMARY KEY,
  user_id  uuid NOT NULL,
  at       timestamptz NOT NULL,
  what     text NOT NULL,
  who      text,
  email    text,
  details  text
);

CREATE INDEX IF NOT EXISTS idx_backup_log_user ON backup_log(user_id, id);
ALTER TABLE backup_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS backup_state (
  user_id     uuid PRIMARY KEY,
  log_cursor  bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE backup_state ENABLE ROW LEVEL SECURITY;

-- The Google Drive backup reads the queue with a cursor now, like the rest.
ALTER TABLE backup_connections ADD COLUMN IF NOT EXISTS cursor bigint NOT NULL DEFAULT 0;
UPDATE backup_connections c
   SET cursor = COALESCE((SELECT min(o.id) - 1 FROM backup_outbox o WHERE o.user_id = c.user_id), (SELECT COALESCE(max(id), 0) FROM backup_outbox))
 WHERE c.cursor = 0;

-- Is any backup on for this account? Every trigger asks first.
CREATE OR REPLACE FUNCTION backup_is_on(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM backup_connections b
            WHERE b.user_id = p_user AND b.enabled AND b.broken_at IS NULL)
      OR EXISTS (
           SELECT 1 FROM backup_destinations d
            WHERE d.user_id = p_user AND d.enabled AND d.broken_at IS NULL);
$$;

REVOKE ALL ON FUNCTION backup_is_on(uuid) FROM PUBLIC;

-- Drop the changes every reader has passed. Returns how many went.
CREATE OR REPLACE FUNCTION backup_prune(p_user uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_min bigint;
  v_n   bigint;
BEGIN
  SELECT min(x.c) INTO v_min FROM (
    SELECT b.cursor AS c FROM backup_connections b
     WHERE b.user_id = p_user AND b.enabled AND b.broken_at IS NULL
    UNION ALL
    SELECT d.cursor FROM backup_destinations d
     WHERE d.user_id = p_user AND d.enabled AND d.broken_at IS NULL
    UNION ALL
    SELECT s.log_cursor FROM backup_state s
     WHERE s.user_id = p_user
       AND EXISTS (SELECT 1 FROM backup_destinations d
                    WHERE d.user_id = p_user AND d.enabled AND d.broken_at IS NULL)
  ) x;
  IF v_min IS NULL THEN
    DELETE FROM backup_outbox WHERE user_id = p_user;
  ELSE
    DELETE FROM backup_outbox WHERE user_id = p_user AND id <= v_min;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION backup_prune(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backup_prune(uuid) TO service_role;

-- The newest change id, for a reader starting from now.
CREATE OR REPLACE FUNCTION backup_head() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM backup_outbox_id_seq), 0);
$$;

REVOKE ALL ON FUNCTION backup_head() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backup_head() TO service_role;
