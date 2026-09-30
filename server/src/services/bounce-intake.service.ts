/* ═══════════════════════════════════════════════════════════════════════
   Bounces that arrive as email.

   See shared/bounce-notice for why these were being lost. This is the half
   that acts on one: find who it was about and which send it answers, then
   do what a bounce at send time already did - stop the enrolment, mark a
   dead address dead, count it against the mailbox that sent it, and let
   the bounce guard look again.

   Called twice: as each message syncs, and by the autopilot's sweep over
   recent Other mail, which also catches notices stored before this
   existed. Idempotent - one notice about one enrolment is one bounce, no
   matter how many times it is read.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { parseBounceNotice, type BounceNotice } from '@lemlist/shared';
import * as sse from './sse.service.js';
import { guardAfterBounce } from './bounce-guard.service.js';
import { suppressionService } from './suppression.service.js';
import { fireEvent } from './webhook.service.js';
import { checkAndAutoCompleteCampaign } from './sequence.service.js';

/** How far back a notice may be answering. Older sends are not matched. */
const MATCH_WINDOW_MS = 21 * 86_400_000;

export interface InboundForBounce {
  id: string;
  user_id: string;
  smtp_account_id: string | null;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  received_at?: string | null;
}

export interface IntakeResult {
  notice: BounceNotice | null;
  /** Enrolments this notice stopped. */
  recorded: number;
}

/**
 * Read one inbound message and, if it is a bounce notice, act on it.
 * Never throws: a notice that cannot be handled must not break the sync.
 */
export async function intakeBounceNotice(msg: InboundForBounce, ownAddress?: string | null): Promise<IntakeResult> {
  try {
    const notice = parseBounceNotice({
      fromEmail: msg.from_email,
      subject: msg.subject,
      bodyText: msg.body_text,
      ownAddress,
    });
    if (!notice || notice.kind === 'soft') return { notice, recorded: 0 };

    let recorded = 0;
    for (const email of notice.recipients) {
      if (await recordOne(msg, email, notice)) recorded++;
    }
    return { notice, recorded };
  } catch (err: any) {
    console.error(`[BounceIntake] Could not handle notice ${msg.id}: ${err?.message || err}`);
    return { notice: null, recorded: 0 };
  }
}

async function recordOne(msg: InboundForBounce, email: string, notice: BounceNotice): Promise<boolean> {
  const userId = msg.user_id;

  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id, email')
    .eq('user_id', userId)
    .eq('email', email)
    .maybeSingle();
  if (!contact) return false;

  // The send this answers: the latest one to this person before the notice
  // arrived, preferring one from the mailbox the notice landed in.
  const before = msg.received_at ? new Date(msg.received_at) : new Date();
  const since = new Date(before.getTime() - MATCH_WINDOW_MS).toISOString();
  const { data: sends } = await supabaseAdmin
    .from('campaign_activities')
    .select('campaign_id, campaign_contact_id, step_id, occurred_at, metadata, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .eq('contact_id', contact.id)
    .eq('activity_type', 'sent')
    .gte('occurred_at', since)
    .lte('occurred_at', new Date(before.getTime() + 60_000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(10);
  if (!sends || sends.length === 0) return false;
  const send: any = sends.find((s: any) => s.metadata?.smtp_account_id && s.metadata.smtp_account_id === msg.smtp_account_id)
    || sends[0];
  const accountId: string | null = send.metadata?.smtp_account_id || msg.smtp_account_id || null;

  // Already recorded - by this sweep, the sync, or a refusal at send time.
  const { count } = await supabaseAdmin
    .from('campaign_activities')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_contact_id', send.campaign_contact_id)
    .eq('activity_type', 'bounced');
  if ((count || 0) > 0) return false;

  const { error: actErr } = await supabaseAdmin.from('campaign_activities').insert({
    campaign_id: send.campaign_id,
    campaign_contact_id: send.campaign_contact_id,
    contact_id: contact.id,
    step_id: send.step_id || null,
    activity_type: 'bounced',
    occurred_at: msg.received_at || new Date().toISOString(),
    metadata: {
      source: 'notice',
      bounce_kind: notice.kind,
      status: notice.status,
      reason: notice.reason,
      to: email,
      inbox_message_id: msg.id,
      ...(accountId ? { smtp_account_id: accountId } : {}),
    },
  });
  if (actErr) {
    console.error(`[BounceIntake] Could not record bounce for ${email}: ${actErr.message}`);
    return false;
  }

  // The enrolment stops either way: a follow-up to an address that refused
  // the first email is the same damage again.
  await supabaseAdmin
    .from('campaign_contacts')
    .update({ status: 'bounced', next_send_at: null })
    .eq('id', send.campaign_contact_id)
    .in('status', ['active', 'pending', 'completed']);

  // Only a dead address is the contact's fault. A policy block is the
  // sender's, and the person behind a valid address is kept.
  if (notice.kind === 'address') {
    await supabaseAdmin.from('contacts').update({ is_bounced: true }).eq('id', contact.id);
    suppressionService.add(userId, email, 'bounced', `Bounce notice: ${notice.reason}`).catch(() => {});
  }

  if (accountId) sse.recordBounce(accountId).catch(() => {});
  fireEvent(userId, 'email.bounced', {
    campaign_id: send.campaign_id,
    contact_id: contact.id,
    to: email,
    kind: notice.kind,
    reason: notice.reason,
    source: 'notice',
  }).catch(() => {});

  // Same as a refusal at send time: the evidence changed, so ask now.
  await guardAfterBounce(userId, send.campaign_id);
  checkAndAutoCompleteCampaign(send.campaign_id).catch(() => {});
  return true;
}

/**
 * Mark a message as read for bounces, so the sweep does not read it again.
 * Tolerates a database without the column (migration 077 pending).
 */
export async function markBounceChecked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from('inbox_messages')
    .update({ bounce_checked_at: new Date().toISOString() })
    .in('id', ids);
  if (error && !/bounce_checked_at/.test(error.message)) {
    console.warn(`[BounceIntake] Could not mark messages checked: ${error.message}`);
  }
}
