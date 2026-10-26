import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { decrypt } from '../utils/encryption.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { guardImap } from '../utils/imap-guard.js';
import { imapHostFor, listedAttachments } from './inbox-sync.service.js';
import {
  OUTGOING_ATTACHMENT_MAX_FILES,
  attachmentProblem, base64Bytes,
  type AttachmentMeta, type OutgoingAttachment,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Attachments: opening the ones that came, and sending your own.

   Synced mail keeps only the names and sizes of its attachments (migration
   090); the files stay in the mailbox they arrived in. Downloading one
   fetches that message from the mailbox again, at the moment it is asked
   for, rather than copying every attachment anybody ever received into
   our own storage on the off chance it is opened.
   ═══════════════════════════════════════════════════════════════════════ */

const CONNECT_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 45_000;

export interface DownloadedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * A filename that is safe in a Content-Disposition header.
 *
 * The plain `filename=` gets ASCII with quotes, backslashes and control
 * characters removed - a quote in a name would end the parameter early and
 * a CR/LF would start a new header. The real name, accents and all, goes
 * in `filename*=` (RFC 5987), which every current browser prefers.
 */
export function contentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (filename || 'attachment').replace(/[\x00-\x1f\x7f]/g, '').replace(/[\\/]/g, '_').slice(0, 200) || 'attachment';
  const ascii = base.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'attachment';
  const encoded = encodeURIComponent(base).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** A Content-Type we are willing to echo: type/subtype and nothing else. */
export function safeContentType(type: string | null | undefined): string {
  const t = String(type || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(t) ? t : 'application/octet-stream';
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { id = setTimeout(() => reject(new AppError(message, 504)), ms); }),
  ]).finally(() => clearTimeout(id!));
}

export const inboxAttachmentsService = {
  /**
   * One attachment of one of the caller's own messages, fetched from the
   * mailbox it is in.
   *
   * Scoped to the caller twice: the row is looked up with their user_id, and
   * the mailbox credentials are the ones on that row's own account, also
   * checked against their user_id. A message id from another account finds
   * no row and gets the same 404 as one that does not exist.
   */
  async download(userId: string, messageId: string, index: number): Promise<DownloadedAttachment> {
    if (!Number.isInteger(index) || index < 0 || index >= 50) throw new AppError('No such attachment', 404);

    const { data: m, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, imap_uid, imap_folder, smtp_account_id, attachments, direction')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!m) throw new AppError('Message not found', 404);

    const listed = Array.isArray((m as any).attachments) ? (m as any).attachments as AttachmentMeta[] : [];
    if (!listed[index]) throw new AppError('No such attachment', 404);

    /*
     * No UID means there is nothing to fetch it by: a message sent from
     * here (we keep its attachments' names, not the files), or one moved by
     * archive on a server that does not report new UIDs. Said plainly, with
     * where to find it, rather than a generic failure.
     */
    if (!m.imap_uid || !m.smtp_account_id) {
      throw new AppError(
        m.direction === 'outbound'
          ? 'This was sent from Sincerely, which keeps the names of what you attached but not the files. The copy in your mailbox\'s Sent folder has them.'
          : 'This message can no longer be found in your mailbox by Sincerely (it may have been moved or deleted there). Open it in your mail app to download the attachment.',
        409,
      );
    }

    const { data: account } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id, smtp_host, smtp_user, imap_host, imap_port, imap_secure, imap_user, smtp_pass_encrypted, email_address')
      .eq('id', m.smtp_account_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!account) throw new AppError('The mailbox this message came from is no longer connected.', 409);

    let password: string;
    try {
      password = decrypt(account.smtp_pass_encrypted);
    } catch {
      throw new AppError('Could not read this mailbox\'s saved password. Re-enter it in Mailboxes, then try again.', 409);
    }

    let ImapFlow: any;
    let simpleParser: any;
    try {
      ({ ImapFlow } = await import('imapflow'));
      ({ simpleParser } = await import('mailparser'));
    } catch {
      throw new AppError('Downloading attachments is not available on this server.', 501);
    }

    // The host the sync reads, by the same rule, so a download never dials
    // a different server than the one the message was synced from.
    const host = imapHostFor(account);
    const ip = await resolveHostIp(host).catch(() => null);
    const client = guardImap(new ImapFlow({
      host: ip || host,
      port: account.imap_port || 993,
      secure: account.imap_secure !== false,
      servername: host,
      auth: { user: account.imap_user || account.smtp_user || account.email_address, pass: password },
      logger: false,
      emitLogs: false,
    }), 'attachment');

    try {
      await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'Your mail server did not answer in time. Try again in a moment.');

      const folder = m.imap_folder || 'INBOX';
      try {
        // Read-only: opening a mailbox read-write can clear \Recent and, on
        // some servers, mark what is fetched as seen.
        await client.mailboxOpen(folder, { readOnly: true });
      } catch {
        throw new AppError(`The folder "${folder}" is no longer in your mailbox. Open the message in your mail app to download the attachment.`, 409);
      }

      const fetched: any = await withTimeout(
        client.fetchOne(String(m.imap_uid), { source: true }, { uid: true }),
        FETCH_TIMEOUT_MS,
        'Fetching the message took too long. Try again, or open it in your mail app.',
      );
      if (!fetched?.source) {
        throw new AppError('This message is no longer in your mailbox (it may have been moved or deleted there).', 410);
      }

      const parsed = await simpleParser(fetched.source);
      const file = listedAttachments<any>(parsed.attachments)[index];
      if (!file?.content) throw new AppError('That attachment is no longer in the message.', 410);

      return {
        filename: String(file.filename || listed[index].filename || 'attachment'),
        contentType: safeContentType(file.contentType || listed[index].content_type),
        content: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
      };
    } finally {
      try { await client.logout(); } catch { /* the connection may already be gone */ }
    }
  },
};

/**
 * Files from the composer, checked and turned into what nodemailer takes.
 *
 * Enforced here as well as in the composer: the composer's check is for the
 * person, this one is the rule. The size counted is the decoded size, not
 * the length of the base64 the request carried, so the limit means the same
 * thing on both sides.
 */
export function prepareOutgoingAttachments(input: unknown): {
  files: Array<{ filename: string; contentType: string; content: Buffer }>;
  meta: AttachmentMeta[];
} {
  if (input === undefined || input === null) return { files: [], meta: [] };
  if (!Array.isArray(input)) throw new AppError('attachments must be a list', 400);
  if (input.length > OUTGOING_ATTACHMENT_MAX_FILES) {
    throw new AppError(`Attach up to ${OUTGOING_ATTACHMENT_MAX_FILES} files to one email.`, 400);
  }

  const meta: AttachmentMeta[] = [];
  const bodies: string[] = [];
  for (const raw of input as Partial<OutgoingAttachment>[]) {
    const b64 = typeof raw?.content_base64 === 'string' ? raw.content_base64 : '';
    if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new AppError('An attachment could not be read. Remove it and attach it again.', 400);
    const filename = String(raw?.filename || 'attachment').replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'attachment';
    meta.push({ filename, content_type: safeContentType(raw?.content_type), size: base64Bytes(b64) });
    bodies.push(b64);
  }

  // Sized from the base64 before anything is decoded, so an oversized
  // request is refused without allocating the buffers it describes.
  const problem = attachmentProblem(meta);
  if (problem) throw new AppError(problem, 413);

  const files = meta.map((f, i) => ({
    filename: f.filename,
    contentType: f.content_type,
    content: Buffer.from(bodies[i], 'base64'),
  }));
  return { files, meta };
}
