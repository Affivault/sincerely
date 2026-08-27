-- 052: Deals get everyone who is actually in them, plus a label and a source.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- A deal could name exactly one person. Real deals are not sold to one
-- person: there is a champion who wants it, a decision maker who signs it,
-- somebody in security or procurement who can stop it, and an end user who
-- has to live with it. Naming only one of them means the pipeline cannot
-- answer the two questions that decide whether a deal closes - do we have a
-- decision maker at all, and who is blocking this - and it means every
-- email from the other four never joins up with the deal they are about.
--
-- The primary contact stays on deals.contact_id. This table is everyone
-- else, which is the same split Pipedrive uses: one linked person, plus
-- participants.

CREATE TABLE IF NOT EXISTS deal_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- What they are to this deal. Free text so a team can use its own words,
  -- with a known set offered in the UI so the common answers stay countable.
  role text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per person per deal. Adding somebody twice is always a mistake,
-- and without this the second add silently doubles them in every list.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_participants_unique
  ON deal_participants (deal_id, contact_id);

-- The reverse lookup: every deal this person is involved in, which is what
-- makes their contact page tell the truth about their exposure.
CREATE INDEX IF NOT EXISTS idx_deal_participants_contact
  ON deal_participants (contact_id);
CREATE INDEX IF NOT EXISTS idx_deal_participants_user
  ON deal_participants (user_id);

-- Deal label: the three-way read every pipeline has, formally. Constrained
-- rather than free text because the whole value is being able to count them.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_label_known'
  ) THEN
    ALTER TABLE deals ADD CONSTRAINT deals_label_known
      CHECK (label IS NULL OR label IN ('hot', 'warm', 'cold'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_deals_user_label
  ON deals (user_id, label) WHERE label IS NOT NULL;
