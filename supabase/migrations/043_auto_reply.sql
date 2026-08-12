-- 043: Telling a person from an autoresponder.
--
-- Every inbound email matched to a campaign was recorded as activity_type
-- 'replied'. An out-of-office bounce-back is an inbound email from the
-- prospect's own address, so a fortnight of annual leave counted as a reply:
-- it inflated the reply rate, halted the sequence when stop_on_reply was set,
-- fired an email.replied webhook, and could open a CRM deal — for a prospect
-- who never saw the message and would now never hear from you again.
--
-- Auto-replies get their own activity type from here, so every reply-rate
-- query (all of which filter on 'replied') excludes them without being
-- touched, and so the ones already recorded can be told apart.

-- What kind of machine sent it: 'out_of_office' or 'auto_reply'.
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS auto_reply_kind text;

ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS inbox_messages_auto_reply_kind_check;
ALTER TABLE inbox_messages
  ADD CONSTRAINT inbox_messages_auto_reply_kind_check
  CHECK (auto_reply_kind IS NULL OR auto_reply_kind IN ('out_of_office', 'auto_reply'));

-- The Unibox filters to real replies; without this it sequential-scans every
-- message the account has ever received.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_human_inbound
  ON inbox_messages (user_id, received_at DESC)
  WHERE direction = 'inbound' AND auto_reply_kind IS NULL;

-- Reply-rate queries count activity rows of type 'replied' for a campaign.
-- 'auto_reply' rows are a separate type, so they are excluded by construction
-- rather than by every caller remembering to exclude them.
CREATE INDEX IF NOT EXISTS idx_campaign_activities_auto_reply
  ON campaign_activities (campaign_id)
  WHERE activity_type = 'auto_reply';
