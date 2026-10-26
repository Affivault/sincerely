import { settingsService } from './settings.service.js';
import { aiAvailable, draftReply } from './ai.service.js';
import { stripQuoted, htmlToText as plainFromHtml, NON_PERSON_KINDS } from '../utils/mail-kind.js';
import { mailSortService, mailKindReady, PEOPLE_FILTER } from './mail-sort.service.js';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { replyQueueService } from './reply-queue.service.js';
import { escapeHtml, textToHtml } from '../utils/html.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';
import { decrypt } from '../utils/encryption.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { sendViaSmtp, formatFromHeader } from './email-sender.service.js';
import { htmlToText } from './sequence.service.js';
import { SaraStatus, stripDashes } from '@lemlist/shared';
import { billingService } from './billing.service.js';
import { inboxSyncService, imapHostFor } from './inbox-sync.service.js';
import { guardImap } from '../utils/imap-guard.js';
import { selectInChunks } from '../utils/batch.js';
import { isDraining } from '../utils/heartbeat.js';
import { notSnoozedFilter, snoozeReady, remindersReady, assignReady, inboxRemindersService, nudgeAtFor } from './inbox-reminders.service.js';
import { inboxAssignService } from './inbox-assign.service.js';
import { prepareOutgoingAttachments } from './inbox-attachments.service.js';
import { isNudgeDays, type AttachmentMeta } from '@lemlist/shared';

/** Reserve a monthly-quota slot before an interactive send; throws if over cap. */
async function assertSendQuota(userId: string): Promise<void> {
  if (!(await billingService.reserveEmailQuota(userId))) {
    throw new AppError("You've reached your monthly email limit. Upgrade to send more.", 403, 'UPGRADE_REQUIRED');
  }
}

/** Run a send with a reserved quota slot; refund the slot if the send fails. */
async function sendWithQuotaRefund<T>(userId: string, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    await billingService.refundEmailQuota(userId);
    throw err;
  }
}



/**
 * Two-way archive sync: archive (or unarchive) messages on the remote
 * IMAP server so the change is reflected in Gmail / Outlook etc.
 *
 * For Gmail: move to "[Gmail]/All Mail" to archive, copy back to INBOX
 * to unarchive (Gmail keeps a single canonical copy in All Mail).
 * For everyone else: move to a standard "Archive" folder, fall back to
 * "INBOX.Archive" or whatever the server supports.
 *
 * Best-effort. Failures are logged but never break the DB-level archive.
 */
async function syncArchiveToImap(
  userId: string,
  inboxMessageIds: string[],
  archive: boolean
): Promise<void> {
  if (inboxMessageIds.length === 0) return;

  // Lazy-load IMAP — sync may be deployed where IMAP isn't installed
  let ImapFlow: any;
  try {
    ({ ImapFlow } = await import('imapflow'));
  } catch {
    return;
  }

  // Fetch messages with their UIDs + account info
  const messages = await selectInChunks(inboxMessageIds, (slice) => supabaseAdmin
    .from('inbox_messages')
    .select('id, imap_uid, imap_folder, smtp_account_id')
    .in('id', slice)
    .eq('user_id', userId)
    .not('imap_uid', 'is', null)).catch((e: Error) => {
    console.error('[Inbox] IMAP archive sync lookup failed:', e.message);
    return [] as any[];
  });

  if (messages.length === 0) return;

  // Group by SMTP account so we only open one IMAP connection per account
  const byAccount = new Map<string, any[]>();
  for (const m of messages) {
    if (!m.smtp_account_id) continue;
    if (!byAccount.has(m.smtp_account_id)) byAccount.set(m.smtp_account_id, []);
    byAccount.get(m.smtp_account_id)!.push(m);
  }

  for (const [accountId, msgs] of byAccount) {
    const { data: account } = await supabaseAdmin
      .from('smtp_accounts')
      .select('smtp_host, smtp_user, imap_host, imap_port, imap_secure, imap_user, smtp_pass_encrypted, email_address')
      .eq('id', accountId)
      .single();
    if (!account) continue;

    let password: string;
    try {
      password = decrypt(account.smtp_pass_encrypted);
    } catch (decryptErr: any) {
      console.warn('[IMAP archive] failed to decrypt password for account', accountId, decryptErr?.message);
      continue;
    }
    const host = account.smtp_host || '';
    const isGmail = host.includes('gmail') || (account.email_address || '').endsWith('@gmail.com');

    /*
     * The server the sync reads, not a third guess at it.
     *
     * This derived its own IMAP host from smtp_host and dialled 993 with TLS
     * regardless, ignoring the imap_host/port/secure the account was set up
     * with - the same mistake that once had the sync reading the wrong
     * server, surviving here after it was fixed there. For a hosted mailbox
     * (Spacemail, Titan, Private Email) that name does not exist, so every
     * archive in the app quietly failed to reach the real inbox.
     */
    const imapHost = imapHostFor(account);
    if (!imapHost || imapHost === 'imap.') {
      console.warn('[IMAP archive] cannot determine IMAP host for account', accountId, '— skipping');
      continue;
    }

    const imapIp = await resolveHostIp(imapHost).catch(() => null);
    const client = guardImap(new ImapFlow({
      host: imapIp || imapHost,
      port: account.imap_port || 993,
      secure: account.imap_secure !== false,
      servername: imapHost,
      auth: { user: account.imap_user || account.smtp_user || account.email_address, pass: password },
      logger: false,
    }), 'inbox');

    try {
      let connectTimeoutId: ReturnType<typeof setTimeout>;
      const connectTimeout = new Promise<never>((_, reject) => {
        connectTimeoutId = setTimeout(() => reject(new Error('connect timeout')), 12000);
      });
      await Promise.race([client.connect(), connectTimeout]).finally(() => clearTimeout(connectTimeoutId));

      // Candidate target folders (first one that works wins).
      const archiveTargets = isGmail
        ? ['[Gmail]/All Mail']
        : ['Archive', 'INBOX.Archive', 'Archived', 'All Mail'];
      const targetCandidates = archive ? archiveTargets : ['INBOX'];

      // Group messages by source folder so we open each mailbox once.
      // On archive, source is always INBOX. On unarchive, source is whichever
      // folder we previously moved the message to (stored on the row).
      const bySource = new Map<string, any[]>();
      for (const m of msgs) {
        if (!m.imap_uid) continue;
        /*
         * A UID means something only inside the folder it came from. Archive
         * used to open INBOX for every message, so archiving one synced from
         * Sent or Junk moved whichever INBOX message happened to hold that
         * number - somebody else's email, in the real mailbox. Only a message
         * that is in INBOX is archived there; anything else is left alone.
         */
        const folder = m.imap_folder || 'INBOX';
        if (archive && folder.toUpperCase() !== 'INBOX') continue;
        const src = archive
          ? folder
          : (m.imap_folder && m.imap_folder.toUpperCase() !== 'INBOX' ? m.imap_folder : archiveTargets[0]);
        if (!bySource.has(src)) bySource.set(src, []);
        bySource.get(src)!.push(m);
      }

      for (const [sourceFolder, sourceMsgs] of bySource) {
        try {
          await client.mailboxOpen(sourceFolder);
        } catch (openErr: any) {
          console.warn('[IMAP archive] cannot open source folder', sourceFolder, openErr?.message);
          continue;
        }

        for (const m of sourceMsgs) {
          let moved = false;
          for (const target of targetCandidates) {
            if (target === sourceFolder) continue;
            try {
              const result: any = await client.messageMove(String(m.imap_uid), target, { uid: true });
              // imapflow returns { path, destination, uidMap: Map<srcUid, dstUid> }
              // Capture the new UID so future archive/unarchive on this row still works.
              let newUid: number | null = null;
              const map = result?.uidMap;
              if (map && typeof map.get === 'function') {
                const mapped = map.get(Number(m.imap_uid)) ?? map.get(m.imap_uid);
                if (typeof mapped === 'number') newUid = mapped;
              }
              // The old UID is meaningless in the new folder. Without the new
              // one (a server with no UIDPLUS) the row stops syncing rather
              // than keep a number that would move a different message later.
              const updatePayload: Record<string, any> = { imap_folder: target, imap_uid: newUid };
              await supabaseAdmin
                .from('inbox_messages')
                .update(updatePayload)
                .eq('id', m.id);
              moved = true;
              break;
            } catch { /* try next target */ }
          }
          if (!moved) {
            console.warn('[IMAP archive] no target folder worked for uid', m.imap_uid, 'from', sourceFolder);
          }
        }
      }
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }
}

/**
 * Who a reply goes to.
 *
 * The other party, whichever way the message went. Replying from a thread
 * where the latest message is one of ours used to address the reply to
 * from_email - our own mailbox - so the follow-up landed in our own inbox
 * and the prospect never saw it.
 */
/**
 * A LinkedIn message (095) has no mailbox behind it. Answering it by email
 * would start a second conversation the person never asked for, from an
 * address they may never have given, so the inbox sends them to LinkedIn.
 */
function refuseLinkedinReply(original: { channel?: string | null }): void {
  if (original.channel === 'linkedin') {
    throw new AppError('This message came in on LinkedIn. Answer it on LinkedIn, or write them a new email.', 400);
  }
}

function replyRecipient(original: { direction?: string | null; from_email?: string | null; to_email?: string | null }): string {
  const to = original.direction === 'outbound' ? original.to_email : original.from_email;
  if (!to) throw new AppError('This message has no address to reply to', 400);
  return to;
}

/**
 * The headers every interactive send shares with a campaign send.
 *
 * Replies, forwards and composed mail went out with a bare address in From
 * and no Reply-To, so the same person appeared as "Thomas Vance" in the
 * sequence and as "thomas@acme.com" in the follow-up to it - and a reply to
 * a mailbox with a Reply-To configured bypassed it.
 */
function senderHeaders(account: any): { from: string; replyTo?: string } {
  return {
    from: formatFromHeader(account.from_name || account.label, account.email_address),
    replyTo: account.reply_to || undefined,
  };
}

async function resolveContactEmail(userId: string, messageId: string): Promise<string | null> {
  const { data: msg } = await supabaseAdmin
    .from('inbox_messages')
    .select('from_email, to_email, direction, contacts(email)')
    .eq('id', messageId)
    .eq('user_id', userId)
    .single();
  if (!msg) throw new AppError('Message not found', 404);
  return (msg as any).contacts?.email ||
    (msg.direction === 'outbound' ? msg.to_email : msg.from_email) || null;
}

/** Normalise a send time to a UTC ISO string. sara_action is text and the
 * scheduler compares it lexicographically, so offsets or local strings would
 * send at the wrong time (or never). */
function normaliseScheduledAt(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new AppError('A valid scheduled_at is required', 400);
  return d.toISOString();
}

export const inboxService = {
  async unreadCount(userId: string): Promise<number> {
    let q = supabaseAdmin
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      // The list's own predicate: null counts as not archived. `= false`
      // left out every message stored before the column had a default, so
      // the badge read lower than the unread rows plainly in the list.
      .or('is_archived.is.null,is_archived.eq.false');
    // Unread newsletters are not something anybody is behind on.
    if (await mailKindReady()) q = q.or(PEOPLE_FILTER);
    // Nor is a conversation snoozed until Monday - that is the point of it.
    if (await snoozeReady()) q = q.or(notSnoozedFilter());
    const { count } = await q;
    return count || 0;
  },

  /**
   * Sidebar counts for the Inbox: unread + a per-intent breakdown, computed
   * over the whole mailbox with exact head-counts (no rows transferred) so the
   * smart-view / tag badges stay accurate no matter how large the inbox grows.
   */
  async counts(userId: string): Promise<{ unread: number; needs_triage: number; intents: Record<string, number>; other: number; other_unread: number; sorting: boolean; snoozed: number; assigned_to_me: number }> {
    // Same folder predicate the list uses for "inbox": not archived (null or false).
    const INTENTS = ['interested', 'meeting', 'objection', 'not_now', 'unsubscribe', 'out_of_office', 'bounce'];

    // Every count below is about people. Mail - newsletters, receipts,
    // notifications - is counted once, on its own, as "Other mail".
    const sorted = await mailKindReady();
    const sorting = sorted ? mailSortService.ensure(userId) : false;
    const people = <T extends { or: (f: string) => T }>(q: T): T => (sorted ? q.or(PEOPLE_FILTER) : q);
    /*
     * Snoozed conversations are out of every count below, through the same
     * filter the list uses (inbox-reminders.service notSnoozedFilter). A
     * count that includes what the list hides is the bug this app has had
     * before - the badge and the rows disagreeing - so there is one
     * predicate, applied once per query here, and nowhere else to drift.
     */
    const snoozeOn = await snoozeReady();
    const awakeFilter = notSnoozedFilter();
    const awake = <T extends { or: (f: string) => T }>(q: T): T => (snoozeOn ? q.or(awakeFilter) : q);

    const otherQ = sorted
      ? supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).in('mail_kind', NON_PERSON_KINDS).or('is_archived.is.null,is_archived.eq.false')
      : Promise.resolve({ count: 0 } as any);
    const otherUnreadQ = sorted
      ? supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).in('mail_kind', NON_PERSON_KINDS).eq('is_read', false).or('is_archived.is.null,is_archived.eq.false')
      : Promise.resolve({ count: 0 } as any);

    const unreadQ = supabaseAdmin
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .or('is_archived.is.null,is_archived.eq.false');

    /*
     * Replies nobody has decided about yet.
     *
     * The count the inbox is actually for. Auto-replies are excluded because
     * an out-of-office is not something anybody needs to make a decision
     * about, and counting them makes the badge wrong in the one direction
     * that teaches people to ignore it.
     */
    const needsTriageQ = supabaseAdmin
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .is('triage_decision', null)
      .is('auto_reply_kind', null)
      .or('is_archived.is.null,is_archived.eq.false');

    const intentQs = INTENTS.map(intent =>
      supabaseAdmin
        .from('inbox_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .or('is_archived.is.null,is_archived.eq.false')
        .eq('sara_intent', intent),
    );

    // Snoozed: the conversations waiting to come back, counted once each.
    const snoozedQ = snoozeOn
      ? supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gt('snoozed_until', new Date().toISOString())
      : Promise.resolve({ count: 0 } as any);
    // Assigned to the caller, in their own mailbox or a teammate's.
    const assignedQ = (await assignReady())
      ? inboxAssignService.orgUserIds(userId).then((ids) => supabaseAdmin
        .from('inbox_messages').select('id', { count: 'exact', head: true })
        .in('user_id', ids).eq('assigned_to', userId).eq('is_read', false)
        .or('is_archived.is.null,is_archived.eq.false'))
      : Promise.resolve({ count: 0 } as any);

    const [otherRes, otherUnreadRes, unreadRes, needsTriageRes, snoozedRes, assignedRes, ...intentRes] = await Promise.all([
      sorted ? awake(otherQ as any) : otherQ,
      sorted ? awake(otherUnreadQ as any) : otherUnreadQ,
      awake(people(unreadQ)), awake(people(needsTriageQ)),
      snoozedQ, assignedQ,
      ...intentQs.map((q) => awake(people(q))),
    ]);

    const intents: Record<string, number> = {};
    INTENTS.forEach((intent, i) => {
      const c = intentRes[i]?.count || 0;
      if (c > 0) intents[intent] = c;
    });

    return {
      unread: unreadRes.count || 0,
      needs_triage: needsTriageRes.count || 0,
      intents,
      other: otherRes.count || 0,
      other_unread: otherUnreadRes.count || 0,
      sorting,
      snoozed: (snoozedRes as any).count || 0,
      // Unread ones only: the badge is for what is waiting, not everything ever handed over.
      assigned_to_me: (assignedRes as any).count || 0,
    };
  },

  async list(userId: string, params: {
    page?: number;
    limit?: number;
    is_read?: boolean;
    is_starred?: boolean;
    is_archived?: boolean;
    sara_status?: string;
    sara_intent?: string;
    search?: string;
    folder?: string;
    contact_email?: string;
    /** Scope to one contact by id - mail linked to them, plus any matching their address. */
    contact_id?: string;
    mail_kind?: string;
  }) {
    const { page, limit, from, to } = getPagination(params);

    const contactId = typeof params.contact_id === 'string' ? params.contact_id.trim() : '';
    if (contactId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) {
      throw new AppError('contact_id must be a UUID', 400);
    }
    const contactEmail = typeof params.contact_email === 'string' ? params.contact_email.trim() : '';
    const contactScoped = !!contactId || !!contactEmail;
    const requestedFolder = params.folder || (contactScoped ? 'all' : 'inbox');

    /*
     * "Assigned to you" is the one view that reaches past the caller's own
     * mailbox: conversations a teammate in the same organisation handed
     * over. Membership is resolved now, so somebody who has left the team
     * stops seeing their old colleagues' mail immediately.
     */
    const owners = requestedFolder === 'assigned' && (await assignReady())
      ? await inboxAssignService.orgUserIds(userId)
      : [userId];

    let query = supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), campaigns(name), smtp_accounts(id, email_address, label)', { count: 'exact' });
    query = owners.length === 1 ? query.eq('user_id', userId) : query.in('user_id', owners);

    // Every message to/from a specific contact (both directions, all folders) —
    // powers the "all past emails" view on the contact page.
    if (contactScoped) {
      const clauses: string[] = [];
      // By id first: mail linked to the contact still belongs to them when
      // it went to (or came from) an address other than the one on file.
      if (contactId) clauses.push(`contact_id.eq.${contactId}`);
      if (contactEmail) {
        // Case-insensitive equality, as the thread lookup does: escaped
        // wildcards and a quoted value. This used to strip "_" outright, so
        // john_doe@x.com never matched its own mail, and was case-sensitive.
        const pattern = contactEmail.replace(/([%_\\])/g, '\\$1');
        const e = `"${pattern.replace(/"/g, '')}"`;
        clauses.push(`from_email.ilike.${e}`, `to_email.ilike.${e}`);
      }
      query = query.or(clauses.join(','));
    }

    // Folder-based filtering (skipped when scoped to a contact)
    const folder = requestedFolder;
    const sorted = await mailKindReady();
    const snoozeOn = await snoozeReady();
    if (folder === 'inbox') {
      query = query.or('is_archived.is.null,is_archived.eq.false');
      // People only. Mail has its own folder, below.
      if (sorted && !contactScoped) query = query.or(PEOPLE_FILTER);
      // Snoozed conversations are elsewhere until they come back - by the
      // same predicate the counts use, so the badge and the rows agree.
      if (snoozeOn && !contactScoped) query = query.or(notSnoozedFilter());
    } else if (folder === 'other') {
      query = query.or('is_archived.is.null,is_archived.eq.false');
      query = sorted ? query.in('mail_kind', params.mail_kind ? [params.mail_kind] : NON_PERSON_KINDS) : query.eq('id', '00000000-0000-0000-0000-000000000000');
      if (snoozeOn) query = query.or(notSnoozedFilter());
    } else if (folder === 'snoozed') {
      // Waiting to come back. Without the column there is nothing snoozed.
      query = snoozeOn
        ? query.gt('snoozed_until', new Date().toISOString())
        : query.eq('id', '00000000-0000-0000-0000-000000000000');
    } else if (folder === 'assigned') {
      query = (await assignReady())
        ? query.eq('assigned_to', userId).or('is_archived.is.null,is_archived.eq.false')
        : query.eq('id', '00000000-0000-0000-0000-000000000000');
    } else if (folder === 'starred') {
      query = query.eq('is_starred', true);
    } else if (folder === 'archived') {
      query = query.eq('is_archived', true);
    } else if (folder === 'sent') {
      query = query.eq('direction', 'outbound');
    }

    // A message queued via scheduleSend/scheduleReply gets its row (and
    // received_at) written up front, before it has actually gone out — don't
    // let it masquerade as already-sent in Inbox/Sent until it really sends.
    // Callers that explicitly ask for sara_status filter their own view.
    if ((folder === 'inbox' || folder === 'sent') && params.sara_status === undefined) {
      // 'failed' too: a scheduled send that never went out is not sent mail.
      query = query.or('sara_status.is.null,sara_status.not.in.(scheduled,sending,failed)');
    }

    if (folder === 'needs_triage') {
      /*
       * The queue: inbound replies nobody has decided about.
       *
       * Matches the partial index in migration 060 exactly - same three
       * predicates in the same order - so this stays an index scan rather
       * than degrading into a sequential one as the mailbox grows.
       */
      query = query
        .eq('direction', 'inbound')
        .is('triage_decision', null)
        .is('auto_reply_kind', null)
        .or('is_archived.is.null,is_archived.eq.false');
      if (sorted) query = query.or(PEOPLE_FILTER);
      if (snoozeOn) query = query.or(notSnoozedFilter());
    }

    // Hot leads, needs reply and the other intent views are about people.
    if (params.sara_intent && sorted && folder !== 'other') query = query.or(PEOPLE_FILTER);

    if (params.is_read !== undefined) {
      query = query.eq('is_read', params.is_read);
    }

    if (params.is_starred !== undefined) {
      query = query.eq('is_starred', params.is_starred);
    }

    if (params.sara_status) {
      query = query.eq('sara_status', params.sara_status);
    }

    if (params.sara_intent) {
      query = query.eq('sara_intent', params.sara_intent);
    }

    if (params.search) {
      // Strip characters that would otherwise break out of the ilike/or
      // filter below — a search term containing a comma or parenthesis
      // would splice extra predicates into the .or() and either malform the
      // request or match unintended rows. Same set search.service.ts's
      // safe() strips for the same reason.
      const safeSearch = params.search.replace(/[%_,()\\]/g, '').trim();
      if (safeSearch) {
        query = query.or(
          `subject.ilike.%${safeSearch}%,from_email.ilike.%${safeSearch}%,body_text.ilike.%${safeSearch}%`
        );
      }
    }

    /*
     * A conversation that came back - a snooze ended, a nudge fired - sorts
     * first until it is opened (markThreadRead settles it). Sorting by its
     * received date would put it back three pages down, which is exactly
     * where it was when it got forgotten. Snoozed sorts soonest-back first.
     */
    if (folder === 'snoozed') {
      query = query.order('snoozed_until', { ascending: true });
    } else if ((folder === 'inbox' || folder === 'assigned') && (await remindersReady())) {
      query = query.order('resurfaced_at', { ascending: false, nullsFirst: false });
    }
    // id breaks ties, so paging through same-instant rows neither repeats nor skips one.
    query = query.order('received_at', { ascending: false }).order('id', { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw new AppError(error.message, 500);

    const messages = (data || []).map((m: any) => ({
      ...m,
      contact_name: m.contacts
        ? [m.contacts.first_name, m.contacts.last_name].filter(Boolean).join(' ') || null
        : null,
      contact_email: m.contacts?.email || null,
      campaign_name: m.campaigns?.name || null,
      smtp_email: m.smtp_accounts?.email_address || null,
      smtp_label: m.smtp_accounts?.label || null,
      // A teammate's mail, assigned to the caller: readable, not theirs to act on.
      read_only: m.user_id !== userId,
      contacts: undefined,
      campaigns: undefined,
      smtp_accounts: undefined,
    }));

    return formatPaginatedResponse(messages, count || 0, page, limit);
  },

  async get(userId: string, id: string) {
    const fetchAs = (owner: string) => supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), campaigns(name), smtp_accounts(id, email_address, label)')
      .eq('id', id)
      .eq('user_id', owner)
      .maybeSingle();

    let { data, error } = await fetchAs(userId);
    if (error) throw new AppError(error.message, 500);
    // Not theirs: readable only if a teammate assigned it to them.
    let owner = userId;
    if (!data) {
      const assignedFrom = await inboxAssignService.assignedOwner(userId, id);
      if (assignedFrom) {
        owner = assignedFrom;
        ({ data, error } = await fetchAs(owner));
        if (error) throw new AppError(error.message, 500);
      }
    }
    if (!data) throw new AppError('Message not found', 404);

    return {
      read_only: owner !== userId,
      ...data,
      contact_name: data.contacts
        ? [data.contacts.first_name, data.contacts.last_name].filter(Boolean).join(' ') || null
        : null,
      contact_email: data.contacts?.email || null,
      campaign_name: data.campaigns?.name || null,
      smtp_email: data.smtp_accounts?.email_address || null,
      smtp_label: data.smtp_accounts?.label || null,
      contacts: undefined,
      campaigns: undefined,
      smtp_accounts: undefined,
    };
  },

  async getThread(callerId: string, messageId: string) {
    /*
     * Whose mailbox the thread is read from. The caller's own, or - for a
     * conversation a teammate assigned to them - the teammate's, and then
     * only the thread that message is in.
     */
    let userId = callerId;
    const fetchMessage = (owner: string) => supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email)')
      .eq('id', messageId)
      .eq('user_id', owner)
      .maybeSingle();
    let { data: message } = await fetchMessage(userId);
    if (!message) {
      const assignedFrom = await inboxAssignService.assignedOwner(callerId, messageId);
      if (assignedFrom) {
        userId = assignedFrom;
        ({ data: message } = await fetchMessage(userId));
      }
    }

    if (!message) throw new AppError('Message not found', 404);

    // Step 2: Determine the contact email to find ALL conversations
    const contactEmail = message.contacts?.email ||
      (message.direction === 'outbound' ? message.to_email : message.from_email);

    if (!contactEmail) {
      // Fallback: return just this message
      return [{
        ...message,
        contact_name: message.contacts
          ? [message.contacts.first_name, message.contacts.last_name].filter(Boolean).join(' ') || null
          : null,
        contact_email: message.contacts?.email || null,
        read_only: userId !== callerId,
        contacts: undefined,
      }];
    }

    // Step 3: Find ALL messages with this contact (both directions)
    // Case-insensitive match ("John@X.com" vs "john@x.com" are the same
    // mailbox) — ilike with escaped wildcards is equality, ignoring case.
    // Quote the email so values containing commas/parens don't break PostgREST OR parsing.
    // A quote inside it is dropped: PostgREST does not read "" as an escaped
    // quote, so doubling it (as this used to) broke the whole filter.
    const emailPattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${emailPattern.replace(/"/g, '')}"`;
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), smtp_accounts(id, email_address, label)')
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`)
      .order('received_at', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((m: any) => ({
      ...m,
      contact_name: m.contacts
        ? [m.contacts.first_name, m.contacts.last_name].filter(Boolean).join(' ') || null
        : null,
      contact_email: m.contacts?.email || null,
      smtp_email: m.smtp_accounts?.email_address || null,
      smtp_label: m.smtp_accounts?.label || null,
      read_only: userId !== callerId,
      contacts: undefined,
      smtp_accounts: undefined,
    }));
  },

  /**
   * Correct the sorting for a sender. Everything from them moves together,
   * and a person moved back gets read by Relay - it never read them while
   * they were filed as mail.
   */
  async setMailKind(userId: string, id: string, kind: string) {
    const allowed = ['person', ...NON_PERSON_KINDS];
    if (!allowed.includes(kind)) throw new AppError('Unknown kind', 400);
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages').select('id, from_email, direction, to_email').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!msg) throw new AppError('Message not found', 404);
    const sender = String(msg.direction === 'outbound' ? msg.to_email : msg.from_email || '').trim();
    if (!sender) throw new AppError('This message has no sender', 400);
    const pattern = sender.replace(/([%_\\])/g, '\\$1');
    const { data: moved, error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ mail_kind: kind })
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .ilike('from_email', pattern)
      .select('id, sara_intent');
    if (error) throw new AppError(error.message, 500);
    if (kind === 'person') {
      const { processReply } = await import('./sara.service.js');
      for (const m of (moved || []).filter((r: any) => !r.sara_intent).slice(0, 20)) {
        processReply(m.id).catch(() => {});
      }
    } else if (moved?.length) {
      await supabaseAdmin.from('inbox_messages')
        .update({ sara_intent: null, sara_action: null, sara_draft_reply: null })
        .in('id', (moved || []).map((r: any) => r.id));
    }
    return { moved: moved?.length || 0, kind };
  },

  async markRead(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async markUnread(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: false })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async markAllRead(userId: string) {
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw new AppError(error.message, 500);
  },

  async toggleStar(userId: string, id: string) {
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('is_starred')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (!msg) throw new AppError('Message not found', 404);

    const newVal = !msg.is_starred;
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_starred: newVal })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { is_starred: newVal };
  },

  async setTag(userId: string, id: string, tag: string) {
    const validTags = ['interested', 'meeting', 'objection', 'not_now', 'unsubscribe', 'out_of_office', 'bounce', 'other'];
    if (tag !== '' && !validTags.includes(tag)) {
      throw new AppError('Invalid tag value', 400);
    }
    // Marked as a person's decision, so nothing Relay re-reads later
    // overwrites it. Before migration 076 there is no column to mark.
    let { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ sara_intent: tag || null, relay_engine: 'manual' })
      .eq('id', id)
      .eq('user_id', userId);
    if (error && /relay_engine/.test(error.message)) {
      ({ error } = await supabaseAdmin.from('inbox_messages').update({ sara_intent: tag || null }).eq('id', id).eq('user_id', userId));
    }
    if (error) throw new AppError(error.message, 500);
    return { sara_intent: tag || null };
  },

  async archive(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: true })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    // Two-way sync: archive on the remote IMAP server in the background.
    syncArchiveToImap(userId, [id], true).catch((e) =>
      console.warn('[Archive→IMAP]', e?.message || e)
    );
  },

  async unarchive(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: false })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    syncArchiveToImap(userId, [id], false).catch((e) =>
      console.warn('[Unarchive→IMAP]', e?.message || e)
    );
  },

  async archiveThread(userId: string, messageId: string) {
    const contactEmail = await resolveContactEmail(userId, messageId);
    if (!contactEmail) return inboxService.archive(userId, messageId);
    // Case-insensitive match — see markThreadRead for why.
    const emailPattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${emailPattern.replace(/"/g, '')}"`;
    const { data: affected } = await supabaseAdmin
      .from('inbox_messages')
      .select('id')
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    const ids = (affected || []).map((r: any) => r.id);
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: true })
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    if (error) throw new AppError(error.message, 500);
    if (ids.length > 0) {
      syncArchiveToImap(userId, ids, true).catch((e) =>
        console.warn('[ArchiveThread→IMAP]', e?.message || e)
      );
    }
  },

  async unarchiveThread(userId: string, messageId: string) {
    const contactEmail = await resolveContactEmail(userId, messageId);
    if (!contactEmail) return inboxService.unarchive(userId, messageId);
    // Case-insensitive match — see markThreadRead for why.
    const emailPattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${emailPattern.replace(/"/g, '')}"`;
    const { data: affected } = await supabaseAdmin
      .from('inbox_messages')
      .select('id')
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    const ids = (affected || []).map((r: any) => r.id);
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: false })
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    if (error) throw new AppError(error.message, 500);
    if (ids.length > 0) {
      syncArchiveToImap(userId, ids, false).catch((e) =>
        console.warn('[UnarchiveThread→IMAP]', e?.message || e)
      );
    }
  },

  async markThreadRead(userId: string, messageId: string) {
    const contactEmail = await resolveContactEmail(userId, messageId);
    if (!contactEmail) {
      await inboxService.markRead(userId, messageId);
      await inboxRemindersService.settleResurfaced(userId, null, messageId);
      return;
    }
    // Case-insensitive match ("John@X.com" vs "john@x.com" are the same
    // mailbox) — ilike with escaped wildcards is equality, ignoring case.
    const pattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${pattern.replace(/"/g, '')}"`;
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    if (error) throw new AppError(error.message, 500);
    // The clicked message must never stay unread, even if its addresses are
    // stored in an unexpected shape (e.g. "Name <a@b.com>").
    await inboxService.markRead(userId, messageId);
    // Seen, so a conversation that came back to the top goes back to its place.
    await inboxRemindersService.settleResurfaced(userId, contactEmail, messageId);
  },

  async reply(userId: string, messageId: string, body: string, smtpAccountId?: string, bodyHtml?: string, extras: SendExtras = {}) {
    // Checked before anything is sent, so a bad file or a bad reminder
    // refuses the whole reply rather than sending half of what was meant.
    const outgoing = prepareOutgoingAttachments(extras.attachments);
    const nudgeDays = parseNudgeDays(extras.nudge_days);

    const { data: original } = await supabaseAdmin
      .from('inbox_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!original) throw new AppError('Message not found', 404);
    refuseLinkedinReply(original);

    const smtpAccount = await findSmtpAccount(userId, smtpAccountId || original.smtp_account_id);
    let smtpPassword: string;
    try {
      smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    } catch (decryptErr: any) {
      throw new AppError(`Failed to decrypt SMTP credentials for ${smtpAccount.label || smtpAccount.email_address}: ${decryptErr.message}`, 500);
    }
    const domain = smtpAccount.email_address?.split('@')[1] || 'usesincerely.com';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;

    const subject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject || '(no subject)'}`;

    // Use rich HTML from editor if provided, otherwise convert plain text
    const userHtml = bodyHtml || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(body)}</div>`;
    const htmlBody = `${userHtml}
<br/>
<div style="padding-left:12px;border-left:2px solid #e0e0e0;margin-top:16px;color:#666;">
  <p style="margin:0 0 4px;font-size:12px;color:#999;">On ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${escapeHtml(original.from_email)} wrote:</p>
  ${original.body_html || `<p>${textToHtml(original.body_text)}</p>`}
</div>`;

    const recipient = replyRecipient(original);
    // A rich reply arrives with an empty plain body; the text part must
    // still say what the HTML says.
    const textBody = body || htmlToText(userHtml);

    await assertSendQuota(userId);
    const sent = await sendWithQuotaRefund(userId, () => sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      ...senderHeaders(smtpAccount),
      to: recipient,
      subject,
      html: htmlBody,
      text: textBody,
      messageId: newMessageId,
      headers: original.message_id ? { 'In-Reply-To': original.message_id, 'References': original.message_id } : {},
      attachments: outgoing.files,
    }));

    // This reply is now the last word; an older "no reply yet" is moot.
    await inboxRemindersService.supersedeNudges(userId, recipient);
    const recorded = await recordSent({
      user_id: userId,
      campaign_id: original.campaign_id,
      campaign_contact_id: original.campaign_contact_id,
      contact_id: original.contact_id,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: recipient,
      subject,
      body_html: htmlBody,
      body_text: textBody,
      in_reply_to: original.message_id,
      message_id: newMessageId,
      is_read: true,
      direction: 'outbound',
      thread_id: original.thread_id || original.message_id,
      received_at: new Date().toISOString(),
    }, outgoing.meta, nudgeDays);

    /*
     * The clock stops here, for the whole thread.
     *
     * This is the only place a human actually answers the person who
     * wrote in, so it is the only place first_response_at may be set.
     * Triage deliberately does not: deciding a reply is "interested" is a
     * note to yourself, and letting it stop the clock would turn the SLA
     * into a measure of how fast somebody clicks a label.
     */
    await replyQueueService.markResponded(userId, messageId);

    // A manual reply to a message Relay had flagged (pending review or already
    // approved) counts as the reply having gone out — keep the "Sent Today"
    // stat accurate even when the user replies directly instead of through
    // the Relay approve flow.
    if (original.sara_status === SaraStatus.PendingReview || original.sara_status === SaraStatus.Approved) {
      await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: SaraStatus.Sent })
        .eq('id', messageId);
    }

    return { success: true, message_id: newMessageId, ...sentNotes(sent, recorded) };
  },

  async forward(userId: string, messageId: string, toEmail: string, note?: string, smtpAccountId?: string, noteHtmlRaw?: string) {
    toEmail = toEmail.trim();
    const { data: original } = await supabaseAdmin
      .from('inbox_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!original) throw new AppError('Message not found', 404);

    const smtpAccount = await findSmtpAccount(userId, smtpAccountId || original.smtp_account_id);
    let smtpPassword: string;
    try {
      smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    } catch (decryptErr: any) {
      throw new AppError(`Failed to decrypt SMTP credentials for ${smtpAccount.label || smtpAccount.email_address}: ${decryptErr.message}`, 500);
    }
    const domain = smtpAccount.email_address?.split('@')[1] || 'usesincerely.com';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;
    const subject = `Fwd: ${(original.subject || '(no subject)').replace(/^Fwd:\s*/i, '')}`;

    // Use rich HTML from editor if provided, otherwise convert plain text
    const noteHtml = noteHtmlRaw
      ? `${noteHtmlRaw}<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;"/>`
      : note
        ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;margin-bottom:16px;">${textToHtml(note)}</div><hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;"/>`
        : '';

    const htmlBody = `${noteHtml}
<p style="margin:0 0 8px;font-size:12px;color:#999;">---------- Forwarded message ----------</p>
<p style="margin:0 0 4px;font-size:12px;color:#999;">From: ${escapeHtml(original.from_email)}<br/>Date: ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}<br/>Subject: ${escapeHtml(original.subject || '(no subject)')}<br/>To: ${escapeHtml(original.to_email)}</p>
<br/>
${original.body_html || `<p>${textToHtml(original.body_text)}</p>`}`;

    await assertSendQuota(userId);
    await sendWithQuotaRefund(userId, () => sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      ...senderHeaders(smtpAccount),
      to: toEmail,
      subject,
      html: htmlBody,
      text: `${note || ''}\n\n---------- Forwarded message ----------\nFrom: ${original.from_email}\nDate: ${original.received_at}\nSubject: ${original.subject}\n\n${original.body_text || ''}`,
      messageId: newMessageId,
    }));

    await supabaseAdmin.from('inbox_messages').insert({
      user_id: userId,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: toEmail,
      subject,
      body_html: htmlBody,
      body_text: `${note || ''}\n\n${original.body_text || ''}`,
      message_id: newMessageId,
      is_read: true,
      direction: 'outbound',
      received_at: new Date().toISOString(),
    });

    return { success: true, message_id: newMessageId };
  },

  async compose(userId: string, input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string } & SendExtras) {
    const outgoing = prepareOutgoingAttachments(input.attachments);
    const nudgeDays = parseNudgeDays(input.nudge_days);
    const smtpAccount = await findSmtpAccount(userId, input.smtp_account_id);

    let smtpPassword: string;
    try {
      smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    } catch (decryptErr: any) {
      throw new AppError(`Failed to decrypt SMTP credentials for ${smtpAccount.label || smtpAccount.email_address}: ${decryptErr.message}`, 500);
    }
    const domain = smtpAccount.email_address?.split('@')[1] || 'usesincerely.com';
    const messageId = `<${crypto.randomUUID()}@${domain}>`;
    // Use rich HTML from editor if provided, otherwise convert plain text
    const htmlBody = input.body_html || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(input.body)}</div>`;

    await assertSendQuota(userId);
    const sent = await sendWithQuotaRefund(userId, () => sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      ...senderHeaders(smtpAccount),
      to: input.to,
      subject: input.subject,
      html: htmlBody,
      text: input.body || htmlToText(htmlBody),
      messageId,
      attachments: outgoing.files,
    }));

    // The contact this went to, so it shows in their history by id and not
    // only by an address match. Addresses are stored lowercased.
    const { data: recipient } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('email', String(input.to || '').trim().toLowerCase())
      .maybeSingle();

    await inboxRemindersService.supersedeNudges(userId, input.to);
    const recorded = await recordSent({
      user_id: userId,
      smtp_account_id: smtpAccount.id,
      contact_id: recipient?.id ?? null,
      from_email: smtpAccount.email_address,
      to_email: input.to,
      subject: input.subject,
      body_html: htmlBody,
      body_text: input.body,
      message_id: messageId,
      is_read: true,
      direction: 'outbound',
      received_at: new Date().toISOString(),
    }, outgoing.meta, nudgeDays);

    // The mail has already gone, so this is still a success - but say that
    // it was not recorded, rather than letting it vanish from Sent quietly.
    return { success: true, message_id: messageId, recorded: recorded.ok, ...sentNotes(sent, recorded) };
  },

  /**
   * Schedule a new compose email for future sending.
   * Uses sara_status='scheduled' and sara_action=ISO_TIMESTAMP on existing columns
   * so no database migration is needed.
   */
  async scheduleSend(userId: string, input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string; scheduled_at: string }) {
    const scheduledAt = normaliseScheduledAt(input.scheduled_at);
    const smtpAccount = await findSmtpAccount(userId, input.smtp_account_id);

    const domain = smtpAccount.email_address?.split('@')[1] || 'usesincerely.com';
    const messageId = `<${crypto.randomUUID()}@${domain}>`;
    const htmlBody = input.body_html || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(input.body)}</div>`;

    const { data, error } = await supabaseAdmin.from('inbox_messages').insert({
      user_id: userId,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: input.to,
      subject: input.subject,
      body_html: htmlBody,
      body_text: input.body,
      message_id: messageId,
      is_read: true,
      direction: 'outbound',
      received_at: new Date().toISOString(),
      sara_status: 'scheduled',
      sara_action: scheduledAt,
    }).select('id').single();

    if (error) throw new AppError(error.message, 500);
    return { success: true, message_id: messageId, id: data?.id, scheduled_at: scheduledAt };
  },

  /**
   * Schedule a reply email for future sending.
   * Uses sara_status='scheduled' and sara_action=ISO_TIMESTAMP.
   */
  async scheduleReply(userId: string, messageId: string, body: string, scheduledAt: string, smtpAccountId?: string, bodyHtml?: string) {
    scheduledAt = normaliseScheduledAt(scheduledAt);
    const { data: original } = await supabaseAdmin
      .from('inbox_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!original) throw new AppError('Message not found', 404);
    refuseLinkedinReply(original);

    const smtpAccount = await findSmtpAccount(userId, smtpAccountId || original.smtp_account_id);
    const domain = smtpAccount.email_address?.split('@')[1] || 'usesincerely.com';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;

    const subject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject || '(no subject)'}`;

    const userHtml = bodyHtml || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(body)}</div>`;
    const htmlBody = `${userHtml}
<br/>
<div style="padding-left:12px;border-left:2px solid #e0e0e0;margin-top:16px;color:#666;">
  <p style="margin:0 0 4px;font-size:12px;color:#999;">On ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${escapeHtml(original.from_email)} wrote:</p>
  ${original.body_html || `<p>${textToHtml(original.body_text)}</p>`}
</div>`;

    const { data, error } = await supabaseAdmin.from('inbox_messages').insert({
      user_id: userId,
      campaign_id: original.campaign_id,
      contact_id: original.contact_id,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: replyRecipient(original),
      subject,
      body_html: htmlBody,
      body_text: body || htmlToText(userHtml),
      in_reply_to: original.message_id,
      message_id: newMessageId,
      is_read: true,
      direction: 'outbound',
      thread_id: original.thread_id || original.message_id,
      received_at: new Date().toISOString(),
      sara_status: 'scheduled',
      sara_action: scheduledAt,
    }).select('id').single();

    if (error) throw new AppError(error.message, 500);
    return { success: true, message_id: newMessageId, id: data?.id, scheduled_at: scheduledAt };
  },

  /**
   * Cancel a scheduled email — delete the unsent row.
   */
  async cancelScheduledEmail(userId: string, id: string) {
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, sara_status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!msg) throw new AppError('Message not found', 404);
    // A failed send can be thrown away as well as a pending one.
    if (msg.sara_status !== 'scheduled' && msg.sara_status !== 'failed') {
      throw new AppError('Message is not scheduled', 400);
    }

    // Re-checked in the delete itself: if the scheduler claimed the row
    // ('sending') since the read above, deleting it would let the mail go out
    // and lose its record while telling the user it was cancelled.
    const { data: deleted, error } = await supabaseAdmin
      .from('inbox_messages')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .in('sara_status', ['scheduled', 'failed'])
      .select('id')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!deleted) throw new AppError('Too late - this email is already being sent', 409);
    return { success: true };
  },

  /**
   * Push a scheduled-but-unsent email to a new send time, without having to
   * cancel and recompose it from scratch.
   */
  async rescheduleScheduledEmail(userId: string, id: string, scheduledAt: string) {
    scheduledAt = normaliseScheduledAt(scheduledAt);
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      throw new AppError('Pick a time in the future', 400);
    }

    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, sara_status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!msg) throw new AppError('Message not found', 404);
    // 'sending' means the scheduler has already claimed this row for delivery
    // (see processScheduledEmails) — too late to move it.
    // Rescheduling a failed send is how it gets retried, once the mailbox
    // it failed on has been put right.
    if (msg.sara_status !== 'scheduled' && msg.sara_status !== 'failed') {
      throw new AppError('Message is not scheduled', 400);
    }

    const { data: moved, error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ sara_action: scheduledAt, sara_status: 'scheduled' })
      .eq('id', id)
      .eq('user_id', userId)
      .in('sara_status', ['scheduled', 'failed'])
      .select('id')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    // No row matched: the scheduler claimed it in between, and it is going
    // out at the old time. Say so rather than reporting a move that did not happen.
    if (!moved) throw new AppError('Too late - this email is already being sent', 409);
    return { success: true, scheduled_at: scheduledAt };
  },

  /**
   * List all pending scheduled emails for a user.
   */
  async listScheduledEmails(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, smtp_accounts(id, email_address, label)')
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .in('sara_status', ['scheduled', 'failed'])
      .not('sara_action', 'is', null)
      .order('sara_action', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((m: any) => ({
      ...m,
      scheduled_at: m.sara_action,
      failed: m.sara_status === 'failed',
      smtp_email: m.smtp_accounts?.email_address || null,
      smtp_label: m.smtp_accounts?.label || null,
      smtp_accounts: undefined,
    }));
  },

  /**
   * Generate an AI-assisted reply draft based on the original message and user prompt.
   */
  async generateReplyAssist(userId: string, messageId: string, prompt: string): Promise<{ html: string; text: string }> {
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, company, email)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!msg) throw new AppError('Message not found', 404);

    const senderName = msg.contacts
      ? [msg.contacts.first_name, msg.contacts.last_name].filter(Boolean).join(' ')
      : msg.from_email?.split('@')[0] || 'there';
    const firstName = msg.contacts?.first_name || senderName.split(' ')[0] || 'there';
    const originalBody = msg.body_text || '';
    const subject = msg.subject || '';
    const promptLower = prompt.toLowerCase();

    // Claude, when configured: the whole conversation, what you sell, and
    // how you sound. The canned replies below are the fallback.
    if (aiAvailable()) {
      const thread = await this.getThread(userId, messageId).catch(() => [] as any[]);
      const settings = await settingsService.get(userId).catch(() => null);
      const account = msg.smtp_account_id
        ? (await supabaseAdmin.from('smtp_accounts').select('from_name, label').eq('id', msg.smtp_account_id).maybeSingle()).data
        : null;
      const written = await draftReply({
        instruction: prompt,
        thread: thread.slice(-8).map((m: any) =>
          `${m.direction === 'outbound' ? 'We wrote' : 'They wrote'} (${String(m.received_at || '').slice(0, 10)}): ${stripQuoted(m.body_text || plainFromHtml(m.body_html || '')).text.slice(0, 1500)}`,
        ).join('\n\n'),
        contact: msg.contacts ? { first_name: msg.contacts.first_name, company: msg.contacts.company } : null,
        offer: (settings as any)?.relay_offer || '',
        tone: (settings as any)?.relay_tone || 'friendly',
        senderFirstName: String((account as any)?.from_name || (account as any)?.label || '').trim().split(/\s+/)[0] || null,
      });
      if (written) {
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(written)}</div>`;
        return { html, text: written };
      }
    }

    // Context-aware reply generation based on user prompt
    let replyText: string;

    // Word boundaries matter: a bare /no/ matched "not now" and "know", so
    // "they said not now" got a polite decline. Timing is checked first for
    // the same reason.
    if (/\b(not now|later|postpone|delay|busy|next (month|quarter|year))\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nUnderstood. When is a better time to pick this up? Give me a month and I'll come back to you then.\n\nThanks`;
    } else if (/\b(accept|agree|yes|confirm|sounds good|let'?s do)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nGreat, let's go ahead.\n\nWhat's the next step on your side, and is there anyone else I should include?\n\nThanks`;
    } else if (/\b(meet|meeting|call|schedule|book|calendar|chat|demo)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nGood idea. Does Tuesday or Thursday afternoon work for 20 minutes? If neither does, send me two times that suit you and I'll make one work.\n\nThanks`;
    } else if (/\b(decline|no|not interested|pass|reject)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThanks for thinking of us. It isn't a fit for us right now, so I'll pass for the moment.\n\nAll the best`;
    } else if (/\b(more info|details|learn more|tell me|explain)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nHappy to. So I send the right thing: is it how it works, what it costs, or an example from a team like yours that matters most?\n\nThanks`;
    } else if (/\b(follow.?up|check.?in|touch base|reconnect)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nIs this still on your list, or has the priority moved? A one-line answer either way helps me plan.\n\nThanks`;
    } else if (/\b(thank|thanks|appreciate|grateful)\b/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThank you, that's appreciated.\n\nIf anything else comes up, reply here and I'll pick it up.\n\nThanks`;
    } else {
      // The user's own words, framed and nothing more.
      replyText = `Hi ${firstName},\n\n${stripDashes(prompt.trim())}\n\nThanks`;
    }

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${textToHtml(replyText)}</div>`;

    return { html, text: replyText };
  },

  /**
   * Trigger an immediate IMAP inbox sync for all of a user's active SMTP accounts.
   * Does a direct IMAP fetch inline — no Redis/BullMQ dependency.
   * Never throws — always returns a structured result.
   */
  /**
   * Read every connected mailbox.
   *
   * Delegated: the sync grew a history window, per-folder UID state, a
   * resumable backfill and Sent-folder reading, and none of that belongs in
   * the same file as the composer.
   */
  async syncInbox(userId: string) {
    return inboxSyncService.syncInbox(userId);
  },
};

/** What a reply or a new message can carry beyond its text. */
export interface SendExtras {
  /** Files from the composer: [{filename, content_type, content_base64}]. */
  attachments?: unknown;
  /** "Remind me if no reply in N days" (migration 092). */
  nudge_days?: unknown;
}

function parseNudgeDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '' || raw === 0) return null;
  const n = Number(raw);
  if (!isNudgeDays(n)) throw new AppError('Choose 1, 2, 3, 5, 7 or 14 days for the reminder', 400);
  return n;
}

/**
 * Write the row for mail we just sent, keeping what came with it.
 *
 * The attachments' names go on the row (090's column), so the thread shows
 * what was sent with it. Before 090 or 092 is run the row is still written,
 * without the part the database cannot hold yet, and the caller is told
 * which part that was. The email itself has already gone either way.
 */
async function recordSent(row: Record<string, unknown>, attachments: AttachmentMeta[], nudgeDays: number | null): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  const full: Record<string, unknown> = { ...row };
  if (attachments.length) full.attachments = attachments;
  if (nudgeDays) full.nudge_at = nudgeAtFor(nudgeDays);

  let { error } = await supabaseAdmin.from('inbox_messages').insert(full);
  if (error && /nudge_at/.test(error.message)) {
    delete full.nudge_at;
    notes.push('The reminder could not be saved: run database migration 092 to turn reminders on.');
    ({ error } = await supabaseAdmin.from('inbox_messages').insert(full));
  }
  if (error && /attachments/.test(error.message)) {
    delete full.attachments;
    ({ error } = await supabaseAdmin.from('inbox_messages').insert(full));
  }
  if (error) {
    console.error('[Inbox] sent but could not be recorded:', error.message);
    return { ok: false, notes };
  }
  return { ok: true, notes };
}

/** Anything about a send the person should hear, beyond "sent". */
function sentNotes(sent: { attachmentsDropped?: boolean } | undefined, recorded: { ok: boolean; notes: string[] }): { warnings?: string[] } {
  const warnings = [...recorded.notes];
  if (sent?.attachmentsDropped) {
    warnings.unshift('Your email went, but without its attachments: the SMTP relay needs redeploying to carry files. Send them again once it is updated.');
  }
  return warnings.length ? { warnings } : {};
}

async function findSmtpAccount(userId: string, preferredId?: string | null): Promise<any> {
  if (preferredId) {
    const { data } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', preferredId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!data) throw new AppError('No SMTP account available. Add one in SMTP Accounts settings.', 400);
  return data;
}

/** A scheduled send left 'sending' this long was cut off, not slow. */
const STUCK_SENDING_MS = 15 * 60 * 1000;

/**
 * Scheduled emails a dead process left 'sending'.
 *
 * The claim in processScheduledEmails flips a row to 'sending' before the
 * SMTP call. If the process dies in between, nothing ever looks at the row
 * again: it is neither scheduled (so never retried) nor sent, and cancel and
 * reschedule both refuse it. Marked 'failed' rather than put back - whether
 * the mail actually left is unknown, and a duplicate reply is worse than
 * one the user can see failed and reschedule. inbox_messages has no column
 * for the reason; the 'failed' state is what the scheduled list shows.
 */
export async function reapStuckScheduledSends(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('inbox_messages')
    .update({ sara_status: 'failed' })
    .eq('direction', 'outbound')
    .eq('sara_status', 'sending')
    .lt('sara_action', cutoff)
    .select('id');
  if (error) throw new Error(`stuck scheduled sends: ${error.message}`);
  for (const r of data || []) {
    console.error(`[ScheduledEmails] Message ${(r as any).id} was left mid-send (the server stopped); marked failed - it may or may not have gone out`);
  }
  return (data || []).length;
}

/**
 * Process all scheduled emails that are due for sending.
 * Called by the sequence worker on each tick (every 30 seconds).
 *
 * Uses existing columns: sara_status='scheduled', sara_action=ISO_TIMESTAMP.
 * After sending, clears both to mark as sent.
 * On error, also clears to prevent infinite retry loops.
 */
export async function processScheduledEmails(): Promise<number> {
  const now = new Date().toISOString();

  const { data: dueMessages, error } = await supabaseAdmin
    .from('inbox_messages')
    .select('*, smtp_accounts(id, email_address, from_name, label, reply_to, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, user_id)')
    .eq('direction', 'outbound')
    .eq('sara_status', 'scheduled')
    .not('sara_action', 'is', null)
    .lte('sara_action', now)
    .order('sara_action', { ascending: true })
    .limit(50);

  // Thrown, not logged and turned into "nothing due": the sequence worker
  // records it, so the status page can say sending is failing.
  if (error) throw new Error(`scheduled emails query: ${error.message}`);

  if (!dueMessages || dueMessages.length === 0) return 0;

  let sent = 0;

  for (const msg of dueMessages) {
    // Shutting down: leave the rest 'scheduled' for the next process rather
    // than claim one that may be cut off half way.
    if (isDraining()) break;
    try {
      const smtpAccount = msg.smtp_accounts;
      if (!smtpAccount) {
        console.error(`[ScheduledEmails] No SMTP account for message ${msg.id}, marking it failed`);
        await supabaseAdmin
          .from('inbox_messages')
          .update({ sara_status: 'failed' })
          .eq('id', msg.id);
        continue;
      }

      // Atomically claim this message BEFORE sending to prevent a duplicate send if
      // an overlapping/concurrent tick picks up the same due row (same compare-and-swap
      // pattern as sequence.service.ts's processEmailStep).
      //
      // The claim also stamps sara_action with the claim time. inbox_messages
      // has no updated_at, and reapStuckScheduledSends needs to know how long
      // a row has been 'sending'. The row is due either way (claim time is
      // never in the future), so a revert to 'scheduled' below still retries.
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: 'sending', sara_action: new Date().toISOString() })
        .eq('id', msg.id)
        .eq('sara_status', 'scheduled')
        .select('id')
        .maybeSingle();
      if (claimErr) {
        console.error(`[ScheduledEmails] Failed to claim message ${msg.id}:`, claimErr.message);
        continue;
      }
      if (!claimed) {
        console.log(`[ScheduledEmails] Message ${msg.id} already claimed by a concurrent run — skipping`);
        continue;
      }

      // Monthly cap — skip (leave scheduled) if the owner is out of quota.
      if (smtpAccount.user_id && !(await billingService.reserveEmailQuota(smtpAccount.user_id))) {
        console.log(`[ScheduledEmails] User ${smtpAccount.user_id} over quota — leaving message ${msg.id} scheduled`);
        await supabaseAdmin.from('inbox_messages').update({ sara_status: 'scheduled' }).eq('id', msg.id);
        continue;
      }

      const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);

      const doSend = () => sendViaSmtp({
        smtpHost: smtpAccount.smtp_host,
        smtpPort: smtpAccount.smtp_port,
        smtpSecure: smtpAccount.smtp_secure,
        smtpUser: smtpAccount.smtp_user,
        smtpPass: smtpPassword,
        ...senderHeaders(smtpAccount),
        to: msg.to_email,
        subject: msg.subject,
        html: msg.body_html,
        text: msg.body_text,
        messageId: msg.message_id,
        headers: msg.in_reply_to ? { 'In-Reply-To': msg.in_reply_to, 'References': msg.in_reply_to } : {},
      });
      // Only refund on failure if a slot was actually reserved above.
      await (smtpAccount.user_id ? sendWithQuotaRefund(smtpAccount.user_id, doSend) : doSend());

      // Mark as sent by clearing the schedule markers, and stamp received_at
      // with the real send time — it was set to the scheduling time when the
      // row was first written, which would otherwise make the message look
      // like it went out (and sort as if it did) well before it actually did.
      const { error: clearErr } = await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: null, sara_action: null, received_at: new Date().toISOString() })
        .eq('id', msg.id);
      if (clearErr) {
        // The email already sent successfully — the row is now stuck with sara_status
        // 'sending' rather than resent, since the claim above already ruled out a
        // duplicate. Log loudly rather than silently leaving it unexplained.
        console.error(`[ScheduledEmails] Sent ${msg.id} but failed to clear its schedule markers:`, clearErr.message);
      }

      sent++;
      console.log(`[ScheduledEmails] Sent scheduled email ${msg.id} to ${msg.to_email}`);
    } catch (err: any) {
      console.error(`[ScheduledEmails] Failed to send message ${msg.id}:`, err.message);
      // Only wipe schedule markers for permanent failures (auth, config, envelope errors).
      // Transient network errors revert the claim back to 'scheduled' (sara_action is
      // untouched, so it's still due) so the next scheduler run retries.
      // ENOTFOUND means the SMTP host doesn't resolve at all — a permanent config
      // problem (see describeSmtpError() in email-sender.service.ts), not a
      // transient blip, so it must NOT be retried forever; it belongs in the
      // permanent-failure branch.
      //
      // A permanent failure is marked 'failed', not cleared. Clearing both
      // markers made the row indistinguishable from mail that went out: it
      // appeared in Sent, dated as sent, and nobody learned the reply never
      // left. Kept in the scheduled list instead, saying so, where it can be
      // rescheduled once the mailbox is fixed or thrown away.
      const TRANSIENT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'EAI_AGAIN']);
      const isTransient = TRANSIENT_CODES.has(err.code) || err.message?.includes('timeout');
      await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: isTransient ? 'scheduled' : 'failed' })
        .eq('id', msg.id);
    }
  }

  return sent;
}
