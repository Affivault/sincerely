import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/encryption.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { fireEvent } from './webhook.service.js';
import * as sse from './sse.service.js';
import { checkAndAutoCompleteCampaign } from './sequence.service.js';

/**
 * Email Sender Service
 *
 * Sends emails via Vercel SMTP relay (when SMTP_RELAY_URL is set)
 * or directly via nodemailer. The relay bypasses Render's SMTP port block.
 */

interface SmtpSendParams {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  messageId?: string;
  headers?: Record<string, string>;
  /** Optional Reply-To header */
  replyTo?: string;
  /** Override SMTP handshake/socket timeouts (ms). Interactive test sends use
   *  a short budget so the API replies well before the client's 30s timeout. */
  timeoutMs?: number;
}

/** Turn a raw SMTP/relay error into a short, human, actionable message. */
export function describeSmtpError(err: any): string {
  const raw = String(err?.message || err || '').toLowerCase();
  if (raw.includes('invalid login') || raw.includes('auth') || raw.includes('535') || raw.includes('credentials') || raw.includes('username and password'))
    return 'Authentication failed — check the username/password. Gmail & Outlook need an app password, not your normal login.';
  if (raw.includes('etimedout') || raw.includes('timeout') || raw.includes('timed out'))
    return 'Connection timed out — the SMTP host/port may be wrong or your provider blocks this port. Try port 465 (SSL) or 587 (TLS).';
  if (raw.includes('econnrefused'))
    return 'Connection refused — double-check the SMTP host and port.';
  if (raw.includes('enotfound') || raw.includes('getaddrinfo'))
    return 'SMTP host not found — check the server address (e.g. smtp.gmail.com).';
  if (raw.includes('certificate') || raw.includes('self signed') || raw.includes('self-signed'))
    return 'TLS certificate problem — try toggling SSL/TLS, or use port 465 with SSL.';
  if (raw.includes('greeting'))
    return 'The server never sent a greeting — wrong port or SSL/TLS setting. Try 465 (SSL) or 587 (TLS).';
  return err?.message || 'Could not connect to the mail server.';
}

interface SmtpSendResult {
  messageId: string;
  accepted?: string[];
  rejected?: string[];
}

/**
 * Build an RFC 5322 From header from a display name and address:
 * `"Thomas Vance" <thomas@acme.com>`. Falls back to the bare address when no
 * name is given, and escapes quotes in the name.
 */
export function formatFromHeader(name: string | null | undefined, email: string): string {
  const clean = (name || '').trim();
  if (!clean) return email;
  return `"${clean.replace(/"/g, '\\"')}" <${email}>`;
}

/**
 * Send an email via Vercel SMTP relay (HTTPS) or direct SMTP.
 * When SMTP_RELAY_URL is configured, sends via relay to bypass port blocks.
 * Otherwise falls back to direct nodemailer SMTP.
 */
export async function sendViaSmtp(params: SmtpSendParams): Promise<SmtpSendResult> {
  if (env.SMTP_RELAY_URL && env.SMTP_RELAY_SECRET) {
    return sendViaRelay(params);
  }
  return sendDirect(params);
}

async function sendViaRelay(params: SmtpSendParams): Promise<SmtpSendResult> {
  console.log(`[SMTP Relay] Sending to ${params.to} via ${env.SMTP_RELAY_URL}`);

  let response: Response;
  try {
    response = await fetch(env.SMTP_RELAY_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SMTP_RELAY_SECRET}`,
      },
      body: JSON.stringify({
        smtp_host: params.smtpHost,
        smtp_port: params.smtpPort,
        smtp_secure: params.smtpSecure,
        smtp_user: params.smtpUser,
        smtp_pass: params.smtpPass,
        from: params.from,
        to: params.to,
        reply_to: params.replyTo,
        subject: params.subject,
        html: params.html,
        text: params.text,
        message_id: params.messageId,
        headers: params.headers,
      }),
    });
  } catch (err: any) {
    // Relay host unreachable (DNS/network) — fall back to a direct SMTP attempt
    // rather than hard-failing the send.
    console.warn(`[SMTP Relay] Unreachable (${err.message}); falling back to direct SMTP`);
    return sendDirect(params);
  }

  // A misconfigured or missing relay endpoint returns 404, and reverse proxies
  // return 5xx as HTML. In either case the relay isn't usable, so fall back to
  // a direct SMTP send instead of surfacing an opaque "non-JSON response" error.
  if (response.status === 404 || response.status === 405 || response.status >= 500) {
    console.warn(`[SMTP Relay] Endpoint returned HTTP ${response.status}; falling back to direct SMTP`);
    return sendDirect(params);
  }

  // Relay may still return non-JSON (e.g. an HTML error page) — parse safely.
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    console.warn(`[SMTP Relay] Non-JSON response (HTTP ${response.status}); falling back to direct SMTP`);
    return sendDirect(params);
  }

  if (!response.ok || !data.success) {
    throw new Error(`SMTP relay error: ${data.error || response.statusText}`);
  }

  return {
    messageId: data.messageId || params.messageId || '',
    accepted: data.accepted,
    rejected: data.rejected,
  };
}

async function sendDirect(params: SmtpSendParams): Promise<SmtpSendResult> {
  console.log(`[SMTP Direct] Sending to ${params.to} via ${params.smtpHost}:${params.smtpPort}`);

  // Resolve the SMTP host to an IP over DNS-over-HTTPS first. Managed hosts
  // often break system DNS (port 53), so nodemailer's built-in lookup hangs
  // and the send "times out" before a socket is even opened. Connecting by IP
  // with tls.servername set keeps TLS/cert validation correct.
  const ip = await resolveHostIp(params.smtpHost).catch(() => null);
  const connectHost = ip || params.smtpHost;

  // greetingTimeout is the usual culprit behind a hung "Send test" — without
  // it, a wrong port/SSL combo makes nodemailer wait indefinitely for a banner.
  const budget = params.timeoutMs;
  const transporter = nodemailer.createTransport({
    host: connectHost,
    port: params.smtpPort,
    secure: params.smtpSecure,
    auth: { user: params.smtpUser, pass: params.smtpPass },
    // Validate the certificate against the real hostname even when we dialed an IP.
    tls: { servername: params.smtpHost },
    connectionTimeout: budget ?? 15000,
    greetingTimeout: budget ?? 12000,
    socketTimeout: budget ? budget + 3000 : 30000,
  });

  let info;
  try {
    info = await transporter.sendMail({
      from: params.from,
      to: params.to,
      replyTo: params.replyTo || undefined,
      subject: params.subject,
      html: params.html || undefined,
      text: params.text || undefined,
      messageId: params.messageId || undefined,
      headers: params.headers || undefined,
    });
  } finally {
    transporter.close();
  }

  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
  };
}

interface SendEmailParams {
  campaignId: string;
  campaignContactId: string;
  contactId: string;
  stepId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  ab_variant?: 'a' | 'b';
}

function generateTrackingId(campaignContactId: string, stepId: string): string {
  const payload = `${campaignContactId}:${stepId}`;
  const hmac = crypto.createHmac('sha256', env.TRACKING_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function injectTrackingPixel(html: string, trackingId: string): string {
  const pixelUrl = `${env.TRACKING_BASE_URL}/api/track/open/${trackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

function wrapLinks(html: string, trackingId: string): string {
  return html.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (_match, quote, url) => {
      if (url.includes('/api/track/') || url.includes('unsubscribe')) {
        return `href=${quote}${url}${quote}`;
      }
      const encoded = Buffer.from(url).toString('base64url');
      const trackUrl = `${env.TRACKING_BASE_URL}/api/track/click/${trackingId}?url=${encoded}`;
      return `href=${quote}${trackUrl}${quote}`;
    }
  );
}

/**
 * Send a single campaign email directly via the user's SMTP account.
 */
export async function sendCampaignEmail(params: SendEmailParams): Promise<void> {
  const { campaignId, campaignContactId, contactId, stepId, to, subject, bodyHtml, bodyText } = params;
  console.log(`[EmailSender] Sending to ${to} (campaign: ${campaignId}, step: ${stepId})`);

  // 1. Get campaign settings
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  // 2. Find SMTP account
  let smtpAccount: any = null;

  // Try SSE selection (multi-account pool)
  const sseResult = await sse.selectBestSender(campaign.user_id, campaignId);
  if (sseResult.account) {
    smtpAccount = sseResult.account;
    console.log(`[EmailSender] SSE selected: ${sseResult.reason}`);
  } else if (campaign.smtp_account_id) {
    const { data: fallback } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', campaign.smtp_account_id)
      .eq('user_id', campaign.user_id)
      .single();
    smtpAccount = fallback;
    console.log(`[EmailSender] Using campaign default SMTP: ${smtpAccount?.label || smtpAccount?.id}`);
  }

  // Last resort: any active AND verified SMTP account for this user. We require
  // is_verified so we never try to send from an unverified/dead mailbox (which
  // would just fail every send); SSE selection already enforces the same.
  if (!smtpAccount) {
    const { data: anyAccount } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', campaign.user_id)
      .eq('is_active', true)
      .eq('is_verified', true)
      .limit(1)
      .maybeSingle();
    if (anyAccount) {
      smtpAccount = anyAccount;
      console.log(`[EmailSender] Last resort SMTP: ${smtpAccount.label || smtpAccount.id}`);
    }
  }

  if (!smtpAccount) {
    throw new Error('No SMTP account available. Add and configure an SMTP account first.');
  }

  // 3. Decrypt SMTP password
  let smtpPassword: string;
  try {
    smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
  } catch (err: any) {
    throw new Error(`Failed to decrypt SMTP password for ${smtpAccount.label}: ${err.message}`);
  }

  // 4. Prepare email with tracking
  const trackingId = generateTrackingId(campaignContactId, stepId);
  let finalHtml = bodyHtml;

  const unsubUrl = `${env.TRACKING_BASE_URL}/api/track/unsubscribe/${trackingId}`;
  if (campaign.include_unsubscribe === true) {
    finalHtml = finalHtml.replace(/\{\{unsubscribe_link\}\}/gi, unsubUrl);
    if (!bodyHtml.match(/\{\{unsubscribe_link\}\}/i)) {
      const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></div>`;
      finalHtml = finalHtml.includes('</body>')
        ? finalHtml.replace('</body>', `${footer}</body>`)
        : finalHtml + footer;
    }
  } else {
    finalHtml = finalHtml.replace(/\{\{unsubscribe_link\}\}/gi, unsubUrl);
  }

  if (campaign.track_clicks !== false) {
    finalHtml = wrapLinks(finalHtml, trackingId);
  }
  if (campaign.track_opens !== false) {
    finalHtml = injectTrackingPixel(finalHtml, trackingId);
  }

  // 5. Send via relay (Vercel) or direct SMTP
  const domain = (smtpAccount.email_address || '').split('@')[1] || 'usesincerely.com';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const emailHeaders: Record<string, string> = {
    'X-Sincerely-Campaign': campaignId,
    'X-Sincerely-Contact': contactId,
    'X-Sincerely-Step': stepId,
    ...(campaign.include_unsubscribe === true ? {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } : {}),
  };

  const fromAddress = formatFromHeader(smtpAccount.from_name || smtpAccount.label, smtpAccount.email_address);

  let sendResult;
  try {
    sendResult = await sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      from: fromAddress,
      to,
      replyTo: smtpAccount.reply_to || undefined,
      subject,
      html: finalHtml,
      text: bodyText,
      messageId,
      headers: emailHeaders,
    });
  } catch (err: any) {
    // Annotate the error with the account that attempted the send so callers
    // can record the bounce/failure against the correct SMTP account rather
    // than falling back to campaign.smtp_account_id (which may differ when
    // SSE selected a different sender).
    err.smtpAccountId = smtpAccount.id;
    throw err;
  }

  console.log(`[EmailSender] Sent to ${to} via ${smtpAccount.label || smtpAccount.smtp_host} — messageId: ${sendResult.messageId}`);

  // 7. Record send in SSE
  await sse.recordSend(smtpAccount.id).catch((err: any) => {
    console.warn(`[EmailSender] SSE record failed for account ${smtpAccount.id}:`, err.message);
  });

  // 8. Record campaign activity
  const { error: activityError } = await supabaseAdmin
    .from('campaign_activities')
    .insert({
      campaign_id: campaignId,
      campaign_contact_id: campaignContactId,
      contact_id: contactId,
      step_id: stepId,
      activity_type: 'sent',
      message_id: messageId,
      occurred_at: new Date().toISOString(),
      metadata: {
        subject, to,
        smtp_account_id: smtpAccount.id,
        smtp_label: smtpAccount.label,
        tracking_id: trackingId,
        ...(params.ab_variant ? { ab_variant: params.ab_variant } : {}),
      },
    });
  if (activityError) {
    console.error(`[EmailSender] Failed to record campaign activity for ${to}:`, activityError.message);
  }

  // 9. Fire webhook
  fireEvent(campaign.user_id, 'email.sent', {
    campaign_id: campaignId,
    contact_id: contactId,
    step_id: stepId,
    to, subject,
    message_id: messageId,
  }).catch(() => {});

  // 10. Advance to next step
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
      const delayMin = campaign.delay_between_emails_min ?? campaign.delay_between_emails ?? 60;
      const delayMax = campaign.delay_between_emails_max ?? campaign.delay_between_emails ?? 60;
      const effectiveMin = Math.min(delayMin, delayMax);
      const effectiveMax = Math.max(delayMin, delayMax);
      const delaySecs = effectiveMin + Math.floor(Math.random() * (effectiveMax - effectiveMin + 1));
      const nextSendAt = new Date(Date.now() + delaySecs * 1000);
      console.log(`[EmailSender] Next step in ${delaySecs}s (range: ${delayMin}-${delayMax}s)`);
      const { error: advanceError } = await supabaseAdmin
        .from('campaign_contacts')
        .update({ current_step_order: nextStepOrder, next_send_at: nextSendAt.toISOString() })
        .eq('id', campaignContactId);
      // The email is already sent — never throw after a successful send, or the
      // caller marks the contact errored and re-sends this step next run
      // (duplicate email). Log the advancement failure instead.
      if (advanceError) console.error(`[EmailSender] Sent OK but failed to advance contact ${campaignContactId}: ${advanceError.message}`);
    } else {
      const { error: completeError } = await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', campaignContactId);
      if (completeError) console.error(`[EmailSender] Sent OK but failed to complete contact ${campaignContactId}: ${completeError.message}`);

      // Flip the campaign itself to completed once every contact has finished, and
      // fire the campaign-wide (not per-contact) 'campaign.completed' webhook exactly once.
      checkAndAutoCompleteCampaign(campaignId).catch(() => {});
    }
  }
}
