-- ============================================================================
-- 039 — LinkedIn as a campaign channel
--
-- Sequences have only ever been able to send email. This makes the channel a
-- property of the step, so a campaign can be "email, wait two days, connect on
-- LinkedIn, wait, message on LinkedIn, wait, email again".
--
-- On execution: LinkedIn has no public API for connection requests or messages
-- to people you aren't connected to. Every tool that claims otherwise is either
-- driving a browser with your session cookie (against LinkedIn's User Agreement
-- and a real account-restriction risk) or reselling someone who does. So the
-- engine ships in ASSISTED mode: a LinkedIn step becomes a task in your queue,
-- personalised and ready, with the profile one click away. The sequence waits
-- for you to complete it, then carries on by itself.
--
-- No new tables — `campaign_steps.step_type` is already free text, so the new
-- values need no constraint change. Everything below is a column that code in
-- this release actually reads.
--
-- Safe to run more than once.
-- ============================================================================

-- ── The step ────────────────────────────────────────────────────────────────
-- A connection request carries a note, which LinkedIn caps at 300 characters.
-- A LinkedIn message reuses body_text: it has no subject and no HTML.
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS linkedin_note text;

-- ── The task a step becomes ─────────────────────────────────────────────────
-- These columns are what let completing the task hand control back to the
-- sequence, instead of the touch dead-ending in the queue.
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS campaign_contact_id uuid;
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS campaign_step_id uuid;
/** Which channel this task is for: linkedin_connect / message / visit. */
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS channel text;
/** The exact words to send, already personalised, so the queue is copy-paste. */
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS payload text;
/** Where to go and do it — the contact's LinkedIn profile. */
ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS target_url text;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_campaign_contact
  ON crm_tasks(campaign_contact_id) WHERE campaign_contact_id IS NOT NULL;

-- Open channel work, which is what the Activities queue filters on.
CREATE INDEX IF NOT EXISTS idx_crm_tasks_channel_open
  ON crm_tasks(user_id, channel) WHERE channel IS NOT NULL AND is_done = false;

-- ── The contact parked on it ────────────────────────────────────────────────
-- While a human works the task, the contact has no next_send_at. This is the
-- only thing that can wake it, so it is also how a stuck contact is found.
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS waiting_for_task_id uuid;
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_waiting_task
  ON campaign_contacts(waiting_for_task_id) WHERE waiting_for_task_id IS NOT NULL;
