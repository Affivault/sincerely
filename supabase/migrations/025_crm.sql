-- 025: CRM — deals pipeline, tasks, and calendar events (calls/meetings).
-- Run in the Supabase SQL Editor. Idempotent.

-- Deals: a simple pipeline. `stage` is one of lead|qualified|proposal|won|lost.
CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  company text,
  contact_name text,
  contact_email text,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  value numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  stage text NOT NULL DEFAULT 'lead',
  expected_close_date date,
  notes text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_stage ON deals(user_id, stage);

-- Tasks: follow-ups, optionally tied to a deal.
CREATE TABLE IF NOT EXISTS crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  due_date timestamptz,
  is_done boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal',
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_name text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user ON crm_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user_due ON crm_tasks(user_id, due_date);

-- Events: booked calls/meetings, shown on the calendar. `type` is call|meeting.
CREATE TABLE IF NOT EXISTS crm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'meeting',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  contact_name text,
  contact_email text,
  location text,
  notes text,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_events_user ON crm_events(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_events_user_start ON crm_events(user_id, starts_at);

-- Reuse the shared updated_at trigger fn (created in 019); (re)create defensively.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deals_updated_at ON deals;
CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_tasks_updated_at ON crm_tasks;
CREATE TRIGGER trg_crm_tasks_updated_at BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_events_updated_at ON crm_events;
CREATE TRIGGER trg_crm_events_updated_at BEFORE UPDATE ON crm_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
