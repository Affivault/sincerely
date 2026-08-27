-- 054: Somewhere for a lead to be before it is a deal.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Somebody replies "interesting, send me more" and there were two options,
-- both wrong. Leave them as a contact and they are invisible to the
-- pipeline and forgotten. Create a deal and the forecast now contains a
-- tyre-kicker: the first stage fills with things nobody has qualified, and
-- every conversion rate and stage duration measured against it is a lie.
--
-- So leads live outside the pipeline until somebody decides they are real.
-- Same reasoning as a Leads Inbox in Pipedrive, with one difference that
-- matters here: this app sends the outbound as well as tracking it, so a
-- positive reply is itself the lead event and can be carried across with
-- the campaign and the conversation already attached.

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Always about somebody. Contacts already exist in this app, so a lead
  -- with no person attached would be a note with extra steps.
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  company text,
  company_id uuid,
  -- An estimate at best. Deliberately not required: guessing a number to
  -- satisfy a form is how a pipeline fills up with fiction.
  value numeric,
  currency text NOT NULL DEFAULT 'USD',
  label text,
  source text,
  -- The campaign that produced it, when it came from one.
  campaign_id uuid,
  note text,
  status text NOT NULL DEFAULT 'open',
  /*
   * Set when the lead becomes a deal. Kept rather than deleted so the
   * conversion rate from lead to deal is answerable at all, and so a
   * converted lead can still say where its deal went.
   */
  converted_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  converted_at timestamptz,
  archived_reason text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_known') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_status_known
      CHECK (status IN ('open', 'converted', 'archived'));
  END IF;

  -- Same three-way read as a deal carries, so a label means the same thing
  -- either side of conversion.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_label_known') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_label_known
      CHECK (label IS NULL OR label IN ('hot', 'warm', 'cold'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_value_non_negative') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_value_non_negative
      CHECK (value IS NULL OR value >= 0);
  END IF;
END;
$$;

-- The inbox itself: open leads for one user, newest first.
CREATE INDEX IF NOT EXISTS idx_leads_user_status
  ON leads (user_id, status, created_at DESC);

-- "Is this person already a lead?" - asked on every contact page and before
-- every conversion, so it should not be a scan.
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads (contact_id);

/*
 * One open lead per person. A second one is always a duplicate in practice
 * - two replies to two campaigns from the same person is one opportunity,
 * not two - and without this the inbox quietly doubles up and the
 * lead-to-deal conversion rate is computed against an inflated denominator.
 *
 * Partial, so converting or archiving a lead frees the person up to become
 * a lead again later, which is a real and different thing.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_one_open_per_contact
  ON leads (contact_id) WHERE status = 'open';

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Where a deal came from, when it came from a lead. The reverse link lives
 * on the lead as well; this side is what lets a deal page say "converted
 * from a lead that arrived on 3 March via the Q1 outbound campaign"
 * without a second query.
 */
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_lead ON deals (lead_id) WHERE lead_id IS NOT NULL;
