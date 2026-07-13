import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp, formatFromHeader } from './email-sender.service.js';
import {
  warmupAllowance, warmupDayNumber, warmupIsComplete, warmupSendTarget,
  type WarmupSummary, type WarmupAccountStatus, type SetWarmupInput,
} from '@lemlist/shared';

/* ─── Warm-up Engine ──────────────────────────────────────────────────
   Real warm-up has two jobs: (1) ramp a new mailbox's real-campaign volume
   up gradually (enforced in sse.service via warmupAllowance), and (2) generate
   genuine positive engagement by exchanging friendly emails between the user's
   own inboxes. This service owns enrolment/config, the peer-to-peer send tick,
   and the progress metrics. The inbound side (open / reply / rescue-from-spam)
   is handled by the IMAP engagement worker. */

const WARMUP_SUBJECTS = [
  'Quick question for you', 'Following up on our chat', 'Thoughts on this?',
  'Re: the plan for next week', 'Coffee sometime?', 'Loved your update',
  'Checking in', 'Idea I wanted to share', 'Are you free Thursday?',
  'Notes from the call', 'One more thing', 'Great catching up',
];
const WARMUP_BODIES = [
  'Hey — just wanted to drop you a quick note. Hope the week is going well so far. Talk soon!',
  'Thanks again for the earlier message. This all makes sense to me — let me know if anything changes on your end.',
  'Circling back on this. No rush at all, whenever you get a moment is perfectly fine.',
  'Really appreciated your thoughts on this. Let me chew on it and I\'ll come back with a plan shortly.',
  'Sounds good to me. I\'ll pencil it in and confirm the details a little closer to the day.',
  'Quick one — could you send that over when you have a sec? No urgency whatsoever.',
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Enrol a mailbox in warm-up (or pause it), and set the ramp config. */
async function setWarmup(userId: string, id: string, input: SetWarmupInput) {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, warmup_started_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchErr) throw new AppError(fetchErr.message, 500);
  if (!existing) throw new AppError('Mailbox not found', 404);

  const update: Record<string, any> = { warmup_mode: input.enabled };
  if (input.warmup_daily_target != null) update.warmup_daily_target = Math.max(1, input.warmup_daily_target);
  if (input.warmup_start_volume != null) update.warmup_start_volume = Math.max(1, input.warmup_start_volume);
  if (input.warmup_ramp_days != null) update.warmup_ramp_days = Math.max(1, input.warmup_ramp_days);
  // Starting warm-up (re)sets the ramp clock only when it wasn't already running.
  if (input.enabled && !(existing as any).warmup_started_at) {
    update.warmup_started_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw new AppError(error.message, 500);
  const { smtp_pass_encrypted, ...rest } = data as any;
  return rest;
}

/** Per-mailbox warm-up status + 7-day engagement metrics for the progress UI. */
async function summary(userId: string): Promise<WarmupSummary> {
  const { data: accounts } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const rows = (accounts || []) as any[];
  const peerPool = rows.filter((a) => a.is_active && a.is_verified).length;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: warmupRows } = await supabaseAdmin
    .from('warmup_emails')
    .select('from_account_id, to_account_id, status, is_reply, sent_at')
    .eq('user_id', userId)
    .gte('sent_at', since);
  const events = (warmupRows || []) as any[];

  const statuses: WarmupAccountStatus[] = rows.map((a) => {
    const sent_7d = events.filter((e) => e.from_account_id === a.id && !e.is_reply).length;
    const received_7d = events.filter((e) => e.to_account_id === a.id).length;
    const replied_7d = events.filter((e) => e.to_account_id === a.id && (e.status === 'replied')).length;
    const rescued_7d = events.filter((e) => e.to_account_id === a.id && e.status === 'rescued').length;
    return {
      id: a.id,
      email_address: a.email_address,
      from_name: a.from_name ?? null,
      label: a.label,
      warmup_mode: a.warmup_mode,
      is_verified: a.is_verified,
      health_score: a.health_score,
      day: warmupDayNumber(a.warmup_started_at),
      ramp_days: a.warmup_ramp_days || 30,
      allowance: warmupAllowance(a),
      target: a.warmup_daily_target || a.daily_send_limit,
      start_volume: a.warmup_start_volume || 4,
      complete: warmupIsComplete(a),
      sent_7d, received_7d, replied_7d, rescued_7d,
    };
  });

  return {
    accounts: statuses,
    peer_pool: peerPool,
    total_warming: rows.filter((a) => a.warmup_mode).length,
    sent_7d: events.filter((e) => !e.is_reply).length,
    replied_7d: events.filter((e) => e.status === 'replied').length,
  };
}

/**
 * One warm-up tick — sends a small, spread-out batch of warm-up emails between
 * each user's own verified mailboxes. Designed to run on a short interval so
 * the daily volume trickles out rather than arriving in a burst. Fully guarded:
 * a failure on one mailbox never aborts the rest and never throws.
 */
async function runWarmupTick(maxGlobalSends = 60): Promise<number> {
  const { data: warming } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('warmup_mode', true)
    .eq('is_active', true)
    .eq('is_verified', true);

  const senders = (warming || []) as any[];
  if (senders.length === 0) return 0;

  // Peer pool per user: every active+verified mailbox can receive.
  const userIds = [...new Set(senders.map((s) => s.user_id))];
  const { data: pool } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, user_id, email_address')
    .in('user_id', userIds)
    .eq('is_active', true)
    .eq('is_verified', true);
  const peersByUser = new Map<string, any[]>();
  for (const p of (pool || []) as any[]) {
    if (!peersByUser.has(p.user_id)) peersByUser.set(p.user_id, []);
    peersByUser.get(p.user_id)!.push(p);
  }

  let sent = 0;
  for (const sender of senders) {
    if (sent >= maxGlobalSends) break;
    // Skip if this mailbox already hit today's warm-up quota.
    if ((sender.warmup_sent_today || 0) >= warmupSendTarget(sender)) continue;

    const peers = (peersByUser.get(sender.user_id) || []).filter((p) => p.id !== sender.id);
    if (peers.length === 0) continue; // needs at least one other mailbox to warm with
    const recipient = pick(peers);

    let password: string;
    try { password = decrypt(sender.smtp_pass_encrypted); } catch { continue; }

    const token = crypto.randomBytes(12).toString('hex');
    const subject = pick(WARMUP_SUBJECTS);
    const body = pick(WARMUP_BODIES);
    const domain = (sender.email_address.split('@')[1]) || 'usesincerely.com';
    const messageId = `<wu-${token}@${domain}>`;

    try {
      await sendViaSmtp({
        smtpHost: sender.smtp_host,
        smtpPort: sender.smtp_port,
        smtpSecure: sender.smtp_secure,
        smtpUser: sender.smtp_user,
        smtpPass: password,
        from: formatFromHeader(sender.from_name || sender.label, sender.email_address),
        to: recipient.email_address,
        subject,
        text: body,
        html: `<p>${body}</p>`,
        messageId,
        headers: { 'X-Sincerely-Warmup': token },
      });
    } catch (err: any) {
      console.warn(`[Warmup] send failed ${sender.email_address} → ${recipient.email_address}: ${err.message}`);
      continue;
    }

    await supabaseAdmin.from('warmup_emails').insert({
      user_id: sender.user_id,
      from_account_id: sender.id,
      to_account_id: recipient.id,
      to_email: recipient.email_address,
      subject,
      message_id: messageId,
      token,
      status: 'sent',
    });
    await supabaseAdmin
      .from('smtp_accounts')
      .update({ warmup_sent_today: (sender.warmup_sent_today || 0) + 1 })
      .eq('id', sender.id);
    sender.warmup_sent_today = (sender.warmup_sent_today || 0) + 1;
    sent++;
  }

  return sent;
}

export const warmupService = { setWarmup, summary, runWarmupTick };
