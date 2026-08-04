-- 035: Third-party integrations (Slack, Discord, Telegram, Zapier, Make,
-- HubSpot, Pipedrive). Run in the Supabase SQL Editor. Idempotent.

-- One row per connected provider per user. `config` holds the provider
-- credentials (webhook URL, API token, …) — only ever read server-side via
-- the service-role key and redacted before being sent to the client.
CREATE TABLE IF NOT EXISTS user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  events text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON user_integrations(user_id);

-- Per-delivery log so the Integrations page can show what actually happened
-- (mirrors webhook_deliveries, but for provider dispatches).
CREATE TABLE IF NOT EXISTS integration_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  success boolean NOT NULL,
  detail text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_activity_integration
  ON integration_activity(integration_id, created_at DESC);
