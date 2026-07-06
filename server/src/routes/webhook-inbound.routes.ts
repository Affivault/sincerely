import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { resumeWebhookWait } from '../services/sequence.service.js';
import { isValidInboundWebhookToken } from '../utils/inbound-webhook-token.js';

/**
 * Inbound Webhook Routes
 *
 * Public endpoint for external systems to send webhook events that
 * can resume contacts in WebhookWait steps.
 *
 * POST /api/webhooks/inbound/:campaignId?token=<see getInboundWebhookToken>
 * Body: { event: string, contact_email: string, data?: any }
 */
export const webhookInboundRoutes = Router();

webhookInboundRoutes.post('/:campaignId', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const token = (req.query.token as string) ?? req.get('X-Webhook-Token');

    if (!isValidInboundWebhookToken(campaignId, token)) {
      res.status(401).json({ error: 'Invalid or missing webhook token' });
      return;
    }

    const { event, contact_email, data } = req.body;

    if (!event || !contact_email) {
      res.status(400).json({ error: 'event and contact_email are required' });
      return;
    }

    // Find the campaign contact that is waiting for this webhook event
    const { data: contacts } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, contact_id')
      .eq('campaign_id', campaignId)
      .eq('waiting_for_webhook', event);

    if (!contacts || contacts.length === 0) {
      res.status(200).json({ matched: 0, message: 'No contacts waiting for this event' });
      return;
    }

    // Filter to the specific contact by email
    const { data: matchingContacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('email', contact_email)
      .in('id', contacts.map((c: any) => c.contact_id));

    if (!matchingContacts || matchingContacts.length === 0) {
      res.status(200).json({ matched: 0, message: 'Contact not found or not waiting' });
      return;
    }

    // Resume each matching campaign contact
    let resumed = 0;
    for (const mc of matchingContacts) {
      const cc = contacts.find((c: any) => c.contact_id === mc.id);
      if (cc) {
        await resumeWebhookWait(cc.id, event);
        resumed++;
      }
    }

    res.json({ matched: resumed, message: `Resumed ${resumed} contact(s)` });
  } catch (err: any) {
    console.error('[Webhook Inbound] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});
