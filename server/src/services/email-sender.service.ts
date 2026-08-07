import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/encryption.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { fireEvent } from './webhook.service.js';
import * as sse from './sse.service.js';
import { checkAndAutoCompleteCampaign } from './sequence.service.js';
import { warmupAllowance } from '@lemlist/shared';
import { isLinkedinStep } from '@lemlist/shared';

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

/**
 * Turn a raw SMTP/relay error into a short, human, actionable message.
 *
 * `withRelayHint: false` suppresses the "your host may be blocking SMTP"
 * advice — callers that have already proven the port is reachable (e.g. the
 * staged diagnostics) would otherwise print misleading guidance.
 */
export function describeSmtpError(err: any, opts?: { withRelayHint?: boolean }): string {
  const raw = String(err?.message || err || '').toLowerCase();
  const wantHint = opts?.withRelayHint !== false;
  const relayActive = !!(env.SMTP_RELAY_URL && env.SMTP_RELAY_SECRET);
  // A timeout with no relay configured almost always means the hosting
  // platform blocks outbound SMTP entirely (Render/Railway do) — no amount of
  // host/port fiddling will fix that; the Vercel relay will.
  const relayHint = !wantHint ? ''
    : relayActive
      ? ' Sends are meant to route through your SMTP relay, so a direct timeout means the relay didn’t handle this one — check it is deployed and its secret matches.'
      : env.SMTP_RELAY_URL
        ? ' SMTP_RELAY_URL is set but SMTP_RELAY_SECRET is not, so the relay is inactive and sends are going direct. Set both to activate it.'
        : ' If this keeps happening on every port, your hosting provider is blocking outbound SMTP — set SMTP_RELAY_URL + SMTP_RELAY_SECRET to route sends through the bundled Vercel relay (/api/send-email).';
  if (raw.includes('invalid login') || raw.includes('auth') || raw.includes('535') || raw.includes('credentials') || raw.includes('username and password'))
    return 'Authentication failed — check the username/password. Gmail & Outlook need an app password, not your normal login.';
  if (raw.includes('etimedout') || raw.includes('timeout') || raw.includes('timed out'))
    // Suggesting a different port is actively misleading once a relay is in
    // play — the port isn't the thing that's broken.
    return relayActive && wantHint
      ? `Connection timed out.${relayHint}`
      : `Connection timed out — the SMTP host/port may be wrong, or the port is blocked. Try 465 (SSL) or 587 (TLS).${relayHint}`;
  if (raw.includes('econnrefused'))
    return `Connection refused — double-check the SMTP host and port.${relayHint}`;
  if (raw.includes('enotfound') || raw.includes('getaddrinfo'))
    return 'SMTP host not found — check the server address (e.g. smtp.gmail.com).';
  if (raw.includes('certificate') || raw.includes('self signed') || raw.includes('self-signed'))
    return 'TLS certificate problem — try toggling SSL/TLS, or use port 465 with SSL.';
  if (raw.includes('greeting'))
    return `The server never sent a greeting — wrong port or SSL/TLS setting. Try 465 (SSL) or 587 (TLS).${relayHint}`;
  return err?.message || 'Could not connect to the mail server.';
}

// Loud, once, at boot: without the relay, hosts that block outbound SMTP
// (Render, Railway) make every send fail with a timeout users can't fix.
if (!env.SMTP_RELAY_URL || !env.SMTP_RELAY_SECRET) {
  console.warn(
    '[EmailSender] SMTP_RELAY_URL / SMTP_RELAY_SECRET not set — sends go DIRECT over SMTP ports. ' +
    'If this host blocks outbound SMTP (Render/Railway do), every send will time out. ' +
    'Deploy the bundled Vercel function (api/send-email.ts) and set both env vars to fix.',
  );
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

/**
 * POST to the relay, following any redirect ourselves.
 *
 * Attaching a custom domain to a Vercel project makes the project's
 * `*.vercel.app` alias 308-redirect to it — and the fetch spec strips the
 * Authorization header when a redirect crosses origins, so an auto-followed
 * hop arrives at the relay unauthenticated and comes back 401. That reads as
 * "your secret is wrong" when the secret is fine. Re-issuing the request
 * ourselves keeps the bearer token attached across the hop.
 *
 * Every hop is re-sent as a POST regardless of the redirect status: the target
 * is an API endpoint, so downgrading to GET (what 301/302/303 nominally mean)
 * would be useless anyway.
 */
export async function postToRelay(url: string, body: string, signal?: AbortSignal):
  Promise<{ response: Response; finalUrl: string; redirected: boolean }> {
  let target = url;
  let redirected = false;
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SMTP_RELAY_SECRET}`,
      },
      body,
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: target, redirected };
      target = new URL(location, target).toString();
      redirected = true;
      continue;
    }
    return { response, finalUrl: target, redirected };
  }
  throw new Error(`SMTP relay redirected more than 3 times (last hop: ${target})`);
}

async function sendViaRelay(params: SmtpSendParams): Promise<SmtpSendResult> {
  console.log(`[SMTP Relay] Sending to ${params.to} via ${env.SMTP_RELAY_URL}`);

  let response: Response;
  try {
    const result = await postToRelay(env.SMTP_RELAY_URL!, JSON.stringify({
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
      timeout_ms: params.timeoutMs,
    }));
    response = result.response;
    if (result.redirected) {
      console.warn(
        `[SMTP Relay] SMTP_RELAY_URL redirects to ${result.finalUrl} — point it there directly ` +
        'to avoid the extra hop on every send.',
      );
    }
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

  // Try SSE selection (multi-account pool). reserve=true: this is an actual
  // send, so atomically claim the winning account's ramp slot now.
  const sseResult = await sse.selectBestSender(campaign.user_id, campaignId, true);
  if (sseResult.account) {
    smtpAccount = sseResult.account;
    console.log(`[EmailSender] SSE selected: ${sseResult.reason}`);
  } else if (campaign.smtp_account_id) {
    // Enforce the same is_active/is_verified/warm-up-capacity checks SSE
    // already applies — otherwise a campaign bound directly to one mailbox
    // (the most common setup) would bypass warm-up throttling entirely, and
    // deactivating that account wouldn't actually stop a running campaign.
    const { data: fallback } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', campaign.smtp_account_id)
      .eq('user_id', campaign.user_id)
      .eq('is_active', true)
      .eq('is_verified', true)
      .maybeSingle();
    if (fallback) {
      const limit = warmupAllowance(fallback);
      // Reserve atomically rather than check-then-use — a concurrent
      // processDueSteps() run could otherwise claim the same last slot.
      if (await sse.reserveWarmupSend(fallback.id, limit)) {
        smtpAccount = fallback;
        console.log(`[EmailSender] Using campaign default SMTP: ${smtpAccount?.label || smtpAccount?.id}`);
      } else {
        console.log(`[EmailSender] Campaign default SMTP ${fallback.label || fallback.id} at warm-up capacity, skipping`);
      }
    }
  }

  // Last resort: any active AND verified SMTP account for this user that still
  // has warm-up capacity today. We require is_verified so we never try to send
  // from an unverified/dead mailbox (which would just fail every send); SSE
  // selection already enforces the same. Re-checking warmupAllowance here too
  // is essential — without it, this branch would just re-fetch and reuse the
  // exact same over-cap mailbox the campaign-default branch above just skipped
  // for being over its ramp, silently defeating warm-up throttling for the
  // common single-mailbox setup.
  if (!smtpAccount) {
    const { data: candidates } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', campaign.user_id)
      .eq('is_active', true)
      .eq('is_verified', true);
    // Reserve atomically per candidate (in listed order) instead of just
    // filtering by a stale sends_today snapshot, so a concurrent
    // processDueSteps() run can't grab the same last slot on this mailbox.
    for (const acc of candidates || []) {
      const limit = warmupAllowance(acc);
      if (await sse.reserveWarmupSend(acc.id, limit)) {
        smtpAccount = acc;
        console.log(`[EmailSender] Last resort SMTP: ${smtpAccount.label || smtpAccount.id}`);
        break;
      }
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
    // Selection above already reserved a warm-up/ramp slot on smtpAccount —
    // annotate so the caller can refund it, same as a failed SMTP send does.
    const wrapped = new Error(`Failed to decrypt SMTP password for ${smtpAccount.label}: ${err.message}`);
    (wrapped as any).smtpAccountId = smtpAccount.id;
    throw wrapped;
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

  // 7. Record send in SSE. alreadyReserved=true: every selection path above
  // (SSE pool, campaign-default fallback, last-resort fallback) already
  // reserved this send's sends_today slot atomically before we got here.
  await sse.recordSend(smtpAccount.id, true).catch((err: any) => {
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
  const { data: currentStep, error: currentStepError } = await supabaseAdmin
    .from('campaign_steps')
    .select('step_order')
    .eq('id', stepId)
    .single();

  // The email is already sent — never throw here (see advanceError comment
  // below). A failed fetch must not be treated as "no more steps" (which
  // would wrongly complete the contact) nor silently ignored (which would
  // leave next_send_at null and the contact stuck forever). Retry shortly.
  if (currentStepError) {
    console.error(`[EmailSender] Sent OK but failed to fetch current step ${stepId}: ${currentStepError.message}`);
    const { error: retryError } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: new Date(Date.now() + 5 * 60000).toISOString() })
      .eq('id', campaignContactId);
    if (retryError) console.error(`[EmailSender] Failed to schedule retry for contact ${campaignContactId}: ${retryError.message}`);
    return;
  }

  if (currentStep) {
    const { data: allSteps, error: allStepsError } = await supabaseAdmin
      .from('campaign_steps')
      .select('step_order, step_type, delay_days, delay_hours, delay_minutes')
      .eq('campaign_id', campaignId)
      .order('step_order');

    if (allStepsError) {
      console.error(`[EmailSender] Sent OK but failed to fetch steps for campaign ${campaignId}: ${allStepsError.message}`);
      const { error: retryError } = await supabaseAdmin
        .from('campaign_contacts')
        .update({ next_send_at: new Date(Date.now() + 5 * 60000).toISOString() })
        .eq('id', campaignContactId);
      if (retryError) console.error(`[EmailSender] Failed to schedule retry for contact ${campaignContactId}: ${retryError.message}`);
      return;
    }

    const nextStepOrder = currentStep.step_order + 1;
    const nextStep = allSteps?.find((s: any) => s.step_order === nextStepOrder);
    const hasMoreSteps = !!nextStep;

    if (hasMoreSteps) {
      const delayMin = campaign.delay_between_emails_min ?? campaign.delay_between_emails ?? 60;
      const delayMax = campaign.delay_between_emails_max ?? campaign.delay_between_emails ?? 60;
      const effectiveMin = Math.min(delayMin, delayMax);
      const effectiveMax = Math.max(delayMin, delayMax);
      const delaySecs = effectiveMin + Math.floor(Math.random() * (effectiveMax - effectiveMin + 1));

      // Built-in per-email timing: an email step's own delay fields mean
      // "send this long after the previous step" — no separate delay node
      // needed. The anti-spam throttle still applies as a floor.
      // Steps that carry their own "N days after the previous step" wait:
      // emails and LinkedIn touches both do. Delay and condition nodes don't,
      // and a step that ignores its own delay fires the instant it's reached.
      const builtinMs = (nextStep.step_type === 'email' || isLinkedinStep(nextStep.step_type))
        ? ((nextStep.delay_days || 0) * 86400000) + ((nextStep.delay_hours || 0) * 3600000) + ((nextStep.delay_minutes || 0) * 60000)
        : 0;
      const waitMs = Math.max(delaySecs * 1000, builtinMs);
      const nextSendAt = new Date(Date.now() + waitMs);
      console.log(`[EmailSender] Next step in ${Math.round(waitMs / 1000)}s (throttle ${delaySecs}s, built-in ${Math.round(builtinMs / 1000)}s)`);
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
