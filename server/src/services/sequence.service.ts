import { supabaseAdmin } from '../config/supabase.js';
import { fireEvent } from './webhook.service.js';
import { classifyReply } from './sara.service.js';
import { sendCampaignEmail } from './email-sender.service.js';
import { suppressionService } from './suppression.service.js';
import * as sse from './sse.service.js';
import { nowInTimezone, partsInTimezone, startOfDayInTimezone, tzWallTimeToUtc } from '../utils/timezone.js';

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
 * Check if current time is within the campaign's send window and active days.
 */
function isWithinSendWindow(campaign: any): boolean {
  const tz = campaign.timezone || 'UTC';
  const now = nowInTimezone(tz);

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = dayNames[now.weekday];
  const sendDays: string[] = campaign.send_days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  if (!sendDays.includes(todayName)) return false;

  const windowStart = campaign.send_window_start || '00:00';
  const windowEnd = campaign.send_window_end || '23:59';
  const currentTime = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  if (currentTime < windowStart || currentTime > windowEnd) return false;

  return true;
}

/**
 * Calculate when the next valid send window opens (in real UTC time).
 * Looks up to 7 days ahead to find the next active day + window start.
 */
function getNextSendWindowStart(campaign: any): Date {
  const tz = campaign.timezone || 'UTC';
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

  if (!cc || !cc.campaigns || !cc.contacts) return;
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

  // Check send window (skip if outside active hours/days)
  if (!isWithinSendWindow(cc.campaigns)) {
    // Reschedule to the start of the next valid send window
    const nextWindow = getNextSendWindowStart(cc.campaigns);
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: nextWindow.toISOString() })
      .eq('id', campaignContactId);
    console.log(`[Sequence] Contact ${campaignContactId} outside send window — rescheduled to ${nextWindow.toISOString()}`);
    return;
  }

  // Check daily limit — use the campaign's timezone so "today" matches the sender's business day
  const dailyLimit = cc.campaigns.daily_limit || 0;
  if (dailyLimit > 0) {
    const tz = cc.campaigns.timezone || 'UTC';
    const todayStart = startOfDayInTimezone(tz);
    const { count: sentToday, error: countErr } = await supabaseAdmin
      .from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', cc.campaign_id)
      .eq('activity_type', 'sent')
      .gte('occurred_at', todayStart.toISOString());
    if (countErr) throw new Error(`Failed to fetch daily send count: ${countErr.message}`);
    if (sentToday !== null && sentToday >= dailyLimit) {
      // Reschedule to next send window so the sequence worker doesn't
      // re-pick this contact every 30 seconds until midnight.
      const nextWindow = getNextSendWindowStart(cc.campaigns);
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ next_send_at: nextWindow.toISOString() })
        .eq('id', campaignContactId);
      return;
    }
  }

  // Check stop_on_reply — if contact already replied, mark completed
  if (cc.campaigns.stop_on_reply !== false) {
    const { count: replyCount } = await supabaseAdmin
      .from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_contact_id', cc.id)
      .eq('activity_type', 'replied');
    if (replyCount && replyCount > 0) {
      await markCompleted(campaignContactId);
      return;
    }
  }

  // Fetch all steps for this campaign, ordered
  const { data: steps } = await supabaseAdmin
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', cc.campaign_id)
    .order('step_order');

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
      const { data: steps } = await supabaseAdmin
        .from('campaign_steps')
        .select('*')
        .eq('campaign_id', cc.campaign_id)
        .order('step_order');
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
    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('*')
      .eq('campaign_id', cc.campaign_id)
      .order('step_order');
    await advanceToNextStep(cc.id, step.step_order, steps || []);
    return;
  }

  // A/B split: deterministic 50/50 based on contact ID hash
  const charCode = cc.contact_id.charCodeAt(0) || 0;
  const useVariantB = charCode % 2 !== 0;

  let rawSubject = step.subject || '';
  if (step.subject_b) {
    rawSubject = useVariantB ? step.subject_b : rawSubject;
  }

  // Interpolate merge tags in subject and body
  const subject = interpolateMergeTags(rawSubject, cc.contacts);
  const rawBodyHtml = (step.body_html_b && useVariantB) ? step.body_html_b : (step.body_html || '');
  const bodyHtml = interpolateMergeTags(rawBodyHtml, cc.contacts);
  const bodyText = htmlToText(bodyHtml);

  // Nullify next_send_at BEFORE sending to prevent re-processing
  const { error: nullifyErr } = await supabaseAdmin
    .from('campaign_contacts')
    .update({ current_step_order: step.step_order, next_send_at: null })
    .eq('id', cc.id);
  if (nullifyErr) {
    throw new Error(`Failed to lock contact ${cc.id} for processing: ${nullifyErr.message}`);
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
  } catch (err: any) {
    console.error(`[Sequence] Email send failed for ${cc.contacts.email}:`, err.message);

    // Check for bounce: Number(undefined) = NaN which fails >= 500, so also check the string form
    const responseCode = Number(err.responseCode);
    const isBounce = (!isNaN(responseCode) && responseCode >= 500)
      || String(err.responseCode || '').startsWith('5')
      || err.code === 'EENVELOPE';
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
      // Get the latest SARA classification for this contact's replies
      const { data: messages, error: intentErr } = await supabaseAdmin
        .from('inbox_messages')
        .select('sara_intent')
        .eq('contact_id', cc.contact_id)
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
      // Check if a specific webhook was received for this contact
      const isReceived = cc.waiting_for_webhook === null && cc.webhook_wait_until === null;
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
  const timeoutHours = step.webhook_timeout_hours || 72;
  const waitUntil = new Date(Date.now() + timeoutHours * 3600000);

  try {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({
        current_step_order: step.step_order,
        next_send_at: null,
        waiting_for_webhook: step.webhook_event,
        webhook_wait_until: waitUntil.toISOString(),
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

  // Clear webhook wait state and advance
  await supabaseAdmin
    .from('campaign_contacts')
    .update({
      waiting_for_webhook: null,
      webhook_wait_until: null,
      current_step_order: (cc.current_step_order || 0) + 1,
      next_send_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId);
}

/**
 * Check for timed-out webhook waits and advance those contacts.
 * Should be called periodically (e.g., every 5 minutes via cron).
 */
export async function processWebhookTimeouts(): Promise<number> {
  try {
    const { data: timedOut, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, current_step_order')
      .not('waiting_for_webhook', 'is', null)
      .lt('webhook_wait_until', new Date().toISOString());

    if (error || !timedOut || timedOut.length === 0) return 0;

    for (const cc of timedOut) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({
          waiting_for_webhook: null,
          webhook_wait_until: null,
          current_step_order: (cc.current_step_order || 0) + 1,
          next_send_at: new Date().toISOString(),
        })
        .eq('id', cc.id);
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
  const { data: dueContacts, error: dueError } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id')
    .eq('status', 'active')
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
  const hasMoreSteps = allSteps.some((s: any) => s.step_order === nextStepOrder);

  if (hasMoreSteps) {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({
        current_step_order: nextStepOrder,
        next_send_at: new Date().toISOString(),
      })
      .eq('id', campaignContactId);
  } else {
    await markCompleted(campaignContactId);
  }
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
async function checkAndAutoCompleteCampaign(campaignId: string): Promise<void> {
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
function htmlToText(html: string): string {
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

function interpolateMergeTags(text: string, contact: any): string {
  return text
    .replace(/\{\{first_name\}\}/gi, contact.first_name || '')
    .replace(/\{\{last_name\}\}/gi, contact.last_name || '')
    .replace(/\{\{email\}\}/gi, contact.email || '')
    .replace(/\{\{company\}\}/gi, contact.company || '')
    .replace(/\{\{full_name\}\}/gi, `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
    .replace(/\{\{job_title\}\}/gi, contact.job_title || '')
    .replace(/\{\{phone\}\}/gi, contact.phone || '')
    .replace(/\{\{city\}\}/gi, contact.city || '')
    .replace(/\{\{country\}\}/gi, contact.country || '')
    .replace(/\{\{linkedin_url\}\}/gi, contact.linkedin_url || '')
    .replace(/\{\{website\}\}/gi, contact.website || '')
    .replace(/\{\{custom_field_1\}\}/gi, contact.custom_field_1 || '')
    .replace(/\{\{custom_field_2\}\}/gi, contact.custom_field_2 || '');
}
