import { supabaseAdmin } from '../config/supabase.js';
import { fireEvent } from './webhook.service.js';
import { classifyReply } from './sara.service.js';
import { sendCampaignEmail } from './email-sender.service.js';
import { suppressionService } from './suppression.service.js';
import { billingService } from './billing.service.js';
import * as sse from './sse.service.js';
import { nowInTimezone, partsInTimezone, startOfDayInTimezone, tzWallTimeToUtc } from '../utils/timezone.js';
import { renderMergeTags, personalize, previewPersonalization, SENDER_TAGS, LINK_TAGS } from '@lemlist/shared';
import { settingsService } from './settings.service.js';
import { guardAfterBounce } from './bounce-guard.service.js';
import * as domainThrottle from './domain-throttle.service.js';
import { isLinkedinStep, inferTimezone } from '@lemlist/shared';
import { classifySendFailure, stallReasonFor } from '../utils/send-failure.js';

/**
 * Sequence Engine Service
 *
 * Processes campaign sequences step-by-step per contact, handling:
 * - Email steps: queue for sending via BullMQ
 * - Delay steps: schedule next_send_at in the future
 * - Condition steps: evaluate if/else branch and route accordingly
 * - WebhookWait steps: pause contact until webhook received or timeout
 */

// ============================================
// Send Window & Schedule Helpers
// ============================================

/**
 * Which clock this contact's send window is measured against.
 *
 * `campaign_contacts.contact_timezone` has been in the schema since the first
 * migration and was read by nothing, so every campaign has always sent on the
 * *sender's* clock — a London-configured 09:00–17:00 window reaching a San
 * Francisco prospect at one in the morning. When the campaign opts in and we
 * managed to place the contact, their own zone is used instead.
 *
 * Falling back to the campaign timezone matters: a contact we can't place is
 * no worse off than before, whereas guessing at one would be worse.
 */
function effectiveTimezone(campaign: any, campaignContact?: any): string {
  if (campaign?.send_in_recipient_timezone && campaignContact?.contact_timezone) {
    return campaignContact.contact_timezone;
  }
  return campaign?.timezone || 'UTC';
}

/**
 * Check if current time is within the send window and active days, on
 * whichever clock applies to this contact.
 */
function isWithinSendWindow(campaign: any, campaignContact?: any): boolean {
  const tz = effectiveTimezone(campaign, campaignContact);
  const now = nowInTimezone(tz);

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = dayNames[now.weekday];
  const sendDays: string[] = campaign.send_days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  if (!sendDays.includes(todayName)) return false;

  const windowStart = campaign.send_window_start || '00:00';
  const windowEnd = campaign.send_window_end || '23:59';
  const currentTime = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  if (windowStart <= windowEnd) {
    // Normal same-day window (e.g. 09:00–17:00).
    if (currentTime < windowStart || currentTime > windowEnd) return false;
  } else {
    // Overnight window that wraps past midnight (e.g. 22:00–06:00).
    if (currentTime < windowStart && currentTime > windowEnd) return false;
  }

  return true;
}

/**
 * Calculate when the next valid send window opens (in real UTC time).
 * Looks up to 7 days ahead to find the next active day + window start.
 */
function getNextSendWindowStart(campaign: any, campaignContact?: any): Date {
  const tz = effectiveTimezone(campaign, campaignContact);
  const now = nowInTimezone(tz);

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const sendDays: string[] = campaign.send_days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const windowStart = campaign.send_window_start || '00:00';
  const [startH, startM] = windowStart.split(':').map(Number);
  const currentTime = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;

  // If today is an active day and we're before the window start, schedule for today
  const todayName = dayNames[now.weekday];
  if (sendDays.includes(todayName) && currentTime < windowStart) {
    return tzWallTimeToUtc(now.year, now.month, now.day, startH, startM, tz);
  }

  // Otherwise find the next active day. Probe noon UTC of each future day,
  // then ask for its calendar parts in `tz` — this dodges DST edges since
  // noon is always far from any transition boundary.
  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const probe = new Date(Date.UTC(now.year, now.month - 1, now.day + daysAhead, 12, 0, 0));
    const future = partsInTimezone(probe, tz);
    if (sendDays.includes(dayNames[future.weekday])) {
      return tzWallTimeToUtc(future.year, future.month, future.day, startH, startM, tz);
    }
  }

  // Fallback: 24 hours from now
  return new Date(Date.now() + 24 * 60 * 60_000);
}

/**
 * Atomically reserve one send against a campaign's daily_limit for the given
 * business-day period. Returns true (and counts the send) if within the cap,
 * false if it would exceed it. Replaces a non-atomic count-then-compare that
 * two overlapping processDueSteps() calls (the worker tick racing a
 * launch()-triggered run) could both pass before either finished sending.
 */
async function reserveCampaignDailySend(campaignId: string, periodStart: Date, limit: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('reserve_campaign_daily_send', {
    p_campaign_id: campaignId,
    p_period_start: periodStart.toISOString(),
    p_limit: limit,
  });
  if (!error) return data === true;
  // Fail closed if the atomic RPC is missing (e.g. migration 036 not
  // applied) rather than falling back to a check+increment that concurrent
  // sends could race past the daily cap.
  console.error(`[Sequence] reserve_campaign_daily_send RPC unavailable, denying send: ${error.message}`);
  return false;
}

/** Return a reserved-but-unused daily-send slot (the send never happened). */
async function refundCampaignDailySend(campaignId: string, periodStart: Date): Promise<void> {
  const { error } = await supabaseAdmin.rpc('refund_campaign_daily_send', {
    p_campaign_id: campaignId,
    p_period_start: periodStart.toISOString(),
  });
  if (error) {
    console.error(`[Sequence] Failed to refund daily send for campaign ${campaignId}:`, error.message);
  }
}

/**
 * Work out and store a contact's timezone, once.
 *
 * Written to campaign_contacts rather than contacts because a contact's
 * placement is a property of this enrolment: re-importing a lead list with a
 * better `location` should improve the next campaign without silently moving
 * the send times of one already in flight.
 *
 * Returns null when the location is missing or too vague to place, and stores
 * nothing — so the next attempt tries again, which is what you want after a
 * list is enriched.
 */
async function ensureContactTimezone(campaignContactId: string, contact: any): Promise<string | null> {
  const zone = inferTimezone(contact?.location);
  if (!zone) return null;
  const { error } = await supabaseAdmin
    .from('campaign_contacts')
    .update({ contact_timezone: zone })
    .eq('id', campaignContactId);
  if (error) {
    // A pre-042 database has no column to write to. Use the zone for this
    // send anyway rather than falling back to the sender's clock.
    console.warn(`[Sequence] Could not store contact_timezone for ${campaignContactId}: ${error.message}`);
  }
  return zone;
}

/**
 * Remember why a campaign could not send, so the page can say so.
 *
 * The engine has always known — SSE works out whether every mailbox is at its
 * daily cap, or none is verified, or the campaign's pool is empty — and the
 * string was logged and dropped. A campaign then sat on "running" with
 * nothing happening and nothing to explain it, which is the single most
 * common support question this kind of product generates.
 *
 * Transient by design: written when a send fails for want of capacity or
 * configuration, cleared by the next send that succeeds. `stall_since` is
 * only stamped the first time so the page can say how long it has been stuck
 * rather than resetting the clock every thirty seconds.
 */
async function recordStall(campaignId: string, reason: string | null): Promise<void> {
  try {
    if (reason === null) {
      // Only clear a stall that exists, so a healthy campaign is not written
      // to on every single send.
      await supabaseAdmin
        .from('campaigns')
        .update({ stall_reason: null, stall_since: null })
        .eq('id', campaignId)
        .not('stall_reason', 'is', null);
      return;
    }
    const { data: existing } = await supabaseAdmin
      .from('campaigns')
      .select('stall_reason, stall_since')
      .eq('id', campaignId)
      .maybeSingle();
    await supabaseAdmin
      .from('campaigns')
      .update({
        stall_reason: reason,
        stall_since: existing?.stall_since || new Date().toISOString(),
      })
      .eq('id', campaignId);
  } catch (err: any) {
    // A pre-045 database has no such columns. Not being able to explain a
    // stall must never itself stop the engine.
    if (!/stall_reason|stall_since/.test(err?.message || '')) {
      console.warn(`[Sequence] Could not record stall for ${campaignId}:`, err?.message || err);
    }
  }
}

// ============================================
// Step Processing
// ============================================

/**
 * Process the next step for a campaign contact.
 * Called after campaign launch, after email sent, or after delay expires.
 */
export async function processNextStep(campaignContactId: string): Promise<void> {
  try {
    await _processNextStepInner(campaignContactId);
  } catch (err: any) {
    // CRITICAL: On ANY error, nullify next_send_at to prevent infinite loop.
    // Without this, a failed query leaves the contact in a re-processable state
    // and the sequence worker picks it up again every 30 seconds.
    console.error(`processNextStep error for ${campaignContactId}:`, err.message);
    const { data: stuck } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'error', next_send_at: null, error_message: `Sequence error: ${err.message}`.slice(0, 500) })
      .eq('id', campaignContactId)
      .select('campaign_id')
      .single();
    if (stuck?.campaign_id) {
      checkAndAutoCompleteCampaign(stuck.campaign_id).catch(() => {});
    }
  }
}

async function _processNextStepInner(campaignContactId: string): Promise<void> {
  // Fetch campaign contact with current state
  // Use wildcard selects to avoid failures when new columns haven't been migrated yet
  const { data: cc, error: ccError } = await supabaseAdmin
    .from('campaign_contacts')
    .select('*, campaigns(*), contacts(*)')
    .eq('id', campaignContactId)
    .single();

  if (ccError) {
    throw new Error(`Failed to fetch campaign contact: ${ccError.message}`);
  }

  if (!cc || !cc.campaigns || !cc.contacts) {
    throw new Error(`Campaign contact ${campaignContactId} has missing campaign or contact relations — skipping to prevent infinite retry`);
  }
  if (cc.status !== 'active') return;
  if (cc.campaigns.status !== 'running') return;

  // Check if contact is globally unsubscribed or bounced
  if (cc.contacts.is_unsubscribed || cc.contacts.is_bounced) {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({
        status: cc.contacts.is_bounced ? 'bounced' : 'unsubscribed',
        next_send_at: null,
      })
      .eq('id', campaignContactId);
    checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
    return;
  }

  // Check centralised suppression list
  const suppressed = await suppressionService.isSuppressed(cc.campaigns.user_id, cc.contacts.email);
  if (suppressed) {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'unsubscribed', next_send_at: null })
      .eq('id', campaignContactId);
    checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
    return;
  }

  // Place the contact on first use, so a campaign switched on mid-flight
  // starts honouring local time without needing its audience re-imported.
  if (cc.campaigns?.send_in_recipient_timezone && cc.contact_timezone === null) {
    cc.contact_timezone = await ensureContactTimezone(cc.id, cc.contacts);
  }

  // Check send window (skip if outside active hours/days)
  if (!isWithinSendWindow(cc.campaigns, cc)) {
    // Reschedule to the start of the next valid send window
    const nextWindow = getNextSendWindowStart(cc.campaigns, cc);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: nextWindow.toISOString() })
      .eq('id', campaignContactId);
    console.log(`[Sequence] Contact ${campaignContactId} outside send window — rescheduled to ${nextWindow.toISOString()}`);
    return;
  }

  // Check stop_on_reply. A reply is its own outcome, not a completion — a
  // contact who answered at step two and one who sat through all five in
  // silence are the two most different results a campaign produces, and until
  // now they were both filed as 'completed'.
  if (cc.campaigns.stop_on_reply !== false) {
    const { count: replyCount } = await supabaseAdmin
      .from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_contact_id', cc.id)
      .eq('activity_type', 'replied');
    if (replyCount && replyCount > 0) {
      await markReplied(campaignContactId);
      return;
    }
  }

  // Fetch all steps for this campaign, ordered
  const { data: steps, error: stepsError } = await supabaseAdmin
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', cc.campaign_id)
    .order('step_order');

  if (stepsError) {
    // A transient fetch failure is not "this campaign has no steps" — let the
    // processNextStep safety net mark the contact 'error' instead of wrongly
    // completing it.
    throw new Error(`Failed to fetch campaign steps for ${cc.campaign_id}: ${stepsError.message}`);
  }
  if (!steps || steps.length === 0) {
    await markCompleted(campaignContactId);
    return;
  }

  const currentStepOrder = cc.current_step_order || 0;

  // Find the next step to execute
  const nextStep = steps.find((s: any) => s.step_order === currentStepOrder);
  if (!nextStep) {
    // No more steps - campaign complete for this contact
    await markCompleted(campaignContactId);
    return;
  }

  // DCS threshold check (suppress low-score contacts)
  if (cc.campaigns.dcs_threshold > 0 && nextStep.step_type === 'email') {
    const dcsScore = cc.contacts.dcs_score;
    if (dcsScore !== null && dcsScore < cc.campaigns.dcs_threshold) {
      // Suppress this contact
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'suppressed', completed_at: new Date().toISOString() })
        .eq('id', campaignContactId);

      fireEvent(cc.campaigns.user_id, 'contact.suppressed', {
        campaign_id: cc.campaign_id,
        contact_id: cc.contact_id,
        dcs_score: dcsScore,
        threshold: cc.campaigns.dcs_threshold,
      }).catch(() => {});
      checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
      return;
    }
  }

  // The daily-limit check moved into processEmailStep() — it now atomically
  // reserves a slot (see reserveCampaignDailySend below) instead of counting
  // today's sends and checking against the cap, which raced when the 30s
  // worker tick and a launch()-triggered call both processed a due contact
  // for the same campaign at once.

  // Process based on step type
  switch (nextStep.step_type) {
    case 'email':
      await processEmailStep(cc, nextStep);
      break;
    case 'delay':
      await processDelayStep(cc, nextStep);
      break;
    case 'condition':
      await processConditionStep(cc, nextStep, steps);
      break;
    case 'webhook_wait':
      await processWebhookWaitStep(cc, nextStep);
      break;
    case 'linkedin_connect':
    case 'linkedin_message':
    case 'linkedin_visit':
      await processLinkedinStep(cc, nextStep, steps);
      break;
    default:
      // Unknown step type - skip to next
      await advanceToNextStep(campaignContactId, currentStepOrder, steps);
  }
}

/**
 * Process an email step - queue the email for sending via BullMQ.
 */
async function processEmailStep(cc: any, step: any): Promise<void> {
  // Check skip_if_replied
  if (step.skip_if_replied) {
    const { count } = await supabaseAdmin
      .from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_contact_id', cc.id)
      .eq('activity_type', 'replied');

    if (count && count > 0) {
      // Skip this step, advance to next
      const { data: steps, error: stepsError } = await supabaseAdmin
        .from('campaign_steps')
        .select('*')
        .eq('campaign_id', cc.campaign_id)
        .order('step_order');
      // A fetch error here must not be treated as "no steps left" — that
      // would wrongly mark the contact completed. Let it throw and surface
      // as a genuine error instead.
      if (stepsError) throw new Error(`Failed to fetch campaign steps for ${cc.campaign_id}: ${stepsError.message}`);
      await advanceToNextStep(cc.id, step.step_order, steps || []);
      return;
    }
  }

  // Check if email was already queued/sent for this exact step to prevent duplicates
  const { count: alreadySent } = await supabaseAdmin
    .from('campaign_activities')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_contact_id', cc.id)
    .eq('step_id', step.id)
    .eq('activity_type', 'sent');
  if (alreadySent && alreadySent > 0) {
    // Already sent for this step — advance to next
    const { data: steps, error: stepsError } = await supabaseAdmin
      .from('campaign_steps')
      .select('*')
      .eq('campaign_id', cc.campaign_id)
      .order('step_order');
    if (stepsError) throw new Error(`Failed to fetch campaign steps for ${cc.campaign_id}: ${stepsError.message}`);
    await advanceToNextStep(cc.id, step.step_order, steps || []);
    return;
  }

  // Plan enforcement: owner of this campaign.
  const ownerId: string | undefined = cc.campaigns?.user_id;

  // Per-campaign daily send limit — atomically reserve a slot (see
  // reserveCampaignDailySend above). Deliberately the *campaign's* timezone
  // even when the send window follows the recipient's: a daily cap is the
  // sender's quota, so its day has to roll over once, on the sender's clock.
  // Per-recipient days would reset the same cap at two dozen different hours.
  const dailyLimit = cc.campaigns?.daily_limit || 0;
  const dailyPeriodStart = startOfDayInTimezone(cc.campaigns?.timezone || 'UTC');
  if (dailyLimit > 0 && !(await reserveCampaignDailySend(cc.campaign_id, dailyPeriodStart, dailyLimit))) {
    // Reschedule to next send window so the sequence worker doesn't re-pick
    // this contact every 30 seconds until midnight.
    const nextWindow = getNextSendWindowStart(cc.campaigns, cc);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: nextWindow.toISOString() })
      .eq('id', cc.id);
    return;
  }

  // Monthly email cap — atomically reserve a slot. If exhausted, reschedule to
  // the start of next month so the contact auto-resumes when the quota resets.
  if (ownerId && !(await billingService.reserveEmailQuota(ownerId))) {
    if (dailyLimit > 0) await refundCampaignDailySend(cc.campaign_id, dailyPeriodStart);
    const now = new Date();
    const nextPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: nextPeriod.toISOString() })
      .eq('id', cc.id);
    console.log(`[Sequence] Monthly email limit reached for user ${ownerId} — rescheduling contact ${cc.id} to ${nextPeriod.toISOString()}`);
    return;
  }

  // Don't let a company-sorted list land thirty messages at acme.com inside a
  // minute — the burst a receiving gateway is built to notice, which gets the
  // sending domain flagged at exactly the organisation you most wanted to
  // reach. Reserved after the daily and monthly caps, so a contact deferred
  // for this reason hasn't already spent one of those, and before the contact
  // is claimed, so deferring costs nothing.
  const domainReservation = ownerId
    ? await domainThrottle.reserveDomainSend(ownerId, cc.contacts.email)
    : { granted: true, domain: '', period: null, retryAt: null };

  if (!domainReservation.granted) {
    if (ownerId) await billingService.refundEmailQuota(ownerId);
    if (dailyLimit > 0) await refundCampaignDailySend(cc.campaign_id, dailyPeriodStart);
    const retryAt = domainReservation.retryAt || new Date(Date.now() + 3600_000);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: retryAt.toISOString() })
      .eq('id', cc.id);
    console.log(
      `[Sequence] Contact ${cc.id} deferred to ${retryAt.toISOString()} — ` +
      `hourly limit reached for ${domainReservation.domain}`,
    );
    return;
  }

  // A/B testing is a paid feature — fall back to variant A when not included.
  const abAllowed = ownerId ? await billingService.hasFeature(ownerId, 'abTesting') : true;

  // A/B split: deterministic 50/50 based on contact ID hash
  const charCode = cc.contact_id.charCodeAt(0) || 0;
  const useVariantB = abAllowed && charCode % 2 !== 0;

  let rawSubject = step.subject || '';
  if (step.subject_b) {
    rawSubject = useVariantB ? step.subject_b : rawSubject;
  }

  // Interpolate merge tags in subject and body
  const subject = interpolateMergeTags(rawSubject, cc.contacts);
  const rawBodyHtml = (step.body_html_b && useVariantB) ? step.body_html_b : (step.body_html || '');
  const bodyHtml = interpolateMergeTags(rawBodyHtml, cc.contacts);
  const bodyText = htmlToText(bodyHtml);

  // Atomically claim this contact BEFORE sending to prevent re-processing.
  // Conditioning the UPDATE on the still-pending state (status active, next_send_at
  // still set) makes this a compare-and-swap: if `launch()` and the periodic
  // sequence worker both race to process the same due contact, only the first
  // UPDATE to commit will match these conditions — the second affects 0 rows
  // and backs off instead of sending a duplicate email.
  const { data: claimed, error: nullifyErr } = await supabaseAdmin
    .from('campaign_contacts')
    .update({ current_step_order: step.step_order, next_send_at: null })
    .eq('id', cc.id)
    .eq('status', 'active')
    .not('next_send_at', 'is', null)
    .select('id')
    .maybeSingle();
  if (nullifyErr) {
    if (ownerId) await billingService.refundEmailQuota(ownerId);
    if (dailyLimit > 0) await refundCampaignDailySend(cc.campaign_id, dailyPeriodStart);
    if (ownerId) await domainThrottle.refundDomainSend(ownerId, domainReservation);
    throw new Error(`Failed to lock contact ${cc.id} for processing: ${nullifyErr.message}`);
  }
  if (!claimed) {
    // Lost the race to a concurrent processDueSteps() run — the other caller
    // already claimed this contact for this step. Don't send a duplicate, and
    // give back the slots reserved above (the winner reserved its own).
    if (ownerId) await billingService.refundEmailQuota(ownerId);
    if (dailyLimit > 0) await refundCampaignDailySend(cc.campaign_id, dailyPeriodStart);
    if (ownerId) await domainThrottle.refundDomainSend(ownerId, domainReservation);
    console.log(`[Sequence] Contact ${cc.id} already claimed by a concurrent run — skipping`);
    return;
  }

  // Send email DIRECTLY (no BullMQ queue — eliminates Redis dependency)
  // sendCampaignEmail handles: SMTP selection, sending, activity recording, step advancement
  console.log(`[Sequence] Sending email directly to ${cc.contacts.email} (subject: "${subject}")`);
  try {
    await sendCampaignEmail({
      campaignId: cc.campaign_id,
      campaignContactId: cc.id,
      contactId: cc.contact_id,
      stepId: step.id,
      to: cc.contacts.email,
      subject,
      bodyHtml,
      bodyText,
      ab_variant: step.subject_b ? (useVariantB ? 'b' : 'a') : undefined,
    });
    // (Quota already reserved above before sending.)
    // Whatever was blocking this campaign clearly isn't any more.
    await recordStall(cc.campaign_id, null);
  } catch (err: any) {
    console.error(`[Sequence] Email send failed for ${cc.contacts.email}:`, err.message);

    // The send never happened — give back the slots reserved above.
    if (ownerId) await billingService.refundEmailQuota(ownerId);
    if (dailyLimit > 0) await refundCampaignDailySend(cc.campaign_id, dailyPeriodStart);
    if (ownerId) await domainThrottle.refundDomainSend(ownerId, domainReservation);

    // sendCampaignEmail annotates failures it can explain in plain language
    // (every mailbox at capacity, none verified). Keep it where the campaign
    // page can read it.
    // One classifier for both send paths. The inline version this replaced
    // only read fields the direct SMTP path sets, so relay sends — the
    // recommended deployment — never registered a bounce at all.
    const failureKind = classifySendFailure(err);
    const isBounce = failureKind === 'bounce';

    if (err.stallReason) {
      await recordStall(cc.campaign_id, err.stallReason);
    } else {
      // Stale mailbox credentials fail every send identically. Say so on the
      // campaign page rather than letting it grind through the whole list
      // stamping "error" on contacts that were never the problem.
      const kindReason = stallReasonFor(failureKind);
      if (kindReason) await recordStall(cc.campaign_id, kindReason);
    }

    // sendCampaignEmail annotates the error with the account it had already
    // reserved a warm-up/ramp slot on (once SMTP selection succeeded) —
    // give that back too so a failed send doesn't burn ramp capacity.
    if (err.smtpAccountId) sse.refundWarmupSend(err.smtpAccountId).catch(() => {});

    if (isBounce) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'bounced', next_send_at: null })
        .eq('id', cc.id);
      await supabaseAdmin
        .from('contacts')
        .update({ is_bounced: true })
        .eq('id', cc.contact_id);

      // Use the account that actually attempted the send (annotated by sendCampaignEmail).
      // Fall back to campaign.smtp_account_id only if SSE didn't annotate the error.
      const bounceAccountId = err.smtpAccountId || cc.campaigns?.smtp_account_id;
      if (bounceAccountId) {
        sse.recordBounce(bounceAccountId).catch(() => {});
      }

      // The evidence just changed, so ask now rather than on a schedule: the
      // point of the guard is to stop the *next* thousand sends, not to
      // report on the last thousand. Deliberately awaited — letting the
      // sequence worker pick up more contacts while a decision to stop is
      // still in flight is exactly the window that does the damage.
      if (cc.campaigns?.user_id) {
        await guardAfterBounce(cc.campaigns.user_id, cc.campaign_id);
      }

      checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
    }

    // Record error activity
    await supabaseAdmin
      .from('campaign_activities')
      .insert({
        campaign_id: cc.campaign_id,
        campaign_contact_id: cc.id,
        contact_id: cc.contact_id,
        step_id: step.id,
        activity_type: isBounce ? 'bounced' : 'error',
        metadata: { error: err.message, code: err.code || err.responseCode, to: cc.contacts.email },
      });

    // For non-bounce errors, mark the contact as 'error' so the campaign can
    // auto-complete and users can see which contacts need attention.
    if (!isBounce) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ status: 'error', next_send_at: null, error_message: `Send failed: ${err.message}`.slice(0, 500) })
        .eq('id', cc.id);
      checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
    }

    // Don't rethrow — error is handled, contact won't be re-processed
    return;
  }

  fireEvent(cc.campaigns.user_id, 'sequence.step_executed', {
    campaign_id: cc.campaign_id,
    contact_id: cc.contact_id,
    step_type: 'email',
    step_order: step.step_order,
  }).catch(() => {});
}

/**
 * Process a delay step - set next_send_at in the future.
 */
async function processDelayStep(cc: any, step: any): Promise<void> {
  const delayMs =
    ((step.delay_days || 0) * 86400000) +
    ((step.delay_hours || 0) * 3600000) +
    ((step.delay_minutes || 0) * 60000);

  const nextSendAt = new Date(Date.now() + delayMs);

  await supabaseAdmin
    .from('campaign_contacts')
    .update({
      current_step_order: step.step_order + 1,
      next_send_at: nextSendAt.toISOString(),
    })
    .eq('id', cc.id);

  fireEvent(cc.campaigns.user_id, 'sequence.step_executed', {
    campaign_id: cc.campaign_id,
    contact_id: cc.contact_id,
    step_type: 'delay',
    step_order: step.step_order,
    delay_until: nextSendAt.toISOString(),
  }).catch(() => {});
}

/**
 * Process a condition step - evaluate the condition and route to true/false branch.
 */
async function processConditionStep(cc: any, step: any, allSteps: any[]): Promise<void> {
  const conditionMet = await evaluateCondition(cc, step);

  // Route to the appropriate branch
  if (conditionMet) {
    // True branch: advance to next step normally
    await advanceToNextStep(cc.id, step.step_order, allSteps);
  } else {
    // False branch: jump to false_branch_step or skip to end
    if (step.false_branch_step !== null && step.false_branch_step !== undefined) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({
          current_step_order: step.false_branch_step,
          next_send_at: new Date().toISOString(),
        })
        .eq('id', cc.id);
    } else {
      // No false branch defined - end sequence for this contact
      await markCompleted(cc.id);
    }
  }

  fireEvent(cc.campaigns.user_id, 'sequence.step_executed', {
    campaign_id: cc.campaign_id,
    contact_id: cc.contact_id,
    step_type: 'condition',
    step_order: step.step_order,
    condition_field: step.condition_field,
    condition_result: conditionMet,
  }).catch(() => {});
}

/**
 * Evaluate a condition for a campaign contact.
 */
async function evaluateCondition(cc: any, step: any): Promise<boolean> {
  const field = step.condition_field;
  const operator = step.condition_operator;
  const value = step.condition_value;

  switch (field) {
    case 'opened': {
      const { count } = await supabaseAdmin
        .from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_contact_id', cc.id)
        .eq('activity_type', 'opened');
      return applyOperator(!!count && count > 0, operator, value);
    }

    case 'clicked': {
      const { count } = await supabaseAdmin
        .from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_contact_id', cc.id)
        .eq('activity_type', 'clicked');
      return applyOperator(!!count && count > 0, operator, value);
    }

    case 'replied': {
      const { count } = await supabaseAdmin
        .from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_contact_id', cc.id)
        .eq('activity_type', 'replied');
      return applyOperator(!!count && count > 0, operator, value);
    }

    case 'sara_intent': {
      // Get the latest SARA classification for this contact's replies. Scoped to
      // this campaign_contact_id (not just contact_id) so a contact enrolled in
      // multiple campaigns at once can't have one campaign's branch fire off a
      // reply that only happened in a different campaign.
      const { data: messages, error: intentErr } = await supabaseAdmin
        .from('inbox_messages')
        .select('sara_intent')
        .eq('campaign_contact_id', cc.id)
        .not('sara_intent', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (intentErr) {
        console.error('[Sequence] sara_intent query error:', intentErr.message);
        return false;
      }
      const latestIntent = messages?.[0]?.sara_intent || '';
      return applyOperator(latestIntent, operator, value);
    }

    case 'dcs_score': {
      const dcsScore = cc.contacts.dcs_score || 0;
      return applyOperator(dcsScore, operator, value);
    }

    case 'webhook_received': {
      // resumeWebhookWait() and processWebhookTimeouts() both clear
      // waiting_for_webhook/webhook_wait_until, so those alone can't tell a
      // received webhook apart from a timeout — webhook_received_at can.
      const isReceived = cc.waiting_for_webhook === null
        && cc.webhook_wait_until === null
        && !!cc.webhook_received_at;
      return applyOperator(isReceived, operator, value);
    }

    default:
      return false;
  }
}

/**
 * Apply a comparison operator to a value.
 */
function applyOperator(actual: any, operator: string, expected: string): boolean {
  switch (operator) {
    case 'is_true':
      return !!actual;
    case 'is_false':
      return !actual;
    case 'equals':
      return String(actual).toLowerCase() === String(expected).toLowerCase();
    case 'not_equals':
      return String(actual).toLowerCase() !== String(expected).toLowerCase();
    case 'greater_than':
      return Number(actual) > Number(expected);
    case 'less_than':
      return Number(actual) < Number(expected);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

/**
 * Process a webhook_wait step - pause contact until webhook or timeout.
 */
async function processWebhookWaitStep(cc: any, step: any): Promise<void> {
  const timeoutHours = step.webhook_timeout_hours ?? 72;
  const waitUntil = new Date(Date.now() + timeoutHours * 3600000);

  try {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({
        current_step_order: step.step_order,
        next_send_at: null,
        waiting_for_webhook: step.webhook_event,
        webhook_wait_until: waitUntil.toISOString(),
        webhook_received_at: null,
      })
      .eq('id', cc.id);
  } catch (err: any) {
    // If webhook columns don't exist, just pause the contact
    console.warn('[Sequence] webhook columns missing, pausing contact:', err.message);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ current_step_order: step.step_order, next_send_at: null })
      .eq('id', cc.id);
  }

  fireEvent(cc.campaigns.user_id, 'sequence.step_executed', {
    campaign_id: cc.campaign_id,
    contact_id: cc.contact_id,
    step_type: 'webhook_wait',
    step_order: step.step_order,
    webhook_event: step.webhook_event,
    timeout_at: waitUntil.toISOString(),
  }).catch(() => {});
}

/* ── LinkedIn ────────────────────────────────────────────────────────────
   A LinkedIn step becomes a task, not a send.

   There is no public LinkedIn API for connection requests or messages to
   people you aren't connected to. Tools that claim otherwise drive a browser
   with the user's session cookie, which breaks LinkedIn's User Agreement and
   gets accounts restricted. So the engine does the part it can do honestly:
   it works out WHO, WHEN and exactly WHAT to say, personalises it, and parks
   the contact until a human completes the task. Completing it resumes the
   sequence — see resumeAfterTask below. */

const LINKEDIN_VERB: Record<string, string> = {
  linkedin_connect: 'Connect on LinkedIn',
  linkedin_message: 'Message on LinkedIn',
  linkedin_visit: 'View LinkedIn profile',
};

async function processLinkedinStep(cc: any, step: any, steps: any[]): Promise<void> {
  const contact = cc.contacts || {};
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;

  // No profile means the step can't be done at all. Skipping and moving on
  // beats parking the contact forever on work nobody can complete.
  if (!contact.linkedin_url) {
    await supabaseAdmin.from('campaign_activities').insert({
      campaign_contact_id: cc.id,
      activity_type: 'skipped',
      metadata: { step_order: step.step_order, step_type: step.step_type, reason: 'no_linkedin_url' },
    }).then(() => {}, () => {});
    await advanceToNextStep(cc.id, step.step_order, steps);
    return;
  }

  // Claim the contact first, on the same compare-and-swap the email path uses:
  // two workers reaching this step at once must not raise two tasks.
  const { data: claimed } = await supabaseAdmin
    .from('campaign_contacts')
    .update({ current_step_order: step.step_order, next_send_at: null })
    .eq('id', cc.id)
    .eq('status', 'active')
    .not('next_send_at', 'is', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return;

  // A LinkedIn note has no mailbox behind it and no unsubscribe link, so
  // there is nothing to defer — resolve every tag here, including the
  // sender's own details, and leave nothing in braces for the user to paste.
  const sender = cc.campaigns?.user_id
    ? await settingsService.senderIdentity(cc.campaigns.user_id)
    : null;
  const linkedinCopy = step.step_type === 'linkedin_connect'
    ? step.linkedin_note || ''
    : step.body_text || step.body_html || '';
  const message = personalize(linkedinCopy, { contact, sender, spinSeed: `${step.id}:${cc.contact_id}` });

  const { data: task, error } = await supabaseAdmin
    .from('crm_tasks')
    .insert({
      user_id: cc.campaigns.user_id,
      title: `${LINKEDIN_VERB[step.step_type] || 'LinkedIn'} — ${name}`,
      type: 'todo',
      due_date: new Date().toISOString(),
      contact_id: cc.contact_id,
      contact_name: name,
      channel: step.step_type,
      payload: message || null,
      target_url: contact.linkedin_url,
      campaign_contact_id: cc.id,
      campaign_step_id: step.id,
    })
    .select('id')
    .single();

  if (error || !task) {
    // Migration 039 not run, or the insert failed. Put the contact back on the
    // clock rather than stranding it — a retry in a minute is recoverable,
    // a permanently parked contact is not.
    console.warn('[Sequence] could not raise LinkedIn task:', error?.message);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: new Date(Date.now() + 60_000).toISOString() })
      .eq('id', cc.id);
    return;
  }

  await supabaseAdmin
    .from('campaign_contacts')
    .update({ waiting_for_task_id: task.id })
    .eq('id', cc.id);

  fireEvent(cc.campaigns.user_id, 'sequence.step_executed', {
    campaign_id: cc.campaign_id,
    contact_id: cc.contact_id,
    step_type: step.step_type,
    step_order: step.step_order,
    task_id: task.id,
  }).catch(() => {});
}

/**
 * Hand control back to the sequence once a human has done the LinkedIn touch.
 * Called when a task carrying campaign_contact_id is marked done.
 */
export async function resumeAfterTask(taskId: string): Promise<void> {
  const { data: cc } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaign_id, current_step_order, status')
    .eq('waiting_for_task_id', taskId)
    .maybeSingle();

  if (!cc || cc.status !== 'active') return;

  const { data: steps, error: stepsError } = await supabaseAdmin
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', cc.campaign_id)
    .order('step_order');

  if (stepsError) {
    // No retry loop drives this path (it fires once, off a task completion
    // webhook), so a transient error can't be silently treated as "no more
    // steps" — that would wrongly complete the contact. Leave it visibly
    // stuck (still active, current_step_order unchanged) instead.
    console.error(`[Sequence] resumeAfterTask: failed to fetch steps for campaign ${cc.campaign_id}: ${stepsError.message}`);
    return;
  }

  await supabaseAdmin
    .from('campaign_contacts')
    .update({ waiting_for_task_id: null })
    .eq('id', cc.id);

  // advanceToNextStep owns the delay arithmetic for whatever comes next, so
  // the LinkedIn path doesn't get its own copy of that logic to drift.
  await advanceToNextStep(cc.id, cc.current_step_order || 0, steps || []);
}

/**
 * Resume a contact that was waiting for a webhook event.
 * Called when the webhook event bus receives a matching event.
 */
export async function resumeWebhookWait(
  campaignContactId: string,
  eventType: string
): Promise<void> {
  const { data: cc } = await supabaseAdmin
    .from('campaign_contacts')
    .select('*, campaigns(user_id)')
    .eq('id', campaignContactId)
    .eq('waiting_for_webhook', eventType)
    .single();

  if (!cc) return;

  const { data: steps, error: stepsError } = await supabaseAdmin
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', cc.campaign_id)
    .order('step_order');

  if (stepsError) {
    // Leave waiting_for_webhook untouched on a fetch failure so a retry of
    // this same event (or the timeout sweep) gets another chance, instead of
    // clearing the wait state and then wrongly completing the contact below.
    console.error(`[Sequence] resumeWebhookWait: failed to fetch steps for campaign ${cc.campaign_id}: ${stepsError.message}`);
    return;
  }

  // Clear webhook wait state; advanceToNextStep owns the delay arithmetic for
  // whatever comes next, so it honors the next step's own built-in delay
  // instead of sending immediately.
  await supabaseAdmin
    .from('campaign_contacts')
    .update({
      waiting_for_webhook: null,
      webhook_wait_until: null,
      webhook_received_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId);

  await advanceToNextStep(campaignContactId, cc.current_step_order || 0, steps || []);
}

/**
 * Check for timed-out webhook waits and advance those contacts.
 * Should be called periodically (e.g., every 5 minutes via cron).
 */
export async function processWebhookTimeouts(): Promise<number> {
  try {
    const { data: timedOut, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, campaign_id, current_step_order')
      .not('waiting_for_webhook', 'is', null)
      .lt('webhook_wait_until', new Date().toISOString());

    if (error || !timedOut || timedOut.length === 0) return 0;

    for (const cc of timedOut) {
      // advanceToNextStep owns the delay arithmetic for whatever comes next,
      // so a timed-out wait honors the next step's own built-in delay
      // instead of sending immediately.
      const { data: steps, error: stepsError } = await supabaseAdmin
        .from('campaign_steps')
        .select('*')
        .eq('campaign_id', cc.campaign_id)
        .order('step_order');

      if (stepsError) {
        // Leave waiting_for_webhook set so the next sweep retries this
        // contact, instead of clearing it here and wrongly completing the
        // contact below on a transient fetch failure.
        console.error(`[Sequence] processWebhookTimeouts: failed to fetch steps for campaign ${cc.campaign_id}: ${stepsError.message}`);
        continue;
      }

      await supabaseAdmin
        .from('campaign_contacts')
        .update({
          waiting_for_webhook: null,
          webhook_wait_until: null,
        })
        .eq('id', cc.id);

      await advanceToNextStep(cc.id, cc.current_step_order || 0, steps || []);
    }

    return timedOut.length;
  } catch (err: any) {
    // waiting_for_webhook/webhook_wait_until columns may not exist yet
    console.warn('[Sequence] processWebhookTimeouts skipped:', err.message);
    return 0;
  }
}

// ============================================
// Scheduling: Process Due Steps
// ============================================

/**
 * Find all campaign contacts with next_send_at <= now and process them.
 * Should be called periodically (e.g., every 30 seconds via cron/scheduler).
 */
export async function processDueSteps(): Promise<number> {
  // Join on campaigns.status so a paused campaign's still-"active" contacts
  // (pause() intentionally leaves their next_send_at untouched so resume()
  // can pick them up immediately) don't keep occupying slots in the 50-row
  // cap every poll, which would starve genuinely due contacts in other
  // running campaigns. processNextStep() re-checks this too, but skipping
  // here avoids the wasted fetch and the crowding.
  const { data: dueContacts, error: dueError } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaigns!inner(status)')
    .eq('status', 'active')
    .eq('campaigns.status', 'running')
    .not('next_send_at', 'is', null)
    .lte('next_send_at', new Date().toISOString())
    .limit(50);

  if (dueError) {
    console.error('[Sequence] processDueSteps query error:', dueError.message);
    return 0;
  }

  if (!dueContacts || dueContacts.length === 0) return 0;
  console.log(`[Sequence] Found ${dueContacts.length} due contact(s) to process`);

  for (const cc of dueContacts) {
    try {
      await processNextStep(cc.id);
    } catch (err: any) {
      // processNextStep already handles errors, but double-guard here
      console.error(`processDueSteps: unhandled error for ${cc.id}:`, err.message);
    }
  }

  return dueContacts.length;
}

// ============================================
// Helpers
// ============================================

async function advanceToNextStep(
  campaignContactId: string,
  currentStepOrder: number,
  allSteps: any[]
): Promise<void> {
  const nextStepOrder = currentStepOrder + 1;
  const nextStep = allSteps.find((s: any) => s.step_order === nextStepOrder);

  if (nextStep) {
    // Honor the next email step's built-in "send N after previous step"
    // timing even when we got here by skipping a step (skip_if_replied,
    // condition branch): the wait belongs to the email, not to the path.
    // Steps that carry their own "N days after the previous step" wait:
    // emails and LinkedIn touches both do.
    const builtinMs = (nextStep.step_type === 'email' || isLinkedinStep(nextStep.step_type))
      ? ((nextStep.delay_days || 0) * 86400000) + ((nextStep.delay_hours || 0) * 3600000) + ((nextStep.delay_minutes || 0) * 60000)
      : 0;
    await supabaseAdmin
      .from('campaign_contacts')
      .update({
        current_step_order: nextStepOrder,
        next_send_at: new Date(Date.now() + builtinMs).toISOString(),
      })
      .eq('id', campaignContactId);
  } else {
    await markCompleted(campaignContactId);
  }
}

/**
 * Stop a contact because they answered.
 *
 * Called the moment the reply lands rather than when their next step comes
 * due. That difference is not cosmetic: a contact replying after step two of
 * a sequence whose step three waits five days used to sit 'active' for those
 * five days — shown as still being worked, keeping the campaign from
 * auto-completing, and taking one of the fifty slots the sequence worker
 * pulls each tick away from a contact genuinely due.
 *
 * Idempotent, and only ever moves a contact who is still in flight: a reply
 * arriving after they bounced or unsubscribed must not overwrite that.
 */
export async function markReplied(campaignContactId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('campaign_contacts')
    .update({
      status: 'replied',
      next_send_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId)
    .in('status', ['pending', 'active'])
    .select('campaign_id')
    .maybeSingle();

  if (error) {
    console.error(`[Sequence] Failed to mark contact ${campaignContactId} replied:`, error.message);
    return false;
  }
  if (!data) return false; // already in a terminal state — leave it alone

  checkAndAutoCompleteCampaign(data.campaign_id).catch(() => {});
  return true;
}

/**
 * Stop every *other* live campaign for the person who just replied.
 *
 * Opt-in per account. Someone who has answered one sequence should not keep
 * receiving a different one — it reads as though nobody is paying attention,
 * which is the impression cold outreach can least afford.
 */
export async function stopOtherCampaignsForContact(
  userId: string,
  contactId: string,
  exceptCampaignContactId: string,
): Promise<number> {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('stop_all_campaigns_on_reply')
    .eq('user_id', userId)
    .maybeSingle();
  if (!settings?.stop_all_campaigns_on_reply) return 0;

  const { data: stopped, error } = await supabaseAdmin
    .from('campaign_contacts')
    .update({ status: 'replied', next_send_at: null, completed_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .neq('id', exceptCampaignContactId)
    .in('status', ['pending', 'active'])
    .select('campaign_id');

  if (error) {
    console.error(`[Sequence] Cross-campaign stop failed for contact ${contactId}:`, error.message);
    return 0;
  }

  for (const campaignId of new Set((stopped || []).map((r: any) => r.campaign_id))) {
    checkAndAutoCompleteCampaign(campaignId).catch(() => {});
  }
  return (stopped || []).length;
}

async function markCompleted(campaignContactId: string): Promise<void> {
  const { data: cc, error: updateErr } = await supabaseAdmin
    .from('campaign_contacts')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId)
    .select('campaign_id')
    .single();

  if (updateErr) {
    console.error(`[Sequence] Failed to mark contact ${campaignContactId} completed:`, updateErr.message);
    return;
  }

  if (cc?.campaign_id) {
    checkAndAutoCompleteCampaign(cc.campaign_id).catch(() => {});
  }
}

/**
 * Auto-complete a campaign when every contact has reached a terminal state.
 * Terminal states: completed, bounced, unsubscribed, error, suppressed.
 * Prevents campaigns from staying "running" indefinitely after all work is done.
 */
export async function checkAndAutoCompleteCampaign(campaignId: string): Promise<void> {
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('id, status, user_id')
    .eq('id', campaignId)
    .single();

  if (!campaign || campaign.status !== 'running') return;

  // Count contacts still in non-terminal states (pending or active)
  const { count: nonTerminal } = await supabaseAdmin
    .from('campaign_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'active']);

  if (nonTerminal && nonTerminal > 0) return;

  // All contacts are in terminal states — mark campaign as completed
  const { error } = await supabaseAdmin
    .from('campaigns')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('status', 'running'); // guard against concurrent updates

  if (!error) {
    console.log(`[Sequence] Campaign ${campaignId} auto-completed — all contacts finished`);
    fireEvent(campaign.user_id, 'campaign.completed', { campaign_id: campaignId }).catch(() => {});
  }
}

/**
 * Convert HTML to readable plain text, preserving paragraph breaks and whitespace.
 * Improves deliverability — spam filters check plain text quality.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fill the tags a contact can answer for.
 *
 * Sender tags and the unsubscribe link are deliberately left standing:
 * neither is knowable until sendCampaignEmail has picked a mailbox, and it
 * finishes the job there. Everything else is resolved or removed here, so
 * no raw `{{tag}}` can reach a prospect.
 *
 * Spintax is *not* applied here. It has to run after the sender tags are
 * filled — a deferred `{{sender_name}}` is still double-braced, but any
 * merge fallback that survived into this pass would look exactly like a
 * spin group to the spinner. The send path spins once, at the end.
 */
export function interpolateMergeTags(text: string, contact: any): string {
  return renderMergeTags(text, { contact, defer: [...SENDER_TAGS, ...LINK_TAGS] });
}

/**
 * Preview a step the way a recipient will receive it.
 *
 * The sample data and the renderer both live in `shared` now, so the campaign
 * editor's preview, a test send and a real send cannot drift apart again.
 */
export function previewWithSampleData(text: string, spinSeed = 'preview'): string {
  return previewPersonalization(text, { spinSeed });
}

