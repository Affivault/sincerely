-- ============================================================================
-- 115 - The public API (v1): safe retries, a request log, and webhooks in
--       the v1 event format.
--
-- 1. api_idempotency_keys: a POST, PATCH or DELETE sent with an
--    Idempotency-Key header is done once. Sending it again (a network retry,
--    a Zapier replay) returns the first answer instead of doing it twice.
--    Kept 24 hours.
--
-- 2. api_request_log: every public API request (method, path, status, time
--    taken, error code), so Settings > Developer can show what a script or
--    integration actually did. Kept 14 days.
--
-- 3. webhook_endpoints.format / .source: endpoints created through the API
--    (and by Zapier, Make and n8n) receive the v1 event format - one stable
--    shape with the full contact and campaign - while every existing endpoint
--    keeps the payload it was built against ('legacy').
--
-- Depends on: webhook_endpoints, api_keys. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  user_id       uuid NOT NULL,
  idem_key      text NOT NULL,
  method        text NOT NULL,
  path          text NOT NULL,
  request_hash  text NOT NULL,
  status        integer,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency_keys(created_at);
ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policy: only the server (service role) reads or writes it.

CREATE TABLE IF NOT EXISTS api_request_log (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,
  api_key_id   uuid,
  request_id   text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  status       integer NOT NULL,
  duration_ms  integer NOT NULL DEFAULT 0,
  error_code   text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_request_log_user ON api_request_log(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_created ON api_request_log(created_at);
ALTER TABLE api_request_log ENABLE ROW LEVEL SECURITY;
-- No policy: read through the server, scoped to the account.

ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'legacy';
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_format_known') THEN
    ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_format_known CHECK (format IN ('legacy', 'v1'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_source_known') THEN
    ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_source_known CHECK (source IN ('app', 'api', 'zapier', 'make', 'n8n'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user_format ON webhook_endpoints(user_id, format) WHERE is_active;
