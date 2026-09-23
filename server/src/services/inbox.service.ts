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
import { SaraStatus } from '@lemlist/shared';
import { billingService } from './billing.service.js';
import { inboxSyncService, imapHostFor } from './inbox-sync.service.js';

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
  const { data: messages } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, imap_uid, imap_folder, smtp_account_id')
    .in('id', inboxMessageIds)
    .eq('user_id', userId)
    .not('imap_uid', 'is', null);

  if (!messages || messages.length === 0) return;

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
    const client = new ImapFlow({
      host: imapIp || imapHost,
      port: account.imap_port || 993,
      secure: account.imap_secure !== false,
      servername: imapHost,
      auth: { user: account.imap_user || account.smtp_user || account.email_address, pass: password },
      logger: false,
    });

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
        const src = archive
          ? 'INBOX'
          : (m.imap_folder && m.imap_folder !== 'INBOX' ? m.imap_folder : archiveTargets[0]);
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
              // Only update imap_uid if the server returned a new UID.
              // Setting it to null would break future archive/unarchive since
              // the sync query filters .not('imap_uid', 'is', null).
              const updatePayload: Record<string, any> = { imap_folder: target };
              if (newUid !== null) updatePayload.imap_uid = newUid;
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

export const inboxService = {
  async unreadCount(userId: string): Promise<number> {
    const { count } = await supabaseAdmin
      .from('inbox_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('is_archived', false);
    return count || 0;
  },

  /**
   * Sidebar counts for the Inbox: unread + a per-intent breakdown, computed
   * over the whole mailbox with exact head-counts (no rows transferred) so the
   * smart-view / tag badges stay accurate no matter how large the inbox grows.
   */
  async counts(userId: string): Promise<{ unread: number; needs_triage: number; intents: Record<string, number> }> {
    // Same folder predicate the list uses for "inbox": not archived (null or false).
    const INTENTS = ['interested', 'meeting', 'objection', 'not_now', 'unsubscribe', 'out_of_office', 'bounce'];

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

    const [unreadRes, needsTriageRes, ...intentRes] = await Promise.all([unreadQ, needsTriageQ, ...intentQs]);

    const intents: Record<string, number> = {};
    INTENTS.forEach((intent, i) => {
      const c = intentRes[i]?.count || 0;
      if (c > 0) intents[intent] = c;
    });

    return {
      unread: unreadRes.count || 0,
      needs_triage: needsTriageRes.count || 0,
      intents,
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
  }) {
    const { page, limit, from, to } = getPagination(params);

    let query = supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), campaigns(name), smtp_accounts(id, email_address, label)', { count: 'exact' })
      .eq('user_id', userId);

    // Every message to/from a specific contact (both directions, all folders) —
    // powers the "all past emails" view on the contact page.
    if (params.contact_email) {
      const e = params.contact_email.replace(/[%_,()]/g, '');
      query = query.or(`from_email.eq.${e},to_email.eq.${e}`);
    }

    // Folder-based filtering (skipped when scoped to a contact)
    const folder = params.folder || (params.contact_email ? 'all' : 'inbox');
    if (folder === 'inbox') {
      query = query.or('is_archived.is.null,is_archived.eq.false');
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
    }

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

    query = query.order('received_at', { ascending: false }).range(from, to);

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
      contacts: undefined,
      campaigns: undefined,
      smtp_accounts: undefined,
    }));

    return formatPaginatedResponse(messages, count || 0, page, limit);
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), campaigns(name), smtp_accounts(id, email_address, label)')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Message not found', 404);

    return {
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

  async getThread(userId: string, messageId: string) {
    // Step 1: Fetch the message to get contact info
    const { data: message } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();

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
        contacts: undefined,
      }];
    }

    // Step 3: Find ALL messages with this contact (both directions)
    // Case-insensitive match ("John@X.com" vs "john@x.com" are the same
    // mailbox) — ilike with escaped wildcards is equality, ignoring case.
    // Quote the email so values containing commas/parens don't break PostgREST OR parsing
    const emailPattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${emailPattern.replace(/"/g, '""')}"`;
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
      contacts: undefined,
      smtp_accounts: undefined,
    }));
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
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ sara_intent: tag || null })
      .eq('id', id)
      .eq('user_id', userId);
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
    const emailQ = `"${emailPattern.replace(/"/g, '""')}"`;
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
    const emailQ = `"${emailPattern.replace(/"/g, '""')}"`;
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
    if (!contactEmail) return inboxService.markRead(userId, messageId);
    // Case-insensitive match ("John@X.com" vs "john@x.com" are the same
    // mailbox) — ilike with escaped wildcards is equality, ignoring case.
    const pattern = contactEmail.replace(/([%_\\])/g, '\\$1');
    const emailQ = `"${pattern.replace(/"/g, '""')}"`;
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .or(`from_email.ilike.${emailQ},to_email.ilike.${emailQ}`);
    if (error) throw new AppError(error.message, 500);
    // The clicked message must never stay unread, even if its addresses are
    // stored in an unexpected shape (e.g. "Name <a@b.com>").
    await inboxService.markRead(userId, messageId);
  },

  async reply(userId: string, messageId: string, body: string, smtpAccountId?: string, bodyHtml?: string) {
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
    await sendWithQuotaRefund(userId, () => sendViaSmtp({
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
    }));

    await supabaseAdmin.from('inbox_messages').insert({
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
    });

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

    return { success: true, message_id: newMessageId };
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

  async compose(userId: string, input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string }) {
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
    await sendWithQuotaRefund(userId, () => sendViaSmtp({
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
    }));

    await supabaseAdmin.from('inbox_messages').insert({
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
    });

    return { success: true, message_id: messageId };
  },

  /**
   * Schedule a new compose email for future sending.
   * Uses sara_status='scheduled' and sara_action=ISO_TIMESTAMP on existing columns
   * so no database migration is needed.
   */
  async scheduleSend(userId: string, input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string; scheduled_at: string }) {
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
      sara_action: input.scheduled_at,
    }).select('id').single();

    if (error) throw new AppError(error.message, 500);
    return { success: true, message_id: messageId, id: data?.id, scheduled_at: input.scheduled_at };
  },

  /**
   * Schedule a reply email for future sending.
   * Uses sara_status='scheduled' and sara_action=ISO_TIMESTAMP.
   */
  async scheduleReply(userId: string, messageId: string, body: string, scheduledAt: string, smtpAccountId?: string, bodyHtml?: string) {
    const { data: original } = await supabaseAdmin
      .from('inbox_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!original) throw new AppError('Message not found', 404);

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

    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
    return { success: true };
  },

  /**
   * Push a scheduled-but-unsent email to a new send time, without having to
   * cancel and recompose it from scratch.
   */
  async rescheduleScheduledEmail(userId: string, id: string, scheduledAt: string) {
    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
      throw new AppError('A valid scheduled_at is required', 400);
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

    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ sara_action: scheduledAt, sara_status: 'scheduled' })
      .eq('id', id)
      .eq('user_id', userId)
      .in('sara_status', ['scheduled', 'failed']);

    if (error) throw new AppError(error.message, 500);
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

    // Context-aware reply generation based on user prompt
    let replyText: string;

    if (/accept|agree|yes|confirm|sounds good|let'?s do/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThanks for reaching out! That sounds great — I'd be happy to move forward.\n\nPlease let me know if there are any next steps on your end, or if you'd like to schedule a time to connect.\n\nBest regards`;
    } else if (/meet|call|schedule|book|calendar|chat|demo/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nI'd love to set up a time to chat! I'm generally available this week — feel free to suggest a time that works best for you, or I can send over some options.\n\nLooking forward to connecting.\n\nBest regards`;
    } else if (/decline|no|not interested|pass|reject/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThank you for thinking of us. After careful consideration, I'm going to pass on this for now.\n\nI appreciate you reaching out and wish you all the best.\n\nKind regards`;
    } else if (/more info|details|learn more|tell me|explain/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThanks for your interest! I'd be happy to share more details.\n\nCould you let me know which specific aspects you'd like to learn more about? That way I can tailor the information to what's most relevant for you.\n\nBest regards`;
    } else if (/follow.?up|check.?in|touch base|reconnect/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nJust wanted to follow up on my previous message and see if you had any thoughts.\n\nI'd love to hear back from you when you get a chance. No rush at all — just wanted to make sure this didn't slip through the cracks.\n\nBest regards`;
    } else if (/thank|appreciate|grateful/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nThank you so much — I really appreciate it!\n\nPlease don't hesitate to reach out if there's anything else I can help with.\n\nBest regards`;
    } else if (/delay|later|postpone|busy|not now/i.test(promptLower)) {
      replyText = `Hi ${firstName},\n\nNo worries at all — I completely understand. Timing is everything.\n\nFeel free to reach out whenever you're ready, and I'll be happy to pick things back up.\n\nBest regards`;
    } else {
      // Generic professional reply incorporating the user's prompt
      replyText = `Hi ${firstName},\n\n${prompt}\n\nPlease let me know if you have any questions.\n\nBest regards`;
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

  if (error) {
    console.error('[ScheduledEmails] Query error:', error.message);
    return 0;
  }

  if (!dueMessages || dueMessages.length === 0) return 0;

  let sent = 0;

  for (const msg of dueMessages) {
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
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: 'sending' })
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
