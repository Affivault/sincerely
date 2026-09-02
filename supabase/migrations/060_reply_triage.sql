-- 060: Remember what a reply was decided to be.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Triage shipped without this and so was not really a feature: the decision
-- lived in a React component's state, which meant reloading the page put an
-- already-triaged thread back at the start, offering to decide it again.
-- There was also no way to ask the only question that makes an inbox
-- workable - "what have I not dealt with yet?" - because nothing recorded
-- that anything had been dealt with.
--
-- Four columns. What was decided, when, by which account, and what the
-- decision produced. That last one is what makes the action reversible: to
-- undo a triage you have to know which lead or which task it created, and
-- guessing from timestamps is how you delete the wrong row.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS triage_decision text,
  ADD COLUMN IF NOT EXISTS triaged_at      timestamptz,
  ADD COLUMN IF NOT EXISTS triaged_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The lead or task this decision created, so undoing can remove exactly it.
  ADD COLUMN IF NOT EXISTS triage_ref      uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_triage_decision_known') THEN
    ALTER TABLE inbox_messages ADD CONSTRAINT inbox_triage_decision_known
      CHECK (triage_decision IS NULL
             OR triage_decision IN ('interested', 'later', 'not_interested'));
  END IF;

  -- A decision with no timestamp cannot be ordered, undone or reported on,
  -- and a timestamp with no decision is not a decision.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_triage_complete') THEN
    ALTER TABLE inbox_messages ADD CONSTRAINT inbox_triage_complete
      CHECK ((triage_decision IS NULL AND triaged_at IS NULL)
             OR (triage_decision IS NOT NULL AND triaged_at IS NOT NULL));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The queue.
--
-- "Inbound replies I have not decided about yet", which is the query the
-- inbox is actually for and the one that runs on every page load. Partial,
-- because the answered ones are the overwhelming majority over time and
-- indexing them wastes the space that makes this fast.
--
-- Auto-replies are excluded here rather than in the application: an
-- out-of-office is not a reply anybody needs to triage, and leaving them in
-- means the count is wrong in the one direction that makes people ignore it.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inbox_needs_triage
  ON inbox_messages (user_id, received_at DESC)
  WHERE triage_decision IS NULL
    AND direction = 'inbound'
    AND auto_reply_kind IS NULL;

-- Reporting the other way: what was decided, and how often.
CREATE INDEX IF NOT EXISTS idx_inbox_triaged
  ON inbox_messages (user_id, triage_decision, triaged_at DESC)
  WHERE triage_decision IS NOT NULL;

-- Existing mail is deliberately left untriaged rather than backfilled as
-- decided. Marking history as handled would empty the queue on day one and
-- hide every reply somebody has not actually answered.
