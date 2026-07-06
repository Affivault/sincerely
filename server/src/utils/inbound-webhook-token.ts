import crypto from 'crypto';
import { env } from '../config/env.js';

// Deterministic per-campaign token so the public, unauthenticated inbound
// webhook endpoint can't be driven by anyone who merely guesses/leaks a
// campaignId. The owner fetches their token via the authenticated
// GET /campaigns/:id/webhook-token route and includes it when configuring
// the external system that calls back into POST /api/webhooks/inbound/:id.
export function getInboundWebhookToken(campaignId: string): string {
  return crypto.createHmac('sha256', env.TRACKING_SECRET).update(`inbound-webhook:${campaignId}`).digest('hex').slice(0, 32);
}

export function isValidInboundWebhookToken(campaignId: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || !provided) return false;
  const expected = Buffer.from(getInboundWebhookToken(campaignId), 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
