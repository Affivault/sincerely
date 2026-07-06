import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { sendViaSmtp } from './email-sender.service.js';
import { billingService } from './billing.service.js';

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

    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .insert({ ...rest, user_id: userId, smtp_pass_encrypted })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);

    const { smtp_pass_encrypted: _, ...result } = data as any;
    return result;
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

    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('SMTP account not found', 404);

    const { smtp_pass_encrypted, ...rest } = data as any;
    return rest;
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
        from: account.email_address,
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
};
