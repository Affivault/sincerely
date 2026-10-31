-- 105: Pipelines and stages you name yourself.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- No dependency on other pending migrations (104 can run before or after).
--
-- Deals had five fixed stages (lead, qualified, proposal, won, lost). Every
-- serious CRM lets a team run more than one pipeline and name its own
-- stages, each with its own odds and its own "this has gone quiet" limit.
--
-- How it fits the existing model:
--
--   pipelines         one row per pipeline, per user.
--   pipeline_stages   the open stages of a pipeline, in order. Each stage
--                     has a phase (lead, qualified or proposal) saying how
--                     far along it counts as. Reports, rot rules and
--                     automations that already read deals.stage keep
--                     working on that phase.
--   deals.pipeline_id / deals.stage_id
--                     where the deal sits. Won and lost stay in
--                     deals.stage; stage_id then remembers the last open
--                     stage, the same way Pipedrive keeps it.
--
-- A trigger keeps deals.stage and deals.stage_id in step whichever code path
-- writes the deal (board, form, booking link, reply automation, API).

CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_user ON pipelines (user_id, position);
-- At most one default pipeline per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_one_default
  ON pipelines (user_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT 'lead',
  probability integer,
  rot_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages (pipeline_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_user ON pipeline_stages (user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_phase_known') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_phase_known
      CHECK (phase IN ('lead', 'qualified', 'proposal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_probability_range') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_probability_range
      CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_rot_positive') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_rot_positive
      CHECK (rot_days IS NULL OR rot_days > 0);
  END IF;
END $$;

-- The server uses the service role. Nobody reads these with the anon key.
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_pipelines_updated_at ON pipelines;
CREATE TRIGGER trg_pipelines_updated_at BEFORE UPDATE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_pipeline_stages_updated_at ON pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_updated_at BEFORE UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON deals (pipeline_id, stage_id);

ALTER TABLE deal_stage_events ADD COLUMN IF NOT EXISTS from_stage_id uuid;
ALTER TABLE deal_stage_events ADD COLUMN IF NOT EXISTS to_stage_id uuid;

-- ---------------------------------------------------------------------------
-- The default pipeline. Created on first need, with five stages.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_default_pipeline(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM pipelines WHERE user_id = p_user AND is_default LIMIT 1;
  IF pid IS NOT NULL THEN
    RETURN pid;
  END IF;

  -- A user with pipelines but none marked default: promote the first.
  SELECT id INTO pid FROM pipelines WHERE user_id = p_user ORDER BY position, created_at LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE pipelines SET is_default = true WHERE id = pid;
    RETURN pid;
  END IF;

  BEGIN
    INSERT INTO pipelines (user_id, name, position, is_default)
    VALUES (p_user, 'Sales pipeline', 0, true)
    RETURNING id INTO pid;
  EXCEPTION WHEN unique_violation THEN
    -- Another request made it a moment ago. Use that one.
    SELECT id INTO pid FROM pipelines WHERE user_id = p_user AND is_default LIMIT 1;
    RETURN pid;
  END;

  INSERT INTO pipeline_stages (user_id, pipeline_id, name, position, phase, probability, rot_days) VALUES
    (p_user, pid, 'Lead',           0, 'lead',      10, 21),
    (p_user, pid, 'Qualified',      1, 'qualified', 30, 14),
    (p_user, pid, 'Meeting booked', 2, 'qualified', 45, 14),
    (p_user, pid, 'Proposal',       3, 'proposal',  60, 10),
    (p_user, pid, 'Negotiation',    4, 'proposal',  80, 10);

  RETURN pid;
END;
$$;

-- The stage in a pipeline that best stands for a phase: the first stage of
-- that phase, else the nearest earlier phase, else the first stage at all.
CREATE OR REPLACE FUNCTION pipeline_stage_for_phase(p_pipeline uuid, p_phase text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM pipeline_stages
  WHERE pipeline_id = p_pipeline
  ORDER BY
    CASE
      WHEN phase = p_phase THEN 0
      WHEN p_phase IN ('won', 'lost') THEN 0
      ELSE 1
    END,
    CASE
      WHEN p_phase IN ('won', 'lost') THEN -position
      -- Nearest phase first; on a tie the later phase wins, so an
      -- automation that moves a deal forward never moves it back.
      ELSE abs(
        (CASE phase WHEN 'lead' THEN 0 WHEN 'qualified' THEN 1 ELSE 2 END)
        - (CASE p_phase WHEN 'lead' THEN 0 WHEN 'qualified' THEN 1 ELSE 2 END)
      ) * 2000
      + (CASE WHEN (CASE phase WHEN 'lead' THEN 0 WHEN 'qualified' THEN 1 ELSE 2 END)
                 < (CASE p_phase WHEN 'lead' THEN 0 WHEN 'qualified' THEN 1 ELSE 2 END)
              THEN 1000 ELSE 0 END)
      + position
    END
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Keep stage (the phase or won/lost) and stage_id (the named stage) in step.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_deal_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st record;
  stage_moved boolean;
  id_moved boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    stage_moved := true;
    id_moved := NEW.stage_id IS NOT NULL;
  ELSE
    stage_moved := NEW.stage IS DISTINCT FROM OLD.stage;
    id_moved := NEW.stage_id IS DISTINCT FROM OLD.stage_id;
  END IF;

  -- A named stage was chosen: it decides the pipeline, and for an open deal
  -- it decides the phase too.
  IF id_moved AND NEW.stage_id IS NOT NULL THEN
    SELECT pipeline_id, phase INTO st FROM pipeline_stages WHERE id = NEW.stage_id;
    IF FOUND THEN
      NEW.pipeline_id := st.pipeline_id;
      IF NEW.stage NOT IN ('won', 'lost') THEN
        NEW.stage := st.phase;
      END IF;
      IF TG_OP = 'UPDATE' AND NOT stage_moved THEN
        NEW.stage_changed_at := now();
      END IF;
      RETURN NEW;
    END IF;
    NEW.stage_id := NULL;
  END IF;

  IF NEW.pipeline_id IS NULL THEN
    NEW.pipeline_id := ensure_default_pipeline(NEW.user_id);
  END IF;

  -- Moved by phase only (an older screen, an automation), or moved to
  -- another pipeline: find the stage in this pipeline that stands for it.
  IF NEW.stage_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id AND NOT id_moved)
     OR (stage_moved AND NEW.stage NOT IN ('won', 'lost')
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_stages s
           WHERE s.id = NEW.stage_id AND s.phase = NEW.stage AND s.pipeline_id = NEW.pipeline_id
         ))
  THEN
    NEW.stage_id := pipeline_stage_for_phase(NEW.pipeline_id, NEW.stage);
    -- The pipeline may not have a stage of that exact phase. An open deal
    -- then takes the phase of the stage it actually landed in.
    IF NEW.stage_id IS NOT NULL AND NEW.stage NOT IN ('won', 'lost') THEN
      SELECT phase INTO st FROM pipeline_stages WHERE id = NEW.stage_id;
      NEW.stage := st.phase;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      NEW.stage_changed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_sync_stage ON deals;
CREATE TRIGGER trg_deals_sync_stage
  BEFORE INSERT OR UPDATE OF stage, stage_id, pipeline_id ON deals
  FOR EACH ROW EXECUTE FUNCTION sync_deal_stage();

-- Stage history now records the named stage too, and a move between two
-- stages of the same phase (Qualified to Meeting booked) counts as a move.
CREATE OR REPLACE FUNCTION record_deal_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_events (user_id, deal_id, from_stage, to_stage, from_stage_id, to_stage_id, reason, changed_at)
    VALUES (NEW.user_id, NEW.id, NULL, NEW.stage, NULL, NEW.stage_id, NEW.outcome_reason,
            COALESCE(NEW.stage_changed_at, NEW.created_at, now()));
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_events (user_id, deal_id, from_stage, to_stage, from_stage_id, to_stage_id, reason, changed_at)
    VALUES (NEW.user_id, NEW.id, OLD.stage, NEW.stage, OLD.stage_id, NEW.stage_id, NEW.outcome_reason,
            COALESCE(NEW.stage_changed_at, now()));
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: every user with deals gets the default pipeline, and every deal
-- gets the stage that matches its phase. Triggers are paused so this does
-- not reset "days in stage" or write fake history rows.
-- ---------------------------------------------------------------------------
ALTER TABLE deals DISABLE TRIGGER USER;

DO $$
DECLARE
  u record;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM deals LOOP
    PERFORM ensure_default_pipeline(u.user_id);
  END LOOP;
END $$;

UPDATE deals d
   SET pipeline_id = p.id
  FROM pipelines p
 WHERE p.user_id = d.user_id
   AND p.is_default
   AND d.pipeline_id IS NULL;

UPDATE deals d
   SET stage_id = pipeline_stage_for_phase(d.pipeline_id, d.stage)
 WHERE d.stage_id IS NULL
   AND d.pipeline_id IS NOT NULL;

ALTER TABLE deals ENABLE TRIGGER USER;

DROP TRIGGER IF EXISTS trg_deals_stage_event ON deals;
CREATE TRIGGER trg_deals_stage_event
  AFTER INSERT OR UPDATE OF stage, stage_id, pipeline_id ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_event();

-- Existing history rows point at the stage the deal sits in now, where the
-- phase matches. Older moves keep their phase only.
UPDATE deal_stage_events e
   SET to_stage_id = d.stage_id
  FROM deals d
 WHERE e.deal_id = d.id
   AND e.to_stage_id IS NULL
   AND e.to_stage = d.stage
   AND d.stage_id IS NOT NULL;
