-- Distinguishes "webhook actually received" from "webhook wait timed out" so
-- a `webhook_received` condition step after a `webhook_wait` step can branch
-- correctly. Both resumeWebhookWait() and processWebhookTimeouts() previously
-- cleared the same waiting_for_webhook/webhook_wait_until columns, so a
-- condition step couldn't tell the two outcomes apart.
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz;
