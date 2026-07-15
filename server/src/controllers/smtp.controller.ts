import { Response, NextFunction } from 'express';
import dns from 'dns';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { smtpService } from '../services/smtp.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp, formatFromHeader, describeSmtpError } from '../services/email-sender.service.js';
import { previewWithSampleData } from '../services/sequence.service.js';
import { billingService } from '../services/billing.service.js';
import { warmupService } from '../services/warmup.service.js';

const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);
const resolveCname = promisify(dns.resolveCname);

export const smtpController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const accounts = await smtpService.list(req.userId!);
      res.json(accounts);
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const account = await smtpService.get(req.userId!, req.params.id);
      res.json(account);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const account = await smtpService.create(req.userId!, req.body);
      res.status(201).json(account);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const account = await smtpService.update(req.userId!, req.params.id, req.body);
      res.json(account);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await smtpService.delete(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async test(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await smtpService.test(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  /**
   * POST /smtp-accounts/verify
   * Check raw SMTP credentials before saving the account.
   */
  async verify(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await smtpService.verifyCredentials(req.userId!, req.body);
      res.json(result);
    } catch (err) { next(err); }
  },

  /** GET /smtp-accounts/warmup — warm-up status + metrics for every mailbox. */
  async warmupSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await warmupService.summary(req.userId!);
      res.json(result);
    } catch (err) { next(err); }
  },

  /** POST /smtp-accounts/:id/warmup — enable/pause warm-up and set the ramp config. */
  async setWarmup(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await warmupService.setWarmup(req.userId!, req.params.id, req.body);
      res.json(result);
    } catch (err) { next(err); }
  },

  /**
   * POST /smtp-accounts/:id/send-test
   * Send a test email through a specific SMTP account (no campaign needed).
   */
  async sendTestEmail(req: AuthRequest, res: Response, _next: NextFunction) {
    try {
      const { to, subject, body_html } = req.body;
      if (!to || !subject) {
        return res.status(400).json({ error: 'to and subject are required' });
      }

      console.log(`[TestEmail] Request: to=${to}, subject=${subject}, smtpId=${req.params.id}, userId=${req.userId}`);

      const { data: account, error: fetchError } = await supabaseAdmin
        .from('smtp_accounts')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId!)
        .single();

      if (fetchError) {
        console.error('[TestEmail] DB fetch error:', fetchError.message);
        return res.status(500).json({ error: `Database error: ${fetchError.message}` });
      }
      if (!account) {
        return res.status(404).json({ error: 'SMTP account not found for this user' });
      }

      console.log(`[TestEmail] Using SMTP: ${account.smtp_host}:${account.smtp_port} user=${account.smtp_user}`);

      let password: string;
      try {
        password = decrypt(account.smtp_pass_encrypted);
      } catch (decryptErr: any) {
        console.error('[TestEmail] Decrypt error:', decryptErr.message);
        return res.status(500).json({ error: `Failed to decrypt SMTP password: ${decryptErr.message}` });
      }

      // Test sends deliver real email to arbitrary recipients — they count
      // against the monthly cap like any other send.
      if (!(await billingService.reserveEmailQuota(req.userId!))) {
        return res.status(403).json({
          success: false,
          error: "You've reached your monthly email limit. Upgrade to send more.",
          code: 'UPGRADE_REQUIRED',
        });
      }

      // Fill personalization tags with sample data so the test reads naturally
      // ("Hi Alex,") instead of showing raw {{first_name}} tags. A tiny banner
      // marks it as a preview so the recipient knows the values are samples.
      const rawHtml = body_html || '<p>This is a test email from Sincerely.</p>';
      const previewSubject = previewWithSampleData(subject);
      const previewHtml =
        `<div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:8px;padding:8px 12px;margin-bottom:16px;font:13px/1.4 -apple-system,Segoe UI,sans-serif;color:#4338CA">` +
        `✦ <strong>Test preview</strong> — personalization tags are filled with sample data (e.g. Alex Morgan @ Acme Inc).</div>` +
        previewWithSampleData(rawHtml);

      try {
        await sendViaSmtp({
          smtpHost: account.smtp_host,
          smtpPort: account.smtp_port,
          smtpSecure: account.smtp_secure,
          smtpUser: account.smtp_user,
          smtpPass: password,
          from: formatFromHeader(account.from_name || account.label, account.email_address),
          to,
          subject: `[TEST] ${previewSubject}`,
          html: previewHtml,
          text: previewHtml.replace(/<[^>]*>/g, ''),
          // Short handshake budget so a wrong port/SSL fails fast (well under
          // the client's 30s HTTP timeout) with an actionable message.
          timeoutMs: 12000,
        });
      } catch (sendErr) {
        await billingService.refundEmailQuota(req.userId!);
        const friendly = describeSmtpError(sendErr);
        console.error('[TestEmail] Send error:', (sendErr as any)?.message);
        return res.status(502).json({ success: false, error: friendly });
      }

      // Mark account as verified since we know the credentials work
      await supabaseAdmin
        .from('smtp_accounts')
        .update({ is_verified: true })
        .eq('id', account.id);

      console.log(`[TestEmail] Sent to ${to} via ${account.label || account.smtp_host}`);
      res.json({ success: true, message: `Test email sent to ${to} — check your inbox` });
    } catch (err: any) {
      console.error('[TestEmail] Send error:', err.message);
      res.status(500).json({ success: false, error: describeSmtpError(err) });
    }
  },

  /**
   * POST /smtp-accounts/check-domain
   * Check DNS records (SPF, DKIM, DMARC, MX) for a domain.
   */
  async checkDomain(req: AuthRequest, res: Response, _next: NextFunction) {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ error: 'domain is required' });

      const cleanDomain = domain.replace(/^@/, '').toLowerCase().trim();
      const results: {
        domain: string;
        mx: { found: boolean; records: Array<{ exchange: string; priority: number }> };
        spf: { found: boolean; record: string | null; valid: boolean };
        dkim: { found: boolean; note: string };
        dmarc: { found: boolean; record: string | null; policy: string | null };
        provider_hint: string | null;
      } = {
        domain: cleanDomain,
        mx: { found: false, records: [] },
        spf: { found: false, record: null, valid: false },
        dkim: { found: false, note: 'DKIM selectors are provider-specific. Check your provider dashboard.' },
        dmarc: { found: false, record: null, policy: null },
        provider_hint: null,
      };

      // MX records
      try {
        const mxRecords = await resolveMx(cleanDomain);
        results.mx.found = mxRecords.length > 0;
        results.mx.records = mxRecords
          .sort((a, b) => a.priority - b.priority)
          .map((r) => ({ exchange: r.exchange, priority: r.priority }));

        // Detect provider from MX
        const mxStr = mxRecords.map((r) => r.exchange.toLowerCase()).join(' ');
        if (mxStr.includes('google') || mxStr.includes('gmail')) results.provider_hint = 'Google Workspace';
        else if (mxStr.includes('outlook') || mxStr.includes('microsoft')) results.provider_hint = 'Microsoft 365';
        else if (mxStr.includes('zoho')) results.provider_hint = 'Zoho Mail';
        else if (mxStr.includes('fastmail')) results.provider_hint = 'Fastmail';
        else if (mxStr.includes('protonmail') || mxStr.includes('proton')) results.provider_hint = 'ProtonMail';
        else if (mxStr.includes('yahoo')) results.provider_hint = 'Yahoo Mail';
      } catch { /* no MX records */ }

      // SPF record
      try {
        const txtRecords = await resolveTxt(cleanDomain);
        for (const record of txtRecords) {
          const joined = record.join('');
          if (joined.startsWith('v=spf1')) {
            results.spf.found = true;
            results.spf.record = joined;
            results.spf.valid = joined.includes('include:') || joined.includes('ip4:') || joined.includes('a ') || joined.includes('mx ');
            break;
          }
        }
      } catch { /* no TXT records */ }

      // DMARC record
      try {
        const dmarcRecords = await resolveTxt(`_dmarc.${cleanDomain}`);
        for (const record of dmarcRecords) {
          const joined = record.join('');
          if (joined.startsWith('v=DMARC1')) {
            results.dmarc.found = true;
            results.dmarc.record = joined;
            const policyMatch = joined.match(/p=(\w+)/);
            results.dmarc.policy = policyMatch ? policyMatch[1] : null;
            break;
          }
        }
      } catch { /* no DMARC record */ }

      // Try common DKIM selectors
      const dkimSelectors = ['google', 'selector1', 'selector2', 'default', 'dkim', 'k1', 's1', 'mail'];
      for (const selector of dkimSelectors) {
        try {
          const dkimRecords = await resolveTxt(`${selector}._domainkey.${cleanDomain}`);
          if (dkimRecords.length > 0) {
            const joined = dkimRecords[0].join('');
            if (joined.includes('v=DKIM1') || joined.includes('p=')) {
              results.dkim.found = true;
              results.dkim.note = `Found DKIM with selector "${selector}"`;
              break;
            }
          }
        } catch { /* try next selector */ }
      }

      // Also check for CNAME-based DKIM
      if (!results.dkim.found) {
        for (const selector of dkimSelectors) {
          try {
            await resolveCname(`${selector}._domainkey.${cleanDomain}`);
            results.dkim.found = true;
            results.dkim.note = `Found DKIM CNAME with selector "${selector}"`;
            break;
          } catch { /* try next */ }
        }
      }

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
