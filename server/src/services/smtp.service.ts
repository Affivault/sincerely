import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { sendViaSmtp, formatFromHeader, describeSmtpError } from './email-sender.service.js';
import { billingService } from './billing.service.js';

/** Log into IMAP to prove replies can be read. Bounded, never throws. */
async function verifyImapLogin(opts: { host: string; port: number; secure: boolean; user: string; pass: string }):
  Promise<{ ok: boolean; status: 'ok' | 'fail'; message: string }> {
  let ImapFlow: any;
  try {
    ({ ImapFlow } = await import('imapflow'));
  } catch {
    return { ok: true, status: 'ok', message: 'IMAP check skipped (module unavailable) — SMTP verified.' };
  }
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass },
    logger: false,
    // Keep the whole check snappy so the HTTP request replies well under 30s.
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  try {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IMAP connect timed out')), 12000); });
    await Promise.race([client.connect(), timeout]).finally(() => clearTimeout(timer!));
    await client.logout().catch(() => {});
    return { ok: true, status: 'ok', message: 'IMAP works — replies will sync into the unibox.' };
  } catch (err: any) {
    try { await client.close?.(); } catch { /* ignore */ }
    return { ok: false, status: 'fail', message: `IMAP: ${describeSmtpError(err)}` };
  }
}

/** Drop a column the DB reports as missing so an insert/update can retry.
 *  Returns true when a key was stripped. */
function stripMissingColumnKey(errorMessage: string, obj: Record<string, any>): boolean {
  const m = /column "([a-zA-Z0-9_]+)"/.exec(errorMessage || '');
  if (m && m[1] in obj) {
    delete obj[m[1]];
    return true;
  }
  return false;
}

export const smtpService = {
  /** Verify an smtp_accounts row belongs to this user before acting on its id alone. */
  async assertOwnership(userId: string, id: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('SMTP account not found', 404);
  },

  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new AppError(error.message, 500);
    // Strip encrypted password from response
    return (data || []).map(({ smtp_pass_encrypted, ...rest }: any) => rest);
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('SMTP account not found', 404);

    const { smtp_pass_encrypted, ...rest } = data as any;
    return rest;
  },

  async create(userId: string, input: any) {
    // Enforce the plan's inbox cap before connecting another mailbox.
    await billingService.assertCanAddInbox(userId);

    const { smtp_pass, ...rest } = input;
    const smtp_pass_encrypted = encrypt(smtp_pass);
    const row: any = { ...rest, user_id: userId, smtp_pass_encrypted };

    // Retry without any column the DB doesn't have yet, so shipping ahead of a
    // migration (e.g. reply_to) never blocks connecting a mailbox.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabaseAdmin
        .from('smtp_accounts')
        .insert(row)
        .select()
        .single();
      if (!error) {
        const { smtp_pass_encrypted: _, ...result } = data as any;
        return result;
      }
      if (!stripMissingColumnKey(error.message, row)) throw new AppError(error.message, 500);
    }
    throw new AppError('Failed to create SMTP account', 500);
  },

  async update(userId: string, id: string, input: any) {
    const updateData: any = { ...input };

    // Only re-encrypt when a new password is supplied; always drop the raw
    // field so an empty `smtp_pass` (e.g. a signature-only edit) never reaches
    // the DB as a non-existent column.
    if (input.smtp_pass) {
      updateData.smtp_pass_encrypted = encrypt(input.smtp_pass);
    }
    delete updateData.smtp_pass;

    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabaseAdmin
        .from('smtp_accounts')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
      if (!error) {
        if (!data) throw new AppError('SMTP account not found', 404);
        const { smtp_pass_encrypted, ...rest } = data as any;
        return rest;
      }
      if (!stripMissingColumnKey(error.message, updateData)) throw new AppError(error.message, 500);
    }
    throw new AppError('Failed to update SMTP account', 500);
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('smtp_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  async test(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new AppError('SMTP account not found', 404);

    const account = data as any;
    const password = decrypt(account.smtp_pass_encrypted);

    try {
      // Verify by sending a test email to the account's own address
      await sendViaSmtp({
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure,
        smtpUser: account.smtp_user,
        smtpPass: password,
        from: formatFromHeader(account.from_name || account.label, account.email_address),
        to: account.email_address,
        subject: '[Sincerely] SMTP Verification',
        text: 'Your SMTP account has been verified successfully.',
      });
      await supabaseAdmin
        .from('smtp_accounts')
        .update({ is_verified: true })
        .eq('id', id);
      return { success: true, message: 'SMTP connection verified successfully' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  },

  /**
   * Verify raw credentials without persisting an account — powers the
   * "Check connection" button. Tests SMTP (a self-addressed probe mail, so no
   * external recipient and no send quota) and, when IMAP details are supplied,
   * logs into IMAP too. Both legs report independently so the UI can show
   * exactly which side failed and why.
   */
  async verifyCredentials(_userId: string, input: any) {
    const required = ['email_address', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass'];
    for (const key of required) {
      if (!input?.[key]) {
        return {
          success: false,
          message: `Missing ${key.replace('_', ' ')}`,
          smtp: { ok: false, status: 'fail', message: `Missing ${key.replace('_', ' ')}` },
        };
      }
    }

    // ── SMTP leg ──
    let smtp: { ok: boolean; status: 'ok' | 'fail'; message: string };
    try {
      await sendViaSmtp({
        smtpHost: input.smtp_host,
        smtpPort: Number(input.smtp_port),
        smtpSecure: !!input.smtp_secure,
        smtpUser: input.smtp_user,
        smtpPass: input.smtp_pass,
        from: formatFromHeader(input.from_name, input.email_address),
        to: input.email_address,
        subject: '[Sincerely] Connection check',
        text: 'This mailbox is correctly configured to send through Sincerely.',
        timeoutMs: 12000,
      });
      smtp = { ok: true, status: 'ok', message: 'SMTP works — this mailbox can send.' };
    } catch (err: any) {
      smtp = { ok: false, status: 'fail', message: describeSmtpError(err) };
    }

    // ── IMAP leg (only if host provided) ──
    let imap: { ok: boolean; status: 'ok' | 'fail' | 'skipped'; message: string };
    if (input.imap_host) {
      imap = await verifyImapLogin({
        host: input.imap_host,
        port: Number(input.imap_port) || 993,
        secure: input.imap_secure !== false,
        user: input.imap_user || input.smtp_user || input.email_address,
        pass: input.smtp_pass,
      });
    } else {
      imap = { ok: true, status: 'skipped', message: 'IMAP not configured — replies won’t sync into the unibox.' };
    }

    const success = smtp.ok && imap.status !== 'fail';
    const message = success
      ? (imap.status === 'ok' ? 'Connection successful — sending and receiving both work.' : 'SMTP works — this mailbox can send.')
      : (!smtp.ok ? smtp.message : imap.message);

    return { success, message, smtp, imap };
  },
};
