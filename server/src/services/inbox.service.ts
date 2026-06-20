import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp } from './email-sender.service.js';
import { processReply } from './sara.service.js';
import { fireEvent } from './webhook.service.js';

async function isAiTaggingEnabled(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('ai_tagging_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  // Default to true if the column or row doesn't exist
  if (!data) return true;
  return data.ai_tagging_enabled !== false;
}

function categoriseImapError(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('auth') || m.includes('credentials') || m.includes('login') || m.includes('password'))
    return 'Authentication failed — your password may have changed or you need an app password.';
  if (m.includes('timed out') || m.includes('etimedout') || m.includes('econnrefused'))
    return 'Connection timed out — your hosting provider may block IMAP (port 993).';
  if (m.includes('enotfound') || m.includes('getaddrinfo'))
    return 'IMAP host not found — check the email provider\'s IMAP settings.';
  if (m.includes('certificate') || m.includes('self signed'))
    return 'TLS certificate problem — IMAP server certificate is invalid.';
  return message;
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
      .select('smtp_host, smtp_user, smtp_pass_encrypted, email_address')
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
    const isOutlook = host.includes('outlook') || host.includes('office365');

    let imapHost: string;
    if (isGmail) imapHost = 'imap.gmail.com';
    else if (isOutlook) imapHost = 'outlook.office365.com';
    else if (host.startsWith('smtp.')) imapHost = host.replace('smtp.', 'imap.');
    else {
      const emailDomain = (account.email_address || '').split('@')[1];
      if (!emailDomain) {
        console.warn('[IMAP archive] cannot determine IMAP host for account', accountId, '— skipping');
        continue;
      }
      imapHost = `imap.${emailDomain}`;
    }

    const client = new ImapFlow({
      host: imapHost,
      port: 993,
      secure: true,
      auth: { user: account.smtp_user || account.email_address, pass: password },
      logger: false,
    });

    try {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 12000)),
      ]);

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
  }) {
    const { page, limit, from, to } = getPagination(params);

    let query = supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), campaigns(name), smtp_accounts(id, email_address, label)', { count: 'exact' })
      .eq('user_id', userId);

    // Folder-based filtering
    const folder = params.folder || 'inbox';
    if (folder === 'inbox') {
      query = query.or('is_archived.is.null,is_archived.eq.false');
    } else if (folder === 'starred') {
      query = query.eq('is_starred', true);
    } else if (folder === 'archived') {
      query = query.eq('is_archived', true);
    } else if (folder === 'sent') {
      query = query.eq('direction', 'outbound');
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
      const safeSearch = params.search.replace(/[%_]/g, '');
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
      .single();

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
    // Quote the email so values containing commas/parens don't break PostgREST OR parsing
    const emailQ = `"${contactEmail.replace(/"/g, '""')}"`;
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('*, contacts(first_name, last_name, email), smtp_accounts(id, email_address, label)')
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`)
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
    const emailQ = `"${contactEmail.replace(/"/g, '""')}"`;
    const { data: affected } = await supabaseAdmin
      .from('inbox_messages')
      .select('id')
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`);
    const ids = (affected || []).map((r: any) => r.id);
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: true })
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`);
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
    const emailQ = `"${contactEmail.replace(/"/g, '""')}"`;
    const { data: affected } = await supabaseAdmin
      .from('inbox_messages')
      .select('id')
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`);
    const ids = (affected || []).map((r: any) => r.id);
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_archived: false })
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`);
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
    const emailQ = `"${contactEmail.replace(/"/g, '""')}"`;
    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .or(`from_email.eq.${emailQ},to_email.eq.${emailQ}`);
    if (error) throw new AppError(error.message, 500);
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
    const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;

    const subject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject || '(no subject)'}`;

    // Use rich HTML from editor if provided, otherwise convert plain text
    const userHtml = bodyHtml || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${body.replace(/\n/g, '<br/>')}</div>`;
    const htmlBody = `${userHtml}
<br/>
<div style="padding-left:12px;border-left:2px solid #e0e0e0;margin-top:16px;color:#666;">
  <p style="margin:0 0 4px;font-size:12px;color:#999;">On ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${original.from_email} wrote:</p>
  ${original.body_html || `<p>${original.body_text || ''}</p>`}
</div>`;

    await sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      from: smtpAccount.email_address,
      to: original.from_email,
      subject,
      html: htmlBody,
      text: body,
      messageId: newMessageId,
      headers: original.message_id ? { 'In-Reply-To': original.message_id, 'References': original.message_id } : {},
    });

    await supabaseAdmin.from('inbox_messages').insert({
      user_id: userId,
      campaign_id: original.campaign_id,
      campaign_contact_id: original.campaign_contact_id,
      contact_id: original.contact_id,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: original.from_email,
      subject,
      body_html: htmlBody,
      body_text: body,
      in_reply_to: original.message_id,
      message_id: newMessageId,
      is_read: true,
      direction: 'outbound',
      thread_id: original.thread_id || original.message_id,
      received_at: new Date().toISOString(),
    });

    return { success: true, message_id: newMessageId };
  },

  async forward(userId: string, messageId: string, toEmail: string, note?: string, smtpAccountId?: string, noteHtmlRaw?: string) {
    const { data: original } = await supabaseAdmin
      .from('inbox_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();
    if (!original) throw new AppError('Message not found', 404);

    const smtpAccount = await findSmtpAccount(userId, smtpAccountId || original.smtp_account_id);
    const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;
    const subject = `Fwd: ${(original.subject || '(no subject)').replace(/^Fwd:\s*/i, '')}`;

    // Use rich HTML from editor if provided, otherwise convert plain text
    const noteHtml = noteHtmlRaw
      ? `${noteHtmlRaw}<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;"/>`
      : note
        ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;margin-bottom:16px;">${note.replace(/\n/g, '<br/>')}</div><hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;"/>`
        : '';

    const htmlBody = `${noteHtml}
<p style="margin:0 0 8px;font-size:12px;color:#999;">---------- Forwarded message ----------</p>
<p style="margin:0 0 4px;font-size:12px;color:#999;">From: ${original.from_email}<br/>Date: ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}<br/>Subject: ${original.subject || '(no subject)'}<br/>To: ${original.to_email}</p>
<br/>
${original.body_html || `<p>${original.body_text || ''}</p>`}`;

    await sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      from: smtpAccount.email_address,
      to: toEmail,
      subject,
      html: htmlBody,
      text: `${note || ''}\n\n---------- Forwarded message ----------\nFrom: ${original.from_email}\nDate: ${original.received_at}\nSubject: ${original.subject}\n\n${original.body_text || ''}`,
      messageId: newMessageId,
    });

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

    const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);
    const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
    const messageId = `<${crypto.randomUUID()}@${domain}>`;
    // Use rich HTML from editor if provided, otherwise convert plain text
    const htmlBody = input.body_html || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${input.body.replace(/\n/g, '<br/>')}</div>`;

    await sendViaSmtp({
      smtpHost: smtpAccount.smtp_host,
      smtpPort: smtpAccount.smtp_port,
      smtpSecure: smtpAccount.smtp_secure,
      smtpUser: smtpAccount.smtp_user,
      smtpPass: smtpPassword,
      from: smtpAccount.email_address,
      to: input.to,
      subject: input.subject,
      html: htmlBody,
      text: input.body,
      messageId,
    });

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

    const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
    const messageId = `<${crypto.randomUUID()}@${domain}>`;
    const htmlBody = input.body_html || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${input.body.replace(/\n/g, '<br/>')}</div>`;

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
    const domain = smtpAccount.email_address?.split('@')[1] || 'skysend.io';
    const newMessageId = `<${crypto.randomUUID()}@${domain}>`;

    const subject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject || '(no subject)'}`;

    const userHtml = bodyHtml || `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${body.replace(/\n/g, '<br/>')}</div>`;
    const htmlBody = `${userHtml}
<br/>
<div style="padding-left:12px;border-left:2px solid #e0e0e0;margin-top:16px;color:#666;">
  <p style="margin:0 0 4px;font-size:12px;color:#999;">On ${new Date(original.received_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${original.from_email} wrote:</p>
  ${original.body_html || `<p>${original.body_text || ''}</p>`}
</div>`;

    const { data, error } = await supabaseAdmin.from('inbox_messages').insert({
      user_id: userId,
      campaign_id: original.campaign_id,
      contact_id: original.contact_id,
      smtp_account_id: smtpAccount.id,
      from_email: smtpAccount.email_address,
      to_email: original.from_email,
      subject,
      body_html: htmlBody,
      body_text: body,
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
    if (msg.sara_status !== 'scheduled') throw new AppError('Message is not scheduled', 400);

    const { error } = await supabaseAdmin
      .from('inbox_messages')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
    return { success: true };
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
      .eq('sara_status', 'scheduled')
      .not('sara_action', 'is', null)
      .order('sara_action', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((m: any) => ({
      ...m,
      scheduled_at: m.sara_action,
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

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${replyText.replace(/\n/g, '<br/>')}</div>`;

    return { html, text: replyText };
  },

  /**
   * Trigger an immediate IMAP inbox sync for all of a user's active SMTP accounts.
   * Does a direct IMAP fetch inline — no Redis/BullMQ dependency.
   * Never throws — always returns a structured result.
   */
  async syncInbox(userId: string): Promise<{ synced: number; newMessages: number; errors?: string[] }> {
    try {
      const { data: accounts, error: dbError } = await supabaseAdmin
        .from('smtp_accounts')
        .select('id, user_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, email_address, last_inbox_sync_at')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (dbError) {
        console.error('[InboxSync] DB error fetching accounts:', dbError.message);
        return { synced: 0, newMessages: 0, errors: ['Could not fetch SMTP accounts'] };
      }

      if (!accounts || accounts.length === 0) {
        return { synced: 0, newMessages: 0 };
      }

      // Check that IMAP modules are available before starting
      let ImapFlow: any;
      let simpleParser: any;
      try {
        const imapModule = await import('imapflow');
        const parserModule = await import('mailparser');
        ImapFlow = imapModule.ImapFlow;
        simpleParser = parserModule.simpleParser;
      } catch (importErr: any) {
        console.error('[InboxSync] IMAP modules not available:', importErr.message);
        return { synced: 0, newMessages: 0, errors: ['IMAP modules not available — install imapflow and mailparser'] };
      }

      let totalNew = 0;
      const errors: string[] = [];

      // Check once whether AI tagging is enabled for this user
      const aiTaggingOn = await isAiTaggingEnabled(userId);

      for (const account of accounts) {
        let client: any = null;
        try {
          const password = decrypt(account.smtp_pass_encrypted);

          // Derive IMAP host
          let imapHost: string;
          if (account.smtp_host?.includes('smtp.gmail')) imapHost = 'imap.gmail.com';
          else if (account.smtp_host?.includes('smtp.outlook') || account.smtp_host?.includes('office365')) imapHost = 'outlook.office365.com';
          else if (account.smtp_host?.includes('smtp.')) imapHost = account.smtp_host.replace('smtp.', 'imap.');
          else imapHost = `imap.${account.email_address?.split('@')[1] || ''}`;

          client = new ImapFlow({
            host: imapHost,
            port: 993,
            secure: true,
            auth: { user: account.smtp_user || account.email_address, pass: password },
            logger: false,
            emitLogs: false,
          });

          // Add connection timeout (15 seconds)
          const connectPromise = client.connect();
          let connectTimeoutId: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => {
            connectTimeoutId = setTimeout(() => reject(new Error('IMAP connection timed out')), 15000);
          });
          await Promise.race([connectPromise, timeoutPromise]).finally(() => clearTimeout(connectTimeoutId));

          await client.mailboxOpen('INBOX');

          const sinceDate = account.last_inbox_sync_at
            ? new Date(account.last_inbox_sync_at)
            : new Date(Date.now() - 7 * 24 * 3600 * 1000);

          let newCount = 0;

          for await (const msg of client.fetch(
            { since: sinceDate },
            { envelope: true, source: true, uid: true }
          )) {
            const envelope = msg.envelope;
            if (!envelope) continue;

            const fromEmail = envelope.from?.[0]?.address || '';
            const toEmail = envelope.to?.[0]?.address || '';
            const subject = envelope.subject || '';
            const messageId = envelope.messageId || '';
            const inReplyTo = envelope.inReplyTo || '';
            const imapUid = msg.uid || null;

            // Skip if already stored
            if (messageId) {
              const { count } = await supabaseAdmin
                .from('inbox_messages')
                .select('*', { count: 'exact', head: true })
                .eq('message_id', messageId);
              if (count && count > 0) continue;
            }

            // Parse email body
            let bodyText = '';
            let bodyHtml: string | undefined;
            try {
              const parsed = await simpleParser(msg.source || '');
              bodyText = parsed.text || '';
              bodyHtml = parsed.html || undefined;
            } catch {
              const src = typeof msg.source === 'string' ? msg.source : (msg.source || '').toString();
              const bodyStart = src.indexOf('\r\n\r\n');
              bodyText = bodyStart !== -1 ? src.slice(bodyStart + 4).trim() : '';
            }

            // Match to campaign contact
            let matchedActivity: any = null;
            if (inReplyTo) {
              const { data } = await supabaseAdmin
                .from('campaign_activities')
                .select('campaign_id, campaign_contact_id, contact_id, step_id')
                .eq('activity_type', 'sent')
                .eq('message_id', inReplyTo)
                .single();
              matchedActivity = data;
            }
            if (!matchedActivity && fromEmail) {
              const { data: contact } = await supabaseAdmin
                .from('contacts')
                .select('id')
                .eq('email', fromEmail)
                .eq('user_id', userId)
                .single();
              if (contact) {
                const { data: cc } = await supabaseAdmin
                  .from('campaign_contacts')
                  .select('id, campaign_id, contact_id')
                  .eq('contact_id', contact.id)
                  .in('status', ['active', 'completed'])
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .single();
                if (cc) {
                  matchedActivity = { campaign_id: cc.campaign_id, campaign_contact_id: cc.id, contact_id: cc.contact_id };
                }
              }
            }

            // Store
            const inboxRow: any = {
              user_id: userId,
              smtp_account_id: account.id,
              from_email: fromEmail,
              to_email: toEmail,
              subject,
              body_text: bodyText,
              body_html: bodyHtml,
              message_id: messageId || undefined,
              in_reply_to: inReplyTo || undefined,
              direction: 'inbound',
              is_read: false,
              received_at: envelope.date || new Date().toISOString(),
              imap_uid: imapUid,
              imap_folder: 'INBOX',
            };
            if (matchedActivity) {
              inboxRow.campaign_id = matchedActivity.campaign_id;
              inboxRow.contact_id = matchedActivity.contact_id;
              inboxRow.campaign_contact_id = matchedActivity.campaign_contact_id;
            }

            const { data: saved, error: insErr } = await supabaseAdmin
              .from('inbox_messages')
              .insert(inboxRow)
              .select('id')
              .single();

            if (insErr || !saved?.id) {
              console.error('[InboxSync] Insert failed:', insErr?.message);
              continue;
            }
            newCount++;

            // If matched to a campaign, record replied activity + fire webhook
            if (matchedActivity) {
              const { error: actErr } = await supabaseAdmin.from('campaign_activities').insert({
                campaign_id: matchedActivity.campaign_id,
                campaign_contact_id: matchedActivity.campaign_contact_id,
                contact_id: matchedActivity.contact_id,
                step_id: matchedActivity.step_id || null,
                activity_type: 'replied',
                message_id: messageId || null,
                metadata: { from: fromEmail, subject, inbox_message_id: saved.id },
              });
              if (actErr) {
                console.error('[InboxSync] Failed to record replied activity:', actErr.message);
              }

              fireEvent(userId, 'email.replied', {
                campaign_id: matchedActivity.campaign_id,
                contact_id: matchedActivity.contact_id,
                from: fromEmail,
                subject,
              }).catch(() => {});
            }

            // Auto-classify with SARA when AI tagging is enabled for this user.
            // Never block sync if classification fails.
            if (aiTaggingOn) {
              processReply(saved.id).catch((e: any) => {
                console.warn('[InboxSync] AI tag failed for', saved.id, ':', e.message);
              });
            }
          }

          // Update sync timestamp
          await supabaseAdmin
            .from('smtp_accounts')
            .update({ last_inbox_sync_at: new Date().toISOString() })
            .eq('id', account.id);

          await client.logout().catch(() => {});
          client = null;
          totalNew += newCount;
          console.log(`[InboxSync] Account ${account.email_address}: ${newCount} new messages`);
        } catch (err: any) {
          const friendly = categoriseImapError(err.message || String(err));
          console.error(`[InboxSync] Failed for ${account.email_address}:`, err.message);
          errors.push(`${account.email_address}: ${friendly}`);
          if (client) {
            try { await client.logout(); } catch { /* ignore */ }
          }
        }
      }

      return {
        synced: accounts.length,
        newMessages: totalNew,
        ...(errors.length > 0 ? { errors } : {}),
      };
    } catch (outerErr: any) {
      // Absolute last resort — should never reach here but prevents HTTP 500
      console.error('[InboxSync] Unexpected top-level error:', outerErr.message);
      return { synced: 0, newMessages: 0, errors: [outerErr.message || 'Unexpected sync error'] };
    }
  },
};

async function findSmtpAccount(userId: string, preferredId?: string | null): Promise<any> {
  if (preferredId) {
    const { data } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', preferredId)
      .eq('user_id', userId)
      .single();
    if (data) return data;
  }
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single();
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
    .select('*, smtp_accounts(id, email_address, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, user_id)')
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
        console.error(`[ScheduledEmails] No SMTP account for message ${msg.id}, clearing schedule`);
        await supabaseAdmin
          .from('inbox_messages')
          .update({ sara_status: null, sara_action: null })
          .eq('id', msg.id);
        continue;
      }

      const smtpPassword = decrypt(smtpAccount.smtp_pass_encrypted);

      await sendViaSmtp({
        smtpHost: smtpAccount.smtp_host,
        smtpPort: smtpAccount.smtp_port,
        smtpSecure: smtpAccount.smtp_secure,
        smtpUser: smtpAccount.smtp_user,
        smtpPass: smtpPassword,
        from: smtpAccount.email_address,
        to: msg.to_email,
        subject: msg.subject,
        html: msg.body_html,
        text: msg.body_text,
        messageId: msg.message_id,
        headers: msg.in_reply_to ? { 'In-Reply-To': msg.in_reply_to, 'References': msg.in_reply_to } : {},
      });

      // Mark as sent by clearing the schedule markers
      await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: null, sara_action: null })
        .eq('id', msg.id);

      sent++;
      console.log(`[ScheduledEmails] Sent scheduled email ${msg.id} to ${msg.to_email}`);
    } catch (err: any) {
      console.error(`[ScheduledEmails] Failed to send message ${msg.id}:`, err.message);
      // Clear schedule markers to prevent infinite retry loop
      await supabaseAdmin
        .from('inbox_messages')
        .update({ sara_status: null, sara_action: null })
        .eq('id', msg.id);
    }
  }

  return sent;
}
