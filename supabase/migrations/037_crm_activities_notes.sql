-- ============================================================================
-- 037 — CRM depth: real activities, notes, and contact provenance
--
-- Three things this unlocks:
--   1. Tasks and events point at a real contact, not a copied-in name string,
--      so a contact's profile can show its own history and renaming a contact
--      never orphans anything.
--   2. Notes exist as first-class records against a contact and/or a deal —
--      the missing half of "what happened with this person".
--   3. Contacts remember which import they came from, so a lead's origin is
--      answerable a year later.
-- Idempotent; safe to re-run.
-- ============================================================================

-- ── Contacts: where did this lead come from? ────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS import_source text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS imported_at   timestamptz;
CREATE INDEX IF NOT EXISTS idx_contacts_import_source ON contacts(user_id, import_source);

-- ── Tasks become activities (Pipedrive's model) ─────────────────────────────
-- type distinguishes a call from a meeting from a plain to-do; completed_at
-- records WHEN, which is what "completed today" and streaks need.
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS type         text NOT NULL DEFAULT 'todo';
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS all_day      boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user_done_due ON crm_tasks(user_id, is_done, due_date);

-- Anything already ticked off predates completed_at; treat its last update as
-- the completion time so historical rows still group correctly.
UPDATE crm_tasks SET completed_at = COALESCE(updated_at, created_at, now())
 WHERE is_done = true AND completed_at IS NULL;

-- ── Events gain the same contact link, plus all-day support ─────────────────
ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS all_day    boolean NOT NULL DEFAULT false;
ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS outcome    text;
CREATE INDEX IF NOT EXISTS idx_crm_events_contact ON crm_events(contact_id);

-- ── Notes ───────────────────────────────────────────────────────────────────
-- A note can hang off a contact, a deal, or both. Pinned notes float to the
-- top of a profile — the "always read this first" line about an account.
CREATE TABLE IF NOT EXISTS crm_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id    uuid REFERENCES deals(id)    ON DELETE CASCADE,
  body       text NOT NULL,
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_notes_user    ON crm_notes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_notes_contact ON crm_notes(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_notes_deal    ON crm_notes(deal_id, created_at DESC);

ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_notes' AND policyname = 'Users manage their own notes') THEN
    CREATE POLICY "Users manage their own notes" ON crm_notes FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_crm_notes_updated_at ON crm_notes;
CREATE TRIGGER trg_crm_notes_updated_at BEFORE UPDATE ON crm_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Backfill the contact link from the email we already stored ──────────────
-- Events recorded a contact_email; where that matches a contact this user
-- owns, wire it up so existing history appears on the right profile.
UPDATE crm_events e
   SET contact_id = c.id
  FROM contacts c
 WHERE e.contact_id IS NULL
   AND e.contact_email IS NOT NULL
   AND c.user_id = e.user_id
   AND lower(c.email) = lower(e.contact_email);

UPDATE crm_tasks t
   SET contact_id = d.contact_id
  FROM deals d
 WHERE t.contact_id IS NULL
   AND t.deal_id = d.id
   AND d.contact_id IS NOT NULL;
