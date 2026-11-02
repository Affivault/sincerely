import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { textToHtml } from '../utils/html.js';
import { AppError } from '../middleware/error.middleware.js';
import { decrypt } from '../utils/encryption.js';
import { imapHostFor as syncImapHostFor } from './inbox-sync.service.js';
import { sendViaSmtp, formatFromHeader } from './email-sender.service.js';
import {
  warmupAllowance, warmupDayNumber, warmupIsComplete, warmupSendTarget,
  rankPeers, poolQuality, POOL_QUALITY_NOTE,
  networkEligible, rotationSeed, composeWarmupMessage, composeWarmupReply, NETWORK_DAILY_RECEIVE_CAP,
  type WarmupSummary, type WarmupAccountStatus, type SetWarmupInput,
} from '@lemlist/shared';
import { guardImap } from '../utils/imap-guard.js';
import { selectInChunks } from '../utils/batch.js';

/* ─── Warm-up Engine ──────────────────────────────────────────────────
   Real warm-up has two jobs: (1) ramp a new mailbox's real-campaign volume
   up gradually (enforced in sse.service via warmupAllowance), and (2) generate
   genuine positive engagement by exchanging friendly emails between the user's
   own inboxes and, for mailboxes that join it, the shared network of other
   Sincerely mailboxes (migration 108). This service owns enrolment/config, the peer-to-peer send tick,
   and the progress metrics. The inbound side (open / reply / rescue-from-spam)
   is handled by the IMAP engagement worker. */

/**
 * Every mailbox in the shared network that may receive warm-up mail right
 * now. Only what ranking needs: no passwords, and nothing of it is ever
 * shown to another account beyond a count.
 */
async function networkPool(): Promise<any[] | null> {
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, user_id, email_address, from_name, smtp_host, warmup_network, autopilot_state, bounce_rate_7d')
    .eq('warmup_network', true)
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('is_seed', false)
    .limit(5000);
  // Before migration 108 the column does not exist: null, so the panel can
  // keep the network hidden rather than offer a button that cannot work.
  if (error) return null;
  return ((data || []) as any[]).filter(networkEligible);
}

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

  const update: Record<string, any> = {};
  if (typeof input.enabled === 'boolean') update.warmup_mode = input.enabled;
  if (typeof input.warmup_network === 'boolean') update.warmup_network = input.warmup_network;
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
  if (Object.keys(update).length === 0) throw new AppError('Nothing to change', 400);

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
  const usable = rows.filter((a) => a.is_active && a.is_verified);
  const peerPool = usable.length;

  /*
   * How good this pool is, not just how big.
   *
   * A count let three mailboxes on one domain read as a working warm-up.
   * Graded from the point of view of the mailboxes actually warming, and
   * reported at its best: if any one of them can reach a different
   * provider, the pool can do that much.
   */
  const joined = usable.filter((a) => a.warmup_network);
  // Asked even when nobody here has joined: it is also how the panel knows
  // whether the network is switched on at all (migration 108).
  const network = usable.length > 0 ? await networkPool() : [];
  const networkPeers = (network || []).filter((p) => p.user_id !== userId);

  const warming = usable.filter((a) => a.warmup_mode);
  // A mailbox in the network is graded against the network as well as its
  // own account, because that is where its mail goes.
  const qualities = (warming.length > 0 ? warming : usable)
    .map((a) => poolQuality(a, a.warmup_network ? [...usable, ...networkPeers] : usable));
  const order = ['none', 'internal', 'same-provider', 'mixed'] as const;
  const best = qualities.length === 0
    ? 'none'
    : order[Math.max(...qualities.map((q) => order.indexOf(q as any)))];
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  /*
   * By mailbox, not by account.
   *
   * A warm-up row belongs to the account that sent it. Once the network
   * carries mail between accounts, filtering on user_id dropped every
   * email a mailbox received from somebody else's, so "received" and
   * "replied" read zero for exactly the mail that matters most.
   */
  const ids = rows.map((a) => a.id);
  let events: any[] = [];
  if (ids.length > 0) {
    const list = ids.join(',');
    const { data: warmupRows } = await supabaseAdmin
      .from('warmup_emails')
      .select('from_account_id, to_account_id, is_reply, sent_at, opened_at, replied_at, rescued_at')
      .or(`from_account_id.in.(${list}),to_account_id.in.(${list})`)
      .gte('sent_at', since)
      .limit(20_000);
    events = (warmupRows || []) as any[];
  }
  const mine = new Set(ids);

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
      warmup_network: !!a.warmup_network,
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
    pool_quality: best,
    pool_note: POOL_QUALITY_NOTE[best],
    total_warming: rows.filter((a) => a.warmup_mode).length,
    sent_7d: events.filter((e) => !e.is_reply && mine.has(e.from_account_id)).length,
    // Replies this account's mail earned, wherever they came from.
    replied_7d: events.filter((e) => e.replied_at && mine.has(e.from_account_id)).length,
    network_peers: networkPeers.length,
    network_joined: joined.length,
    network_available: network !== null,
  };
}

/**
 * One warm-up tick — sends a small, spread-out batch of warm-up emails from
 * each warming mailbox to the best peer it has: its own account's other
 * mailboxes, and, when it has joined the shared network, other Sincerely
 * mailboxes that have joined too. Designed to run on a short interval so
 * the daily volume trickles out rather than arriving in a burst. Fully
 * guarded: a failure on one mailbox never aborts the rest and never throws.
 */
async function runWarmupTick(maxGlobalSends = 60): Promise<number> {
  const { data: warming } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('warmup_mode', true)
    .eq('is_active', true)
    .eq('is_verified', true)
    // A seed mailbox receives placement probes and never sends.
    .eq('is_seed', false);

  const senders = (warming || []) as any[];
  if (senders.length === 0) return 0;

  // Peer pool per user: every active+verified mailbox can receive.
  const userIds = [...new Set(senders.map((s) => s.user_id))];
  const { data: pool } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, user_id, email_address, from_name, smtp_host')
    .in('user_id', userIds)
    .eq('is_active', true)
    .eq('is_verified', true)
    // A seed mailbox receives placement probes and never sends.
    .eq('is_seed', false);
  const peersByUser = new Map<string, any[]>();
  for (const p of (pool || []) as any[]) {
    if (!peersByUser.has(p.user_id)) peersByUser.set(p.user_id, []);
    peersByUser.get(p.user_id)!.push(p);
  }

  const network = (senders.some((s) => s.warmup_network) ? await networkPool() : null) || [];

  /*
   * What each network mailbox has already been sent today.
   *
   * A mailbox that joins lends its inbox to strangers, and a sudden pile of
   * mail from unknown senders is a bad look for it too. Each one takes at
   * most NETWORK_DAILY_RECEIVE_CAP a day from the network, however many
   * mailboxes are warming.
   */
  const receivedToday = new Map<string, number>();
  if (network.length > 0) {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    let today: any[] = [];
    try {
      today = await selectInChunks(network.map((p) => p.id), (slice) => supabaseAdmin
        .from('warmup_emails')
        .select('to_account_id')
        .in('to_account_id', slice)
        .eq('is_reply', false)
        .gte('sent_at', midnight.toISOString()));
    } catch (err: any) {
      // Without the counts the cap cannot be honoured, so the network sits
      // this tick out; own-account warm-up carries on.
      console.warn(`[Warmup] network receive counts failed: ${err.message}`);
      network.length = 0;
    }
    for (const r of today) receivedToday.set(r.to_account_id, (receivedToday.get(r.to_account_id) || 0) + 1);
  }

  let sent = 0;
  for (const sender of senders) {
    if (sent >= maxGlobalSends) break;
    // Skip if this mailbox already hit today's warm-up quota.
    if ((sender.warmup_sent_today || 0) >= warmupSendTarget(sender)) continue;

    /*
     * The most external peer available, not a random one.
     *
     * Reputation is held per sending domain BY EACH RECEIVING PROVIDER, so
     * a warm-up email only teaches anybody anything if it actually reaches
     * a provider that judges your real mail. Ranked: a different provider
     * first, then a different domain at the same provider, then same-domain
     * as a last resort. The network is what makes the first band exist for
     * an account whose mailboxes are all at one provider.
     */
    const own = peersByUser.get(sender.user_id) || [];
    const strangers = sender.warmup_network
      ? network.filter((p) => p.user_id !== sender.user_id && (receivedToday.get(p.id) || 0) < NETWORK_DAILY_RECEIVE_CAP)
      : [];
    const ranked = rankPeers(sender, [...own, ...strangers], rotationSeed(sender.id, sender.warmup_sent_today || 0));
    if (ranked.length === 0) continue; // needs at least one other mailbox
    const recipient = ranked[0];

    let password: string;
    try { password = decrypt(sender.smtp_pass_encrypted); } catch { continue; }

    const token = crypto.randomBytes(12).toString('hex');
    const { subject, body } = composeWarmupMessage(sender, recipient);
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
        html: `<p>${textToHtml(body)}</p>`,
        messageId,
        headers: { 'X-Sincerely-Warmup': token },
      });
    } catch (err: any) {
      console.warn(`[Warmup] send failed ${sender.email_address} → ${recipient.email_address}: ${err.message}`);
      continue;
    }

    const { error: logErr } = await supabaseAdmin.from('warmup_emails').insert({
      user_id: sender.user_id,
      from_account_id: sender.id,
      to_account_id: recipient.id,
      to_email: recipient.email_address,
      subject,
      message_id: messageId,
      token,
      status: 'sent',
    });
    // Unlogged, the receiving side can never open, rescue or reply to it.
    if (logErr) console.warn(`[Warmup] could not log ${messageId}: ${logErr.message}`);
    await supabaseAdmin
      .from('smtp_accounts')
      .update({ warmup_sent_today: (sender.warmup_sent_today || 0) + 1 })
      .eq('id', sender.id);
    sender.warmup_sent_today = (sender.warmup_sent_today || 0) + 1;
    if (recipient.user_id !== sender.user_id) receivedToday.set(recipient.id, (receivedToday.get(recipient.id) || 0) + 1);
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
/*
 * Where warm-up mail goes once it has been opened.
 *
 * Out of the inbox, so the owner never has to read it: in a shared network
 * it comes from strangers. It is opened (and rescued from spam) first,
 * because those are the signals that build reputation; filing it away
 * afterwards is what every warm-up network does.
 */
const WARMUP_FOLDER = 'Sincerely Warm-up';

/*
 * The sync's version, not a second one.
 *
 * There were two functions of this name. Warm-up's honoured the imap_host
 * column all along; the sync's derived a name from smtp_host and ignored
 * it - so the thing that tested a mailbox and the thing that read it
 * disagreed about which server it was on, and three mailboxes reported
 * "Verified" while none could read a reply. They agree now, which is
 * exactly the state the last one was in before it broke.
 */
function warmupImapHost(account: any): string | null {
  const host = syncImapHostFor(account);
  // The shared one always returns a string; warm-up wants to skip a
  // mailbox it cannot place rather than dial "imap.".
  return host && host !== 'imap.' ? host : null;
}

async function connectImap(account: any): Promise<any | null> {
  let ImapFlow: any;
  try { ({ ImapFlow } = await import('imapflow')); } catch { return null; }
  const host = warmupImapHost(account);
  if (!host) return null;
  let password: string;
  try { password = decrypt(account.smtp_pass_encrypted); } catch { return null; }
  const client = guardImap(new ImapFlow({
    host,
    port: account.imap_port || 993,
    secure: account.imap_secure !== false,
    auth: { user: account.imap_user || account.smtp_user || account.email_address, pass: password },
    logger: false,
  }), 'warmup');
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
  // Three days of warm-up mail can name well over a hundred mailboxes; one .in()
  // of that many uuids is past the URL ceiling and came back empty, so every
  // row was then skipped as "mailbox gone".
  const accts = await selectInChunks(acctIds, (slice) => supabaseAdmin.from('smtp_accounts').select('*').in('id', slice));
  const acctById = new Map<string, any>(accts.map((a: any) => [a.id, a]));

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
    // Made once per connection, on first need. A server that will not
    // create folders keeps warm-up mail in the inbox, as it always did.
    let folderReady: boolean | null = null;
    const ensureWarmupFolder = async (): Promise<boolean> => {
      if (folderReady !== null) return folderReady;
      try {
        const existing = await client.list();
        folderReady = (existing || []).some((m: any) => m.path === WARMUP_FOLDER || m.name === WARMUP_FOLDER);
        if (!folderReady) { await client.mailboxCreate(WARMUP_FOLDER); folderReady = true; }
      } catch {
        folderReady = false;
      }
      return folderReady;
    };
    const isGmail = (account.smtp_host || '').includes('gmail') || (account.email_address || '').endsWith('@gmail.com');
    const folders = [{ path: 'INBOX', spam: false }, ...(isGmail ? GMAIL_SPAM : GENERIC_SPAM).map((p) => ({ path: p, spam: true }))];

    try {
      const remaining = new Set(tokenToRow.keys());
      for (const folder of folders) {
        if (remaining.size === 0) break;
        try { await client.mailboxOpen(folder.path); } catch { continue; }
        let scanned = 0;
        // Collect first, act after: ImapFlow queues any command issued while a
        // fetch is still being iterated behind that fetch, which is waiting on
        // this loop, so flagging or moving mid-iteration deadlocks the tick.
        const hits: Array<{ uid: number; token: string }> = [];
        for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
          if (scanned++ > 800 || remaining.size === 0) break; // bound work on busy inboxes
          const token = tokenFromMessageId(msg.envelope?.messageId || '');
          if (!token || !tokenToRow.has(token) || !remaining.has(token)) continue;
          remaining.delete(token);
          hits.push({ uid: msg.uid, token });
        }
        for (const { uid, token } of hits) {
          const row = tokenToRow.get(token);
          try { await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } catch { /* ignore */ }
          if (folder.spam) {
            // Moving it out of spam is the "not spam" signal; filing it in
            // the warm-up folder rather than the inbox keeps it out of sight.
            const to = (await ensureWarmupFolder()) ? WARMUP_FOLDER : 'INBOX';
            try { await client.messageMove(String(uid), to, { uid: true }); row._rescued = true; } catch { /* ignore */ }
          } else if (await ensureWarmupFolder()) {
            try { await client.messageMove(String(uid), WARMUP_FOLDER, { uid: true }); } catch { /* ignore */ }
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
      //
      // Rolled once, on the tick that first sees it opened. Every unreplied
      // row stays in this sweep for three days, and rolling again on each
      // ten-minute pass turned "about a third" into very nearly all of them -
      // a reply rate no human inbox has, which is precisely the pattern
      // warm-up detection looks for.
      const firstOpen = row._opened && !row.opened_at;
      if (firstOpen && !row.is_reply && Math.random() < 0.35) {
        const sender = acctById.get(row.from_account_id);
        if (!sender) continue;
        let password: string;
        try { password = decrypt(account.smtp_pass_encrypted); } catch { continue; }
        const token = crypto.randomBytes(12).toString('hex');
        const domain = (account.email_address.split('@')[1]) || 'usesincerely.com';
        const messageId = `<wu-${token}@${domain}>`;
        const subject = row.subject.startsWith('Re:') ? row.subject : `Re: ${row.subject}`;
        const body = composeWarmupReply(account);
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
            html: `<p>${textToHtml(body)}</p>`,
            messageId,
            // Threaded under the email it answers, as a person's reply is.
            headers: {
              'X-Sincerely-Warmup': token,
              ...(row.message_id ? { 'In-Reply-To': row.message_id, References: row.message_id } : {}),
            },
          });
        } catch { continue; }
        await supabaseAdmin.from('warmup_emails').update({ replied_at: new Date().toISOString() }).eq('id', row.id);
        await supabaseAdmin.from('warmup_emails').insert({
          // The replier's account. In the network that is not the account
          // the original came from.
          user_id: account.user_id,
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
