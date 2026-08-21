import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/encryption.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { detectAutoReply } from '../utils/auto-reply.js';
import { processReply } from './sara.service.js';
import { fireEvent } from './webhook.service.js';
import { markReplied, stopOtherCampaignsForContact } from './sequence.service.js';
import {
  advanceCursor,
  BACKFILL_BATCH,
  floorToDay,
  planBackfill,
  planForward,
  windowStart,
} from '../utils/imap-window.js';
import { DEFAULT_SYNC_WINDOW_MONTHS, isSyncWindow } from '@lemlist/shared';
import type { InboxSyncResult, SyncFolderRole, SyncWindowMonths } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Reading a mailbox.

   What this replaced fetched the last seven days of INBOX on first
   connection, hardcoded, and nothing else ever. Three consequences, all of
   them things people noticed and none of them things they could fix:

     · The inbox opened nearly empty. A reply to a campaign sent three
       weeks earlier simply was not there.

     · Every thread was one-sided, because the Sent folder was never read.
       You could see what a prospect said and not what you had said to
       them.

     · Each subsequent run asked for everything since the stored timestamp
       — but IMAP's SINCE compares dates, not instants, so it re-read the
       whole of the current day every time and then spent one database
       query per message finding out it already had each one.

   Now: a chosen window of one, three or six months; new mail fetched by
   UID, which is exact; history walked backwards in bounded slices that
   remember where they stopped; and both INBOX and Sent, so a conversation
   reads as a conversation.
   ═══════════════════════════════════════════════════════════════════════ */

/** Ceiling on messages ingested per account per run, across all folders. */
const PER_RUN_LIMIT = 400;

/** The whole run is bounded, so an unreachable server cannot hold a request open. */
const CONNECT_TIMEOUT_MS = 15_000;

interface SyncAccount {
  id: string;
  user_id: string;
  email_address: string;
  smtp_host: string;
  smtp_user: string | null;
  imap_user: string | null;
  smtp_pass_encrypted: string;
  last_inbox_sync_at: string | null;
  inbox_sync_months: number | null;
}

interface FolderTarget {
  path: string;
  role: SyncFolderRole;
}

interface FolderState {
  folder: string;
  uid_validity: number | null;
  last_uid: number | null;
  backfill_cursor: string | null;
  backfill_done: boolean;
}

/** IMAP host from the SMTP host, which is how every provider names them. */
export function imapHostFor(account: { smtp_host?: string | null; email_address?: string | null }): string {
  const host = account.smtp_host || '';
  if (host.includes('smtp.gmail')) return 'imap.gmail.com';
  if (host.includes('smtp.outlook') || host.includes('office365')) return 'outlook.office365.com';
  if (host.includes('smtp.')) return host.replace('smtp.', 'imap.');
  return `imap.${(account.email_address || '').split('@')[1] || ''}`;
}

/**
 * Which mailbox holds sent mail.
 *
 * Providers disagree — "[Gmail]/Sent Mail", "Sent Items", "Sent". The IMAP
 * special-use flag (\Sent) is the only reliable answer, so it is tried
 * first, and the names are the fallback for servers that do not publish it.
 */
export function pickSentFolder(list: Array<{ path: string; specialUse?: string; name?: string }>): string | null {
  const bySpecialUse = list.find((box) => box.specialUse === '\\Sent');
  if (bySpecialUse) return bySpecialUse.path;

  const candidates = ['[Gmail]/Sent Mail', 'Sent Items', 'Sent', 'INBOX.Sent', 'Sent Messages'];
  for (const name of candidates) {
    const match = list.find((box) => box.path.toLowerCase() === name.toLowerCase());
    if (match) return match.path;
  }
  return null;
}

/** The window this mailbox was configured for, defaulting safely. */
function windowFor(account: SyncAccount): SyncWindowMonths {
  return isSyncWindow(account.inbox_sync_months)
    ? (account.inbox_sync_months as SyncWindowMonths)
    : DEFAULT_SYNC_WINDOW_MONTHS;
}

async function loadFolderState(accountId: string, folder: string, role: SyncFolderRole): Promise<FolderState> {
  const { data } = await supabaseAdmin
    .from('imap_folder_state')
    .select('folder, uid_validity, last_uid, backfill_cursor, backfill_done')
    .eq('smtp_account_id', accountId)
    .eq('folder', folder)
    .maybeSingle();

  if (data) return data as FolderState;

  // Created on first sight rather than on connect, so a provider that
  // renames or hides a folder simply never gets a row for it.
  await supabaseAdmin
    .from('imap_folder_state')
    .insert({ smtp_account_id: accountId, folder, role })
    .select('folder')
    .maybeSingle();

  return { folder, uid_validity: null, last_uid: null, backfill_cursor: null, backfill_done: false };
}

async function saveFolderState(accountId: string, folder: string, patch: Record<string, any>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('imap_folder_state')
    .update(patch)
    .eq('smtp_account_id', accountId)
    .eq('folder', folder);
  if (error) console.warn(`[InboxSync] Could not save folder state for ${folder}:`, error.message);
}

/**
 * Which of these Message-IDs this account already holds.
 *
 * One query for a whole page, rather than the query-per-message the old
 * sync did. On a re-read of a busy day that was hundreds of round trips to
 * be told "yes" hundreds of times.
 */
async function alreadyStored(userId: string, messageIds: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  const ids = messageIds.filter(Boolean);
  if (ids.length === 0) return held;

  const PAGE = 200;
  for (let from = 0; from < ids.length; from += PAGE) {
    const { data } = await supabaseAdmin
      .from('inbox_messages')
      .select('message_id')
      .eq('user_id', userId)
      .in('message_id', ids.slice(from, from + PAGE));
    for (const row of data || []) if (row.message_id) held.add(row.message_id);
  }
  return held;
}

/** True when an insert failed only because the row is already there. */
function isDuplicate(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
}

interface IngestContext {
  account: SyncAccount;
  folder: string;
  role: SyncFolderRole;
  aiTaggingOn: boolean;
  simpleParser: (source: any) => Promise<any>;
}

/**
 * Store one message, and do what storing it implies.
 *
 * Returns whether a row was created, so a run can report what it actually
 * added rather than what it looked at.
 */
async function ingest(msg: any, ctx: IngestContext): Promise<boolean> {
  const envelope = msg.envelope;
  if (!envelope) return false;

  const { account, folder, role } = ctx;
  const userId = account.user_id;
  const outbound = role === 'sent';

  const fromEmail = envelope.from?.[0]?.address || '';
  const toEmail = envelope.to?.[0]?.address || '';
  const subject = envelope.subject || '';
  const messageId = envelope.messageId || '';
  const inReplyTo = envelope.inReplyTo || '';

  let bodyText = '';
  let bodyHtml: string | undefined;
  let parsedHeaders: unknown = null;
  try {
    const parsed = await ctx.simpleParser(msg.source || '');
    bodyText = parsed.text || '';
    bodyHtml = parsed.html || undefined;
    parsedHeaders = parsed.headers;
  } catch {
    const src = typeof msg.source === 'string' ? msg.source : (msg.source || '').toString();
    const bodyStart = src.indexOf('\r\n\r\n');
    bodyText = bodyStart !== -1 ? src.slice(bodyStart + 4).trim() : '';
  }

  /*
   * Sent mail is stored for the thread and nothing else. It is not a reply,
   * it must not stop a campaign, and running it through reply detection
   * would have this platform treat its own outgoing mail as a prospect
   * answering — which is exactly the kind of thing that quietly corrupts a
   * reply rate.
   */
  const autoReply = outbound ? { kind: null as string | null, reason: '' } : detectAutoReply(parsedHeaders, subject, bodyText);

  let matchedActivity: any = null;
  if (!outbound) {
    if (inReplyTo) {
      const { data } = await supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, campaign_contact_id, contact_id, step_id, campaigns!inner(user_id)')
        .eq('activity_type', 'sent')
        .eq('message_id', inReplyTo)
        .eq('campaigns.user_id', userId)
        .maybeSingle();
      matchedActivity = data;
    }
    if (!matchedActivity && fromEmail) {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('email', fromEmail.toLowerCase())
        .eq('user_id', userId)
        .maybeSingle();
      if (contact) {
        const { data: cc } = await supabaseAdmin
          .from('campaign_contacts')
          .select('id, campaign_id, contact_id')
          .eq('contact_id', contact.id)
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cc) matchedActivity = { campaign_id: cc.campaign_id, campaign_contact_id: cc.id, contact_id: cc.contact_id };
      }
    }
  }

  const row: any = {
    user_id: userId,
    smtp_account_id: account.id,
    from_email: fromEmail,
    to_email: toEmail,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    message_id: messageId || undefined,
    in_reply_to: inReplyTo || undefined,
    direction: outbound ? 'outbound' : 'inbound',
    // Mail this account sent has, by definition, been read by its sender.
    is_read: outbound,
    received_at: envelope.date || new Date().toISOString(),
    imap_uid: msg.uid || null,
    imap_folder: folder,
    auto_reply_kind: autoReply.kind,
  };
  if (matchedActivity) {
    row.campaign_id = matchedActivity.campaign_id;
    row.contact_id = matchedActivity.contact_id;
    row.campaign_contact_id = matchedActivity.campaign_contact_id;
  }

  let { data: saved, error: insErr } = await supabaseAdmin
    .from('inbox_messages')
    .insert(row)
    .select('id')
    .maybeSingle();

  // A database without migration 043 has no auto_reply_kind column. Losing
  // every inbound message because a migration is pending would be far worse
  // than losing the classification.
  if (insErr && /auto_reply_kind/.test(insErr.message)) {
    const { auto_reply_kind: _dropped, ...withoutKind } = row;
    ({ data: saved, error: insErr } = await supabaseAdmin
      .from('inbox_messages')
      .insert(withoutKind)
      .select('id')
      .maybeSingle());
  }

  // The unique indexes from migration 048 are the real dedupe now, and two
  // overlapping syncs racing on the same message is exactly what they are
  // for. Losing that race is a success, not an error.
  if (isDuplicate(insErr)) return false;

  if (insErr || !saved?.id) {
    console.error('[InboxSync] Insert failed:', insErr?.message);
    return false;
  }

  if (!outbound && matchedActivity) {
    const { error: actErr } = await supabaseAdmin.from('campaign_activities').insert({
      campaign_id: matchedActivity.campaign_id,
      campaign_contact_id: matchedActivity.campaign_contact_id,
      contact_id: matchedActivity.contact_id,
      step_id: matchedActivity.step_id || null,
      activity_type: autoReply.kind ? 'auto_reply' : 'replied',
      message_id: messageId || null,
      metadata: {
        from: fromEmail,
        subject,
        inbox_message_id: saved.id,
        ...(autoReply.kind ? { auto_reply_kind: autoReply.kind, auto_reply_reason: autoReply.reason } : {}),
      },
    });
    if (actErr) console.error('[InboxSync] Failed to record inbound activity:', actErr.message);

    if (!autoReply.kind) {
      const { data: enrolment } = await supabaseAdmin
        .from('campaign_contacts')
        .select('id, campaigns!inner(stop_on_reply)')
        .eq('id', matchedActivity.campaign_contact_id)
        .maybeSingle();

      if (enrolment && (enrolment as any).campaigns?.stop_on_reply !== false) {
        await markReplied(matchedActivity.campaign_contact_id);
        await stopOtherCampaignsForContact(userId, matchedActivity.contact_id, matchedActivity.campaign_contact_id);
      }

      fireEvent(userId, 'email.replied', {
        campaign_id: matchedActivity.campaign_id,
        contact_id: matchedActivity.contact_id,
        from: fromEmail,
        subject,
      }).catch(() => {});
    }
  }

  if (!outbound && ctx.aiTaggingOn && !autoReply.kind) {
    processReply(saved.id).catch((e: any) => {
      console.warn('[InboxSync] AI tag failed for', saved.id, ':', e?.message || String(e));
    });
  }

  return true;
}

/**
 * Fetch a range, skipping anything already held, and store the rest.
 *
 * In two passes, and the reason is memory. A run may look at four hundred
 * messages, and a message with attachments is not small — holding four
 * hundred complete ones at once is tens of megabytes on a host that has
 * 512MB for everything, and a six month backfill is precisely when that
 * happens.
 *
 * So the first pass asks only for envelopes, which are a line each. That is
 * enough to check the whole page's Message-IDs in one query and find out
 * which of them are actually new. The second pass then downloads only those
 * bodies, a small page at a time, and lets each page go before asking for
 * the next.
 *
 * The bandwidth follows the memory: mail we already hold is never
 * downloaded a second time, which on a re-read of a busy day is most of it.
 */
const SOURCE_PAGE = 25;

async function ingestRange(
  client: any,
  range: any,
  options: { uid?: boolean },
  ctx: IngestContext,
  budget: number,
): Promise<{ stored: number; highestUid: number }> {
  const heads: Array<{ uid: number; messageId: string }> = [];
  for await (const msg of client.fetch(range, { envelope: true, uid: true }, options)) {
    heads.push({ uid: Number(msg.uid) || 0, messageId: msg.envelope?.messageId || '' });
    if (heads.length >= budget) break;
  }
  if (heads.length === 0) return { stored: 0, highestUid: 0 };

  let highestUid = 0;
  for (const head of heads) if (head.uid > highestUid) highestUid = head.uid;

  const held = await alreadyStored(
    ctx.account.user_id,
    heads.map((h) => h.messageId).filter(Boolean),
  );

  // A message with no UID cannot be asked for again by UID, so there is no
  // second pass to make for it. Servers that answer a uid: true fetch
  // without one do not exist in practice; this is only so that one could not
  // wedge the loop.
  const wanted = heads.filter((h) => h.uid > 0 && !(h.messageId && held.has(h.messageId)));
  if (wanted.length === 0) return { stored: 0, highestUid };

  let stored = 0;
  for (let from = 0; from < wanted.length; from += SOURCE_PAGE) {
    const page = wanted.slice(from, from + SOURCE_PAGE);
    const batch: any[] = [];
    // Fetched fully before any of it is parsed: the database round trips
    // that ingest makes would otherwise sit inside the fetch, holding a
    // connection open on both ends for as long as they take.
    for await (const msg of client.fetch(
      page.map((h) => h.uid).join(','),
      { envelope: true, source: true, uid: true },
      { uid: true },
    )) {
      batch.push(msg);
    }
    for (const msg of batch) {
      if (await ingest(msg, ctx)) stored += 1;
    }
    batch.length = 0;
  }
  return { stored, highestUid };
}

export const inboxSyncService = {
  /**
   * How far back each mailbox actually reaches, and whether it is still
   * fetching.
   *
   * Reported from what is stored rather than from the setting, because the
   * two differ for as long as a backfill is running — and "you asked for six
   * months" is not the same statement as "you have six months".
   */
  async progress(userId: string) {
    const { data: accounts } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id, email_address, inbox_sync_months, last_inbox_sync_at, last_inbox_sync_error')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    const out = [];
    for (const account of accounts || []) {
      const [{ data: oldest }, { count }, { data: states }] = await Promise.all([
        supabaseAdmin
          .from('inbox_messages')
          .select('received_at')
          .eq('smtp_account_id', account.id)
          .order('received_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('inbox_messages')
          .select('id', { count: 'exact', head: true })
          .eq('smtp_account_id', account.id),
        supabaseAdmin
          .from('imap_folder_state')
          .select('backfill_done')
          .eq('smtp_account_id', account.id),
      ]);

      // Complete only when every folder is, and only when at least one folder
      // has actually been looked at — no rows means nothing has run yet.
      const rows = states || [];
      out.push({
        smtp_account_id: account.id,
        email_address: account.email_address,
        window_months: isSyncWindow(account.inbox_sync_months)
          ? (account.inbox_sync_months as SyncWindowMonths)
          : DEFAULT_SYNC_WINDOW_MONTHS,
        oldest_synced_at: oldest?.received_at ?? null,
        history_complete: rows.length > 0 && rows.every((r: any) => r.backfill_done),
        stored: count || 0,
        last_synced_at: account.last_inbox_sync_at ?? null,
        last_error: account.last_inbox_sync_error ?? null,
      });
    }
    return out;
  },

  /**
   * Read every connected mailbox: new mail first, then a slice of history.
   *
   * New mail before history on purpose. A run is bounded, and if the order
   * were reversed a six-month backfill would hold today's replies back for
   * as long as it took to finish.
   */
  async syncInbox(userId: string): Promise<InboxSyncResult> {
    const { data: accounts, error: dbError } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id, user_id, smtp_host, smtp_user, imap_user, smtp_pass_encrypted, email_address, last_inbox_sync_at, inbox_sync_months')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (dbError) {
      console.error('[InboxSync] DB error fetching accounts:', dbError.message);
      return { synced: 0, newMessages: 0, backfilled: 0, more: false, errors: ['Could not fetch mailboxes'] };
    }
    if (!accounts || accounts.length === 0) {
      return { synced: 0, newMessages: 0, backfilled: 0, more: false };
    }

    let ImapFlow: any;
    let simpleParser: any;
    try {
      ({ ImapFlow } = await import('imapflow'));
      ({ simpleParser } = await import('mailparser'));
    } catch (importErr: any) {
      console.error('[InboxSync] IMAP modules not available:', importErr.message);
      return {
        synced: 0, newMessages: 0, backfilled: 0, more: false,
        errors: ['IMAP modules not available — install imapflow and mailparser'],
      };
    }

    const aiTaggingOn = await isAiTaggingEnabled(userId);
    const errors: string[] = [];
    let totalNew = 0;
    let totalBackfilled = 0;
    let more = false;

    for (const raw of accounts as SyncAccount[]) {
      let client: any = null;
      let budget = PER_RUN_LIMIT;
      try {
        const password = decrypt(raw.smtp_pass_encrypted);
        const host = imapHostFor(raw);
        const ip = await resolveHostIp(host).catch(() => null);

        client = new ImapFlow({
          host: ip || host,
          port: 993,
          secure: true,
          servername: host,
          auth: { user: raw.imap_user || raw.smtp_user || raw.email_address, pass: password },
          logger: false,
          emitLogs: false,
        });

        let connectTimeoutId: ReturnType<typeof setTimeout>;
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => {
            connectTimeoutId = setTimeout(() => reject(new Error('IMAP connection timed out')), CONNECT_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(connectTimeoutId!));

        // INBOX always; Sent when the server will say where it is.
        const targets: FolderTarget[] = [{ path: 'INBOX', role: 'inbox' }];
        try {
          const boxes = await client.list();
          const sent = pickSentFolder(boxes || []);
          if (sent) targets.push({ path: sent, role: 'sent' });
        } catch {
          // A server that will not list its folders still has an INBOX.
        }

        const months = windowFor(raw);
        const floor = windowStart(months);

        for (const target of targets) {
          if (budget <= 0) { more = true; break; }

          const state = await loadFolderState(raw.id, target.path, target.role);
          const mailbox = await client.mailboxOpen(target.path);
          const ctx: IngestContext = {
            account: raw, folder: target.path, role: target.role, aiTaggingOn, simpleParser,
          };

          /* ---- new mail ---- */
          const forward = planForward(
            state,
            { uidValidity: Number(mailbox?.uidValidity) || null },
            raw.last_inbox_sync_at ? new Date(raw.last_inbox_sync_at) : floorToDay(new Date()),
          );

          const forwardResult = forward.uidRange
            ? await ingestRange(client, forward.uidRange, { uid: true }, ctx, budget)
            : await ingestRange(client, { since: forward.since }, {}, ctx, budget);

          totalNew += forwardResult.stored;
          budget -= forwardResult.stored;

          const nextUid = Math.max(forwardResult.highestUid, forward.uidReset ? 0 : Number(state.last_uid) || 0);
          await saveFolderState(raw.id, target.path, {
            uid_validity: Number(mailbox?.uidValidity) || null,
            ...(nextUid > 0 ? { last_uid: nextUid } : {}),
            // A renumbered mailbox has to be read again from the window edge.
            ...(forward.uidReset ? { backfill_cursor: null, backfill_done: false } : {}),
          });

          /* ---- one slice of history ---- */
          if (budget > 0) {
            const slice = planBackfill(
              forward.uidReset ? { backfill_cursor: null, backfill_done: false } : state,
              months,
            );
            if (slice) {
              const back = await ingestRange(
                client,
                { since: slice.since, before: slice.before },
                {},
                ctx,
                Math.min(budget, BACKFILL_BATCH),
              );
              totalBackfilled += back.stored;
              budget -= back.stored;

              const moved = advanceCursor(slice);
              await saveFolderState(raw.id, target.path, {
                backfill_cursor: moved.cursor,
                backfill_done: moved.done,
              });
              if (!moved.done) more = true;
            }
          } else {
            more = true;
          }
        }

        await supabaseAdmin
          .from('smtp_accounts')
          .update({ last_inbox_sync_at: new Date().toISOString(), last_inbox_sync_error: null })
          .eq('id', raw.id);

        await client.logout().catch(() => {});
        client = null;
        console.log(`[InboxSync] ${raw.email_address}: ${totalNew} new, ${totalBackfilled} from history`);
      } catch (err: any) {
        const friendly = categoriseImapError(err.message || String(err));
        console.error(`[InboxSync] Failed for ${raw.email_address}:`, err.message);
        errors.push(`${raw.email_address}: ${friendly}`);
        // Recorded so the mailbox can say why it is empty rather than just
        // being empty.
        await supabaseAdmin
          .from('smtp_accounts')
          .update({ last_inbox_sync_error: friendly })
          .eq('id', raw.id)
          .then(() => {}, () => {});
        if (client) { try { await client.logout(); } catch { /* ignore */ } }
      }
    }

    return {
      synced: accounts.length,
      newMessages: totalNew,
      backfilled: totalBackfilled,
      more,
      ...(errors.length > 0 ? { errors } : {}),
    };
  },
};

/** Whether SARA should classify what arrives. Never blocks a sync. */
async function isAiTaggingEnabled(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('ai_tagging_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.ai_tagging_enabled !== false;
  } catch {
    return false;
  }
}

/** IMAP failures in words somebody can act on. */
export function categoriseImapError(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid credentials') || m.includes('authenticationfailed') || m.includes('auth')) {
    return 'The mailbox rejected the login. Update the password (or app password) on this account.';
  }
  if (m.includes('timed out') || m.includes('timeout')) {
    return 'The mail server did not respond in time. It may be slow or unreachable from here.';
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) {
    return 'The IMAP host could not be found. Check the server address on this account.';
  }
  if (m.includes('econnrefused')) {
    return 'The mail server refused the connection on port 993.';
  }
  if (m.includes('certificate') || m.includes('self signed')) {
    return 'The mail server presented a certificate that could not be verified.';
  }
  return message || 'The mailbox could not be read.';
}
