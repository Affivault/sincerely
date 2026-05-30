import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { fireEvent } from '../services/webhook.service.js';
import * as sse from '../services/sse.service.js';

const router = Router();

// 1x1 transparent GIF pixel
const TRANSPARENT_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

/**
 * Parse and verify a tracking ID.
 * Format: base64url(campaignContactId:stepId:hmac)
 */
function parseTrackingId(trackingId: string): { campaignContactId: string; stepId: string } | null {
  try {
    const decoded = Buffer.from(trackingId, 'base64url').toString('utf8');
    const [campaignContactId, stepId, hmac] = decoded.split(':');

    if (!campaignContactId || !stepId || !hmac) return null;

    // Verify HMAC
    const payload = `${campaignContactId}:${stepId}`;
    const expectedHmac = crypto
      .createHmac('sha256', env.TRACKING_SECRET)
      .update(payload)
      .digest('hex')
      .slice(0, 16);

    if (hmac !== expectedHmac) return null;

    return { campaignContactId, stepId };
  } catch {
    return null;
  }
}

/**
 * GET /api/track/open/:trackingId
 * Records an email open event and returns a 1x1 transparent pixel.
 */
router.get('/open/:trackingId', async (req: Request, res: Response) => {
  // Always return the pixel immediately, even if tracking fails
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(TRANSPARENT_PIXEL.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });

  const parsed = parseTrackingId(req.params.trackingId);
  if (!parsed) {
    return res.end(TRANSPARENT_PIXEL);
  }

  const { campaignContactId, stepId } = parsed;

  try {
    // Get campaign contact info
    const { data: cc } = await supabaseAdmin
      .from('campaign_contacts')
      .select('campaign_id, contact_id, campaigns(user_id, smtp_account_id)')
      .eq('id', campaignContactId)
      .single();

    if (!cc) {
      return res.end(TRANSPARENT_PIXEL);
    }

    // Check if we already recorded an open for this step (deduplicate)
    const { count } = await supabaseAdmin
      .from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_contact_id', campaignContactId)
      .eq('step_id', stepId)
      .eq('activity_type', 'opened');

    if (!count || count === 0) {
      // Record the open activity
      await supabaseAdmin
        .from('campaign_activities')
        .insert({
          campaign_id: cc.campaign_id,
          campaign_contact_id: campaignContactId,
          contact_id: cc.contact_id,
          step_id: stepId,
          activity_type: 'opened',
          metadata: {
            ip: req.ip,
            user_agent: req.headers['user-agent'],
          },
        });

      // Update SSE health for the account that actually sent this email.
      // Look up the send activity first so SSE credits the right account when
      // a different sender was chosen by the Smart-Sharding Engine.
      const { data: sendActivity } = await supabaseAdmin
        .from('campaign_activities')
        .select('metadata')
        .eq('campaign_contact_id', campaignContactId)
        .eq('step_id', stepId)
        .eq('activity_type', 'sent')
        .single();
      const openSmtpId =
        sendActivity?.metadata?.smtp_account_id ||
        (cc as any).campaigns?.smtp_account_id;
      if (openSmtpId) {
        sse.recordOpen(openSmtpId).catch(() => {});
      }

      // Fire webhook event
      if ((cc as any).campaigns?.user_id) {
        fireEvent((cc as any).campaigns.user_id, 'email.opened', {
          campaign_id: cc.campaign_id,
          contact_id: cc.contact_id,
          step_id: stepId,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Tracking open error:', err);
  }

  return res.end(TRANSPARENT_PIXEL);
});

/**
 * GET /api/track/click/:trackingId?url=<base64url-encoded-url>
 * Records a click event and redirects to the original URL.
 */
router.get('/click/:trackingId', async (req: Request, res: Response) => {
  const parsed = parseTrackingId(req.params.trackingId);
  const encodedUrl = req.query.url as string;

  if (!encodedUrl) {
    return res.status(400).send('Missing URL');
  }

  // Decode the original URL
  let originalUrl: string;
  try {
    originalUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');
  } catch {
    return res.status(400).send('Invalid URL');
  }

  // Validate URL to prevent open redirect
  try {
    const parsed_url = new URL(originalUrl);
    if (!['http:', 'https:'].includes(parsed_url.protocol)) {
      return res.status(400).send('Invalid URL protocol');
    }
  } catch {
    return res.status(400).send('Invalid URL format');
  }

  if (!parsed) {
    return res.redirect(302, originalUrl);
  }

  const { campaignContactId, stepId } = parsed;

  try {
    // Get campaign contact info
    const { data: cc } = await supabaseAdmin
      .from('campaign_contacts')
      .select('campaign_id, contact_id, campaigns(user_id)')
      .eq('id', campaignContactId)
      .single();

    if (cc) {
      // Deduplicate: only record one click per contact per step (same logic as open tracking)
      const { count: alreadyClicked } = await supabaseAdmin
        .from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_contact_id', campaignContactId)
        .eq('step_id', stepId)
        .eq('activity_type', 'clicked');

      if (!alreadyClicked || alreadyClicked === 0) {
        await supabaseAdmin
          .from('campaign_activities')
          .insert({
            campaign_id: cc.campaign_id,
            campaign_contact_id: campaignContactId,
            contact_id: cc.contact_id,
            step_id: stepId,
            activity_type: 'clicked',
            metadata: {
              url: originalUrl,
              ip: req.ip,
              user_agent: req.headers['user-agent'],
            },
          });

        // Fire webhook event
        if ((cc as any).campaigns?.user_id) {
          fireEvent((cc as any).campaigns.user_id, 'email.clicked', {
            campaign_id: cc.campaign_id,
            contact_id: cc.contact_id,
            step_id: stepId,
            url: originalUrl,
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Tracking click error:', err);
  }

  return res.redirect(302, originalUrl);
});

/**
 * GET /api/track/unsubscribe/:trackingId
 * Unsubscribe a contact from further emails. Shows confirmation page.
 */
router.get('/unsubscribe/:trackingId', async (req: Request, res: Response) => {
  const parsed = parseTrackingId(req.params.trackingId);

  if (!parsed) {
    return res.status(400).send('<html><body><h2>Invalid link</h2></body></html>');
  }

  const { campaignContactId, stepId } = parsed;

  try {
    const { data: cc } = await supabaseAdmin
      .from('campaign_contacts')
      .select('campaign_id, contact_id, campaigns(user_id)')
      .eq('id', campaignContactId)
      .single();

    if (cc) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'unsubscribed', next_send_at: null })
        .eq('id', campaignContactId);

      await supabaseAdmin
        .from('contacts')
        .update({ is_unsubscribed: true })
        .eq('id', cc.contact_id);

      await supabaseAdmin
        .from('campaign_activities')
        .insert({
          campaign_id: cc.campaign_id,
          campaign_contact_id: campaignContactId,
          contact_id: cc.contact_id,
          step_id: stepId,
          activity_type: 'unsubscribed',
          metadata: { method: 'link_click' },
        });

      if ((cc as any).campaigns?.user_id) {
        fireEvent((cc as any).campaigns.user_id, 'lead.unsubscribed', {
          campaign_id: cc.campaign_id,
          contact_id: cc.contact_id,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Unsubscribe error:', err);
  }

  return res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — SkySend</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#f0f0ff 0%,#f9fafb 50%,#fff5f5 100%);color:#111;padding:1rem}
  .card{text-align:center;padding:2.5rem 2rem;max-width:420px;width:100%;background:#fff;border-radius:20px;box-shadow:0 4px 24px rgba(99,102,241,.08),0 1px 4px rgba(0,0,0,.06)}
  .icon-wrap{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#6366F1,#8B5CF6);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem}
  .icon-wrap svg{width:32px;height:32px;stroke:#fff;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:1.3rem;font-weight:700;color:#111;margin-bottom:.625rem;letter-spacing:-.01em}
  p{color:#6b7280;font-size:.875rem;line-height:1.6}
  .divider{width:48px;height:2px;background:linear-gradient(90deg,#6366F1,#8B5CF6);border-radius:2px;margin:1.25rem auto}
  .footer{margin-top:2rem;font-size:.75rem;color:#9ca3af}
  .footer a{color:#6366F1;text-decoration:none;font-weight:500}
</style>
</head><body>
<div class="card">
  <div class="icon-wrap">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h1>You're unsubscribed</h1>
  <div class="divider"></div>
  <p>You've been successfully removed from this mailing list and won't receive any more emails from this campaign.</p>
  <p style="margin-top:.75rem">If this was a mistake, please reply directly to the sender's email to be re-added.</p>
</div>
<div class="footer">Powered by <a href="https://skysend.io" target="_blank" rel="noopener">SkySend</a></div>
</body></html>`);
});

export { router as trackingRoutes };
