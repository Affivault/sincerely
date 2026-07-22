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
    .select('id, warmup_started_at, warmup_start_volume, warmup_daily_target')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchErr) throw new AppError(fetchErr.message, 500);
  if (!existing) throw new AppError('Mailbox not found', 404);

  const update: Record<string, any> = { warmup_mode: input.enabled };
  if (input.warmup_daily_target != null) update.warmup_daily_target = Math.max(1, input.warmup_daily_target);
  if (input.warmup_start_volume != null) update.warmup_start_volume = Math.max(1, input.warmup_start_volume);
  if (input.warmup_ramp_days != null) update.warmup_ramp_days = Math.max(1, input.warmup_ramp_days);

  // A ramp that decreases volume over time isn't meaningful and produces a
  // sudden allowance drop on the day warm-up completes (warmupAllowance
  // clamps to `start` throughout the ramp, then jumps straight to `target`).
  // Keep target >= start whenever either changes.
  const resolvedStart = update.warmup_start_volume ?? (existing as any).warmup_start_volume;
  const resolvedTarget = update.warmup_daily_target ?? (existing as any).warmup_daily_target;
  if (resolvedStart != null && resolvedTarget != null && resolvedTarget < resolvedStart) {
    update.warmup_daily_target = resolvedStart;
  }
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
    .select('from_account_id, to_account_id, is_reply, sent_at, opened_at, replied_at, rescued_at')
    .eq('user_id', userId)
    .gte('sent_at', since);
  const events = (warmupRows || []) as any[];

  const statuses: WarmupAccountStatus[] = rows.map((a) => {
    const sent_7d = events.filter((e) => e.from_account_id === a.id && !e.is_reply).length;
    const received_7d = events.filter((e) => e.to_account_id === a.id).length;
    const replied_7d = events.filter((e) => e.to_account_id === a.id && e.replied_at).length;
    const rescued_7d = events.filter((e) => e.to_account_id === a.id && e.rescued_at).length;
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
    replied_7d: events.filter((e) => e.replied_at).length,
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

/* ─── Inbound engagement (IMAP) ───────────────────────────────────────
   The half that actually builds reputation: on the receiving side, warm-up
   mail is opened, rescued from spam back to the inbox, and replied to. We match
   received warm-up messages by their Message-ID (`<wu-TOKEN@domain>`), so no
   fragile header search is needed. Reused connection logic mirrors the inbox
   sync so it behaves consistently with the rest of the app. */

const GMAIL_SPAM = ['[Gmail]/Spam'];
const GENERIC_SPAM = ['Junk', 'Junk Email', 'INBOX.Junk', 'Spam', 'Bulk Mail'];
const WARMUP_REPLIES = [
  'Thanks for this — makes sense. I\'ll take a look and get back to you.',
  'Appreciate the note! All good on my end, talk soon.',
  'Got it, thank you. Let\'s catch up properly next week.',
  'Sounds great — I\'m in. Speak soon!',
  'Perfect, that works for me. Thanks for following up.',
];

function imapHostFor(account: any): string | null {
  const host = (account.imap_host || account.smtp_host || '') as string;
  const email = (account.email_address || '') as string;
  const isGmail = host.includes('gmail') || email.endsWith('@gmail.com');
  const isOutlook = host.includes('outlook') || host.includes('office365');
  if (account.imap_host) return account.imap_host;
  if (isGmail) return 'imap.gmail.com';
  if (isOutlook) return 'outlook.office365.com';
  if (host.startsWith('smtp.')) return host.replace('smtp.', 'imap.');
  const domain = email.split('@')[1];
  return domain ? `imap.${domain}` : null;
}

async function connectImap(account: any): Promise<any | null> {
  let ImapFlow: any;
  try { ({ ImapFlow } = await import('imapflow')); } catch { return null; }
  const host = imapHostFor(account);
  if (!host) return null;
  let password: string;
  try { password = decrypt(account.smtp_pass_encrypted); } catch { return null; }
  const client = new ImapFlow({
    host,
    port: account.imap_port || 993,
    secure: account.imap_secure !== false,
    auth: { user: account.imap_user || account.smtp_user || account.email_address, pass: password },
    logger: false,
  });
  let connectTimeoutId: ReturnType<typeof setTimeout>;
  const connectTimeout = new Promise<never>((_, reject) => {
    connectTimeoutId = setTimeout(() => reject(new Error('connect timeout')), 12000);
  });
  await Promise.race([client.connect(), connectTimeout]).finally(() => clearTimeout(connectTimeoutId));
  return client;
}

const tokenFromMessageId = (mid: string): string | null => {
  const m = /^<wu-([0-9a-f]+)@/.exec(mid || '');
  return m ? m[1] : null;
};

/**
 * One engagement tick — for each mailbox that has recently received warm-up mail,
 * open the messages, rescue any that landed in spam, and reply to a share of
 * them. Bounded per tick and fully guarded so a single flaky IMAP host never
 * stalls the rest.
 */
async function runEngagementTick(maxAccounts = 15): Promise<{ opened: number; replied: number; rescued: number }> {
  const since = new Date(Date.now() - 3 * 86_400_000);
  const { data: pending } = await supabaseAdmin
    .from('warmup_emails')
    .select('*')
    .is('replied_at', null)
    .gte('sent_at', since.toISOString());
  const rows = (pending || []) as any[];
  if (rows.length === 0) return { opened: 0, replied: 0, rescued: 0 };

  const byRecipient = new Map<string, any[]>();
  for (const r of rows) {
    if (!byRecipient.has(r.to_account_id)) byRecipient.set(r.to_account_id, []);
    byRecipient.get(r.to_account_id)!.push(r);
  }

  const acctIds = [...new Set(rows.flatMap((r) => [r.to_account_id, r.from_account_id]))];
  const { data: accts } = await supabaseAdmin.from('smtp_accounts').select('*').in('id', acctIds);
  const acctById = new Map<string, any>((accts || []).map((a: any) => [a.id, a]));

  let opened = 0, replied = 0, rescued = 0, processed = 0;

  for (const [toId, list] of byRecipient) {
    if (processed >= maxAccounts) break;
    const account = acctById.get(toId);
    if (!account || !account.is_active || !account.is_verified) continue;

    let client: any;
    try { client = await connectImap(account); } catch { continue; }
    if (!client) continue;
    processed++;

    const tokenToRow = new Map<string, any>(list.map((r) => [r.token, r]));
    const isGmail = (account.smtp_host || '').includes('gmail') || (account.email_address || '').endsWith('@gmail.com');
    const folders = [{ path: 'INBOX', spam: false }, ...(isGmail ? GMAIL_SPAM : GENERIC_SPAM).map((p) => ({ path: p, spam: true }))];

    try {
      const remaining = new Set(tokenToRow.keys());
      for (const folder of folders) {
        if (remaining.size === 0) break;
        try { await client.mailboxOpen(folder.path); } catch { continue; }
        let scanned = 0;
        for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
          if (scanned++ > 800 || remaining.size === 0) break; // bound work on busy inboxes
          const token = tokenFromMessageId(msg.envelope?.messageId || '');
          if (!token) continue;
          const row = tokenToRow.get(token);
          if (!row) continue;
          remaining.delete(token);
          try { await client.messageFlagsAdd(String(msg.uid), ['\\Seen'], { uid: true }); } catch { /* ignore */ }
          if (folder.spam) {
            try { await client.messageMove(String(msg.uid), 'INBOX', { uid: true }); row._rescued = true; } catch { /* ignore */ }
          }
          row._opened = true;
        }
      }
    } finally {
      try { await client.logout(); } catch { try { client.close(); } catch { /* ignore */ } }
    }

    // Persist open/rescue outcomes and decide which to reply to.
    for (const row of list) {
      const upd: Record<string, any> = {};
      if (row._opened && !row.opened_at) upd.opened_at = new Date().toISOString();
      if (row._rescued && !row.rescued_at) { upd.rescued_at = new Date().toISOString(); rescued++; }
      if (Object.keys(upd).length) {
        await supabaseAdmin.from('warmup_emails').update(upd).eq('id', row.id);
        if (upd.opened_at) opened++;
      }
      // Reply to ~35% of opened, non-reply warm-up mail (keeps threads human).
      if (row._opened && !row.is_reply && Math.random() < 0.35) {
        const sender = acctById.get(row.from_account_id);
        if (!sender) continue;
        let password: string;
        try { password = decrypt(account.smtp_pass_encrypted); } catch { continue; }
        const token = crypto.randomBytes(12).toString('hex');
        const domain = (account.email_address.split('@')[1]) || 'usesincerely.com';
        const messageId = `<wu-${token}@${domain}>`;
        const subject = row.subject.startsWith('Re:') ? row.subject : `Re: ${row.subject}`;
        const body = pick(WARMUP_REPLIES);
        try {
          await sendViaSmtp({
            smtpHost: account.smtp_host,
            smtpPort: account.smtp_port,
            smtpSecure: account.smtp_secure,
            smtpUser: account.smtp_user,
            smtpPass: password,
            from: formatFromHeader(account.from_name || account.label, account.email_address),
            to: sender.email_address,
            subject,
            text: body,
            html: `<p>${body}</p>`,
            messageId,
            headers: { 'X-Sincerely-Warmup': token },
          });
        } catch { continue; }
        await supabaseAdmin.from('warmup_emails').update({ replied_at: new Date().toISOString() }).eq('id', row.id);
        await supabaseAdmin.from('warmup_emails').insert({
          user_id: row.user_id,
          from_account_id: account.id,
          to_account_id: sender.id,
          to_email: sender.email_address,
          subject,
          message_id: messageId,
          token,
          status: 'sent',
          is_reply: true,
        });
        replied++;
      }
    }
  }

  return { opened, replied, rescued };
}

export const warmupService = { setWarmup, summary, runWarmupTick, runEngagementTick };
