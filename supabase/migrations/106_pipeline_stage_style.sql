-- 106: Stage colours, stage notes and stage checklists.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
-- Needs 105 (pipelines and pipeline_stages) to have run first.
--
-- pipeline_stages.color        a colour from the app's palette, by name
--                              (slate, blue, indigo, violet, pink, rose,
--                              orange, amber, emerald, teal, cyan). Null
--                              means the colour of the stage's phase.
-- pipeline_stages.description  what is true of a deal in this stage, shown
--                              on the board and the deal page.
-- pipeline_stages.checklist    the things to get done in this stage, in
--                              order. Up to 10, each up to 120 characters.
-- deals.stage_checks           which checklist items are done on a deal,
--                              as { "<stage id>": ["item", ...] }.
--
-- Until this runs the app keeps working: colours fall back to the phase and
-- the editor hides notes and checklists.

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS checklist text[] NOT NULL DEFAULT '{}';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_checks jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_color_known') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_color_known
      CHECK (color IS NULL OR color IN ('slate','blue','indigo','violet','pink','rose','orange','amber','emerald','teal','cyan'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_description_length') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_description_length
      CHECK (description IS NULL OR char_length(description) <= 280);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_checklist_size') THEN
    ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_checklist_size
      CHECK (cardinality(checklist) <= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_stage_checks_object') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_stage_checks_object
      CHECK (jsonb_typeof(stage_checks) = 'object');
  END IF;
END $$;

-- Give the stages people already have a colour each, so the board is not
-- one shade the day this runs. Only stages that have none yet.
WITH ranked AS (
  SELECT id,
         (ARRAY['slate','blue','indigo','violet','amber','orange','emerald','teal','pink','cyan'])
           [1 + ((row_number() OVER (PARTITION BY pipeline_id ORDER BY position) - 1) % 10)::int] AS c
  FROM pipeline_stages
  WHERE color IS NULL
)
UPDATE pipeline_stages s SET color = r.c FROM ranked r WHERE s.id = r.id;

NOTIFY pgrst, 'reload schema';
