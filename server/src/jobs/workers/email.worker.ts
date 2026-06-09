import { Worker, Job } from 'bullmq';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { redisConnection } from '../../config/redis.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { decrypt } from '../../utils/encryption.js';
import { fireEvent } from '../../services/webhook.service.js';
import * as sse from '../../services/sse.service.js';

interface EmailJobData {
  campaignId: string;
  campaignContactId: string;
  contactId: string;
  stepId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  smtpAccountId: string;
}

/**
 * Inject a 1x1 tracking pixel into the HTML body for open tracking.
 */
function injectTrackingPixel(html: string, trackingId: string): string {
  const pixelUrl = `${env.TRACKING_BASE_URL}/api/track/open/${trackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;" alt="" />`;

  // Insert before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Rewrite links in HTML body to go through click tracker.
 * Skips mailto: links and unsubscribe links.
 */
function wrapLinks(html: string, trackingId: string): string {
  // Match href="..." in anchor tags
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url) => {
      // Don't wrap unsubscribe or tracking URLs
      if (url.includes('/api/track/') || url.includes('unsubscribe')) {
        return `href="${url}"`;
      }
      const encoded = Buffer.from(url).toString('base64url');
      const trackUrl = `${env.TRACKING_BASE_URL}/api/track/click/${trackingId}?url=${encoded}`;
      return `href="${trackUrl}"`;
    }
  );
}

/**
 * Generate a unique tracking ID for this email send.
 * Encodes campaign_contact_id + step_id + HMAC for verification.
 */
function generateTrackingId(campaignContactId: string, stepId: string): string {
  const payload = `${campaignContactId}:${stepId}`;
  const hmac = crypto.createHmac('sha256', env.TRACKING_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

export function startEmailWorker() {
  if (!redisConnection) {
    console.log('Email worker skipped — no Redis connection');
    return null;
  }
  const worker = new Worker<EmailJobData>(
    'email-sending',
    async (job: Job<EmailJobData>) => {
      const { campaignId, campaignContactId, contactId, stepId, to, subject, bodyHtml, bodyText } = job.data;
      console.log(`Processing email job ${job.id} to ${to}`);

      try {
        // 1. Get campaign with settings (use * to avoid failures when new columns aren't migrated)
        const { data: campaign } = await supabaseAdmin
          .from('campaigns')
          .select('*')
          .eq('id', campaignId)
          .single();

        if (!campaign) {
          throw new Error(`Campaign ${campaignId} not found`);
        }

        // 2. Select best SMTP sender via SSE (Smart Sharding Engine)
        let smtpAccount: any = null;

        // Try SSE selection first (multi-account pool)
        const sseResult = await sse.selectBestSender(campaign.user_id, campaignId);

        if (sseResult.account) {
          smtpAccount = sseResult.account;
          console.log(`SSE selected: ${sseResult.reason}`);
        } else if (campaign.smtp_account_id) {
          // Fallback to campaign's default SMTP account (no is_verified check)
          const { data: fallback } = await supabaseAdmin
            .from('smtp_accounts')
            .select('*')
            .eq('id', campaign.smtp_account_id)
            .single();
          smtpAccount = fallback;
          console.log(`Using campaign default SMTP: ${smtpAccount?.label || smtpAccount?.id}`);
        }

        // Last resort: try any active SMTP account for this user
        if (!smtpAccount) {
          const { data: anyAccount } = await supabaseAdmin
            .from('smtp_accounts')
            .select('*')
            .eq('user_id', campaign.user_id)
            .eq('is_active', true)
            .limit(1)
            .single();
          if (anyAccount) {
            smtpAccount = anyAccount;
            console.log(`Last resort SMTP: ${smtpAccount.label || smtpAccount.id} (not verified)`);
          }
        }

        if (!smtpAccount) {
          throw new Error('No SMTP account available for sending. Configure an SMTP account first.');
        }

        // 3. Decrypt SMTP password
        const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);

        // 4. Create nodemailer transporter
        const transporter = nodemailer.createTransport({
          host: smtpAccount.smtp_host,
          port: smtpAccount.smtp_port,
          secure: smtpAccount.smtp_secure,
          auth: {
            user: smtpAccount.smtp_user,
            pass: smtpPassword,
          },
          connectionTimeout: 15000,
          socketTimeout: 30000,
        });

        // 5. Prepare email with tracking (respect campaign settings)
        const trackingId = generateTrackingId(campaignContactId, stepId);
        let finalHtml = bodyHtml;

        // Unsubscribe link — only if campaign has include_unsubscribe enabled
        const unsubUrl = `${env.TRACKING_BASE_URL}/api/track/unsubscribe/${trackingId}`;
        if (campaign.include_unsubscribe === true) {
          // Replace {{unsubscribe_link}} merge tag
          finalHtml = finalHtml.replace(/\{\{unsubscribe_link\}\}/gi, unsubUrl);

          // Auto-append unsubscribe footer if no {{unsubscribe_link}} was in the template
          if (!bodyHtml.match(/\{\{unsubscribe_link\}\}/i)) {
            const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></div>`;
            if (finalHtml.includes('</body>')) {
              finalHtml = finalHtml.replace('</body>', `${footer}</body>`);
            } else {
              finalHtml += footer;
            }
          }
        } else {
          // Even when disabled, still replace the merge tag if user manually placed it
          finalHtml = finalHtml.replace(/\{\{unsubscribe_link\}\}/gi, unsubUrl);
        }

        if (campaign.track_clicks !== false) {
          finalHtml = wrapLinks(finalHtml, trackingId);
        }
        if (campaign.track_opens !== false) {
          finalHtml = injectTrackingPixel(finalHtml, trackingId);
        }

        // Generate a unique Message-ID for reply threading
        const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
        const messageId = `<${crypto.randomUUID()}@${domain}>`;

        // 6. Send the email
        const fromAddress = smtpAccount.label
          ? `"${smtpAccount.label.replace(/"/g, "'")}" <${smtpAccount.email_address}>`
          : smtpAccount.email_address;
        const mailOptions = {
          from: fromAddress,
          to,
          subject,
          html: finalHtml,
          text: bodyText,
          messageId,
          headers: {
            'X-SkySend-Campaign': campaignId,
            'X-SkySend-Contact': contactId,
            'X-SkySend-Step': stepId,
            ...(campaign.include_unsubscribe ? { 'List-Unsubscribe': `<${unsubUrl}>` } : {}),
          },
        };

        let info;
        try {
          info = await transporter.sendMail(mailOptions);
        } finally {
          transporter.close();
        }
        console.log(`Email sent to ${to} via ${smtpAccount.label || smtpAccount.smtp_host} - messageId: ${info.messageId}`);

        // 7. Record send in SSE (update account stats)
        await sse.recordSend(smtpAccount.id);

        // 8. Record campaign activity (sent)
        await supabaseAdmin
          .from('campaign_activities')
          .insert({
            campaign_id: campaignId,
            campaign_contact_id: campaignContactId,
            contact_id: contactId,
            step_id: stepId,
            activity_type: 'sent',
            message_id: messageId,
            metadata: {
              subject,
              to,
              smtp_account_id: smtpAccount.id,
              smtp_label: smtpAccount.label,
              tracking_id: trackingId,
            },
          });

        // 9. Fire webhook event for email sent
        if (campaign) {
          fireEvent(campaign.user_id, 'email.sent', {
            campaign_id: campaignId,
            contact_id: contactId,
            step_id: stepId,
            to,
            subject,
            message_id: messageId,
          }).catch((err: any) => console.error('[Email] Webhook fire error (email.sent):', err.message));
        }

        // 10. Advance to next step in sequence
        const { data: currentStep } = await supabaseAdmin
          .from('campaign_steps')
          .select('step_order')
          .eq('id', stepId)
          .single();

        if (currentStep) {
          const { data: allSteps } = await supabaseAdmin
            .from('campaign_steps')
            .select('step_order')
            .eq('campaign_id', campaignId)
            .order('step_order');

          const nextStepOrder = currentStep.step_order + 1;
          const hasMoreSteps = allSteps?.some((s: any) => s.step_order === nextStepOrder);

          if (hasMoreSteps) {
            // Use random delay between min-max seconds. Falls back to legacy single value.
            const delayMin = campaign.delay_between_emails_min ?? campaign.delay_between_emails ?? 60;
            const delayMax = campaign.delay_between_emails_max ?? campaign.delay_between_emails ?? 60;
            const effectiveMin = Math.min(delayMin, delayMax);
            const effectiveMax = Math.max(delayMin, delayMax);
            const delaySecs = effectiveMin + Math.floor(Math.random() * (effectiveMax - effectiveMin + 1));
            const nextSendAt = new Date(Date.now() + delaySecs * 1000);
            console.log(`[Email] Next step in ${delaySecs}s (range: ${delayMin}-${delayMax}s)`);
            await supabaseAdmin
              .from('campaign_contacts')
              .update({
                current_step_order: nextStepOrder,
                next_send_at: nextSendAt.toISOString(),
              })
              .eq('id', campaignContactId);
          } else {
            await supabaseAdmin
              .from('campaign_contacts')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
              })
              .eq('id', campaignContactId);

            fireEvent(campaign.user_id, 'campaign.completed', {
              campaign_id: campaignId,
              contact_id: contactId,
            }).catch((err: any) => console.error('[Email] Webhook fire error (campaign.completed):', err.message));
          }
        }

        console.log(`Email job ${job.id} completed - sent to ${to}`);
      } catch (err: any) {
        console.error(`Email job ${job.id} send error:`, err.message);

        // Check for bounce-type errors
        const isBounce = Number(err.responseCode) >= 500 || err.code === 'EENVELOPE';

        // Record appropriate activity
        await supabaseAdmin
          .from('campaign_activities')
          .insert({
            campaign_id: campaignId,
            campaign_contact_id: campaignContactId,
            contact_id: contactId,
            step_id: stepId,
            activity_type: isBounce ? 'bounced' : 'error',
            metadata: {
              error: err.message,
              code: err.code || err.responseCode,
              to,
            },
          });

        // If bounced, mark contact and DON'T retry (return instead of throw)
        if (isBounce) {
          await supabaseAdmin
            .from('campaign_contacts')
            .update({ status: 'bounced', next_send_at: null })
            .eq('id', campaignContactId);

          await supabaseAdmin
            .from('contacts')
            .update({ is_bounced: true })
            .eq('id', contactId);

          // Try to get SMTP account for bounce recording
          const { data: cam } = await supabaseAdmin
            .from('campaigns')
            .select('smtp_account_id')
            .eq('id', campaignId)
            .single();

          if (cam?.smtp_account_id) {
            await sse.recordBounce(cam.smtp_account_id).catch(() => {});
          }

          // Do NOT throw — bounced emails should not be retried
          console.log(`Email to ${to} bounced — not retrying`);
          return;
        }

        // Non-bounce errors: also nullify next_send_at to prevent sequence worker re-queuing
        await supabaseAdmin
          .from('campaign_contacts')
          .update({ next_send_at: null })
          .eq('id', campaignContactId);

        throw err; // Let BullMQ handle retries for transient errors only
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000, // Max 10 emails per second
      },
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`Email job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`Email job ${job.id} completed`);
  });

  return worker;
}
