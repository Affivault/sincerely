-- 074: Standing searches, and the company-wide pause setting.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- 1. A standing search is a Prospector search that keeps running. On its
--    cadence it looks for people matching the filters who are new to the
--    account, reveals them (spending prospect credits, never more than its
--    daily cap), verifies each address, and enrols the good ones in a
--    campaign - with every check an enrolment by hand gets: suppression,
--    open deals, bounces. The pipeline refills without anybody touching it.
--
-- 2. pause_company_on_reply: when somebody replies interested or asks for a
--    meeting, pause the sequences still running to their colleagues. On by
--    default. The app already treats a missing column as "on", so running
--    this only makes the switch in Settings stick.

CREATE TABLE IF NOT EXISTS prospect_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  -- The same shape the Prospector search sends (ProspectSearchFilters).
  filters        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Where the people go. Either may be empty; a rule with neither still
  -- builds contacts, which is a legitimate way to grow a list slowly.
  campaign_id    uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  list_id        uuid,
  -- Most new people per run. This is also most credits spent per run.
  daily_cap      integer NOT NULL DEFAULT 10,
  cadence        text NOT NULL DEFAULT 'daily',
  -- Addresses verified below this DCS score are kept out of the campaign.
  min_score      integer NOT NULL DEFAULT 60,
  is_active      boolean NOT NULL DEFAULT true,
  next_run_at    timestamptz NOT NULL DEFAULT now(),
  last_run_at    timestamptz,
  -- What the last run did, for the UI: found, revealed, verified, enrolled,
  -- skipped with reasons, and why it stopped.
  last_result    jsonb,
  total_enrolled integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_rules_cadence_known') THEN
    ALTER TABLE prospect_rules ADD CONSTRAINT prospect_rules_cadence_known
      CHECK (cadence IN ('daily', 'weekdays', 'weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_rules_cap_sane') THEN
    ALTER TABLE prospect_rules ADD CONSTRAINT prospect_rules_cap_sane
      CHECK (daily_cap BETWEEN 1 AND 200);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_prospect_rules_user ON prospect_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_prospect_rules_due ON prospect_rules (next_run_at) WHERE is_active;

ALTER TABLE prospect_rules ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'prospect_rules'
       AND policyname = 'Users can manage their own prospect rules'
  ) THEN
    CREATE POLICY "Users can manage their own prospect rules"
      ON prospect_rules FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_rules_updated_at ON prospect_rules;
CREATE TRIGGER trg_prospect_rules_updated_at
  BEFORE UPDATE ON prospect_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS pause_company_on_reply boolean NOT NULL DEFAULT true;
