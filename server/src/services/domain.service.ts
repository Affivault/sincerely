import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { DnsCheckResult, DnsRecordInstruction } from '@lemlist/shared';

const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);
const resolveCname = promisify(dns.resolveCname);

/** Provider-specific SPF includes for checking */
const PROVIDER_SPF_MAP: Record<string, string[]> = {
  'Google Workspace': ['_spf.google.com', 'google.com'],
  'Microsoft 365': ['spf.protection.outlook.com'],
  'Zoho Mail': ['zoho.com', 'zoho.eu'],
  'SendGrid': ['sendgrid.net'],
  'Mailgun': ['mailgun.org'],
  'Amazon SES': ['amazonses.com'],
  'Fastmail': ['messagingengine.com'],
  'Yahoo Mail': ['yahoodns.net'],
};

/** Common DKIM selectors by provider */
const PROVIDER_DKIM_SELECTORS: Record<string, string[]> = {
  'Google Workspace': ['google'],
  'Microsoft 365': ['selector1', 'selector2'],
  'Zoho Mail': ['zmail'],
  'SendGrid': ['s1', 's2', 'smtpapi'],
  'Mailgun': ['smtp', 'k1', 'mailo'],
  'Amazon SES': ['dkim'],
  'Fastmail': ['fm1', 'fm2', 'fm3'],
  'ProtonMail': ['protonmail', 'protonmail2', 'protonmail3'],
};

function generateVerificationToken(): string {
  return `sincerely-verify=${crypto.randomBytes(16).toString('hex')}`;
}

async function performDnsCheck(domain: string, verificationToken: string): Promise<DnsCheckResult> {
  const result: DnsCheckResult = {
    mx: { found: false, records: [] },
    spf: { found: false, record: null, valid: false, includes_provider: false },
    dkim: { found: false, selector: null, note: 'No DKIM record found' },
    dmarc: { found: false, record: null, policy: null },
    verification_txt: { found: false },
    provider_hint: null,
  };

  // 1. MX records + provider detection
  try {
    const mxRecords = await resolveMx(domain);
    result.mx.found = mxRecords.length > 0;
    result.mx.records = mxRecords
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({ exchange: r.exchange, priority: r.priority }));

    const mxStr = mxRecords.map((r) => r.exchange.toLowerCase()).join(' ');
    if (mxStr.includes('google') || mxStr.includes('gmail')) result.provider_hint = 'Google Workspace';
    else if (mxStr.includes('outlook') || mxStr.includes('microsoft')) result.provider_hint = 'Microsoft 365';
    else if (mxStr.includes('zoho')) result.provider_hint = 'Zoho Mail';
    else if (mxStr.includes('fastmail') || mxStr.includes('messagingengine')) result.provider_hint = 'Fastmail';
    else if (mxStr.includes('protonmail') || mxStr.includes('proton')) result.provider_hint = 'ProtonMail';
    else if (mxStr.includes('yahoo')) result.provider_hint = 'Yahoo Mail';
    else if (mxStr.includes('sendgrid')) result.provider_hint = 'SendGrid';
    else if (mxStr.includes('mailgun')) result.provider_hint = 'Mailgun';
    else if (mxStr.includes('amazonaws') || mxStr.includes('amazonses')) result.provider_hint = 'Amazon SES';
  } catch { /* no MX records */ }

  // 2. TXT records (SPF + verification token)
  try {
    const txtRecords = await resolveTxt(domain);
    for (const record of txtRecords) {
      const joined = record.join('');

      // Check SPF
      if (joined.startsWith('v=spf1')) {
        result.spf.found = true;
        result.spf.record = joined;
        result.spf.valid = joined.includes('include:') || joined.includes('ip4:') || joined.includes('a ') || joined.includes('mx ');

        // Check if SPF includes the detected provider
        if (result.provider_hint) {
          const providerIncludes = PROVIDER_SPF_MAP[result.provider_hint] || [];
          result.spf.includes_provider = providerIncludes.some((inc) => joined.includes(inc));
        }
      }

      // Check verification token
      if (joined.trim() === verificationToken) {
        result.verification_txt.found = true;
      }
    }
  } catch { /* no TXT records */ }

  // 3. DMARC
  try {
    const dmarcRecords = await resolveTxt(`_dmarc.${domain}`);
    for (const record of dmarcRecords) {
      const joined = record.join('');
      if (joined.startsWith('v=DMARC1')) {
        result.dmarc.found = true;
        result.dmarc.record = joined;
        const policyMatch = joined.match(/p=(\w+)/);
        result.dmarc.policy = policyMatch ? policyMatch[1] : null;
        break;
      }
    }
  } catch { /* no DMARC */ }

  // 4. DKIM — try provider-specific selectors first, then common ones
  const providerSelectors = result.provider_hint
    ? (PROVIDER_DKIM_SELECTORS[result.provider_hint] || [])
    : [];
  const fallbackSelectors = ['google', 'selector1', 'selector2', 'default', 'dkim', 'k1', 's1', 'mail'];
  const allSelectors = [...new Set([...providerSelectors, ...fallbackSelectors])];

  for (const selector of allSelectors) {
    const dkimHost = `${selector}._domainkey.${domain}`;
    // Try TXT record
    try {
      const dkimRecords = await resolveTxt(dkimHost);
      if (dkimRecords.length > 0) {
        const joined = dkimRecords[0].join('');
        if (joined.includes('v=DKIM1') || joined.includes('p=')) {
          result.dkim.found = true;
          result.dkim.selector = selector;
          result.dkim.note = `DKIM configured with selector "${selector}"`;
          break;
        }
      }
    } catch { /* try CNAME */ }
    // Try CNAME record
    try {
      await resolveCname(dkimHost);
      result.dkim.found = true;
      result.dkim.selector = selector;
      result.dkim.note = `DKIM CNAME configured with selector "${selector}"`;
      break;
    } catch { /* try next selector */ }
  }

  return result;
}

/** Generate the DNS records the user needs to add */
function buildRecordInstructions(domain: string, verificationToken: string, dnsCheck: DnsCheckResult): DnsRecordInstruction[] {
  const records: DnsRecordInstruction[] = [];

  // 1. Verification TXT record
  records.push({
    type: 'TXT',
    host: domain,
    value: verificationToken,
    purpose: 'Domain ownership verification for Sincerely',
    status: dnsCheck.verification_txt.found ? 'verified' : 'missing',
  });

  // 2. SPF record
  if (dnsCheck.spf.found) {
    records.push({
      type: 'TXT',
      host: domain,
      value: dnsCheck.spf.record || '',
      purpose: 'SPF record authorizes your email provider to send on your behalf',
      status: dnsCheck.spf.valid ? 'verified' : 'warning',
    });
  } else {
    // Suggest SPF based on detected provider
    const provider = dnsCheck.provider_hint;
    const spfIncludes = provider ? PROVIDER_SPF_MAP[provider] : null;
    const suggestedSpf = spfIncludes
      ? `v=spf1 include:${spfIncludes[0]} ~all`
      : 'v=spf1 include:YOUR_PROVIDER ~all';
    records.push({
      type: 'TXT',
      host: domain,
      value: suggestedSpf,
      purpose: 'SPF record authorizes your email provider to send on your behalf',
      status: 'missing',
    });
  }

  // 3. DKIM
  if (dnsCheck.dkim.found) {
    records.push({
      type: 'TXT',
      host: `${dnsCheck.dkim.selector}._domainkey.${domain}`,
      value: dnsCheck.dkim.note,
      purpose: 'DKIM cryptographically signs your emails to prevent spoofing',
      status: 'verified',
    });
  } else {
    const provider = dnsCheck.provider_hint;
    const selectors = provider ? (PROVIDER_DKIM_SELECTORS[provider] || ['default']) : ['default'];
    records.push({
      type: 'CNAME',
      host: `${selectors[0]}._domainkey.${domain}`,
      value: `Set up DKIM in your ${provider || 'email provider'} dashboard, then add the record here`,
      purpose: 'DKIM cryptographically signs your emails to prevent spoofing',
      status: 'missing',
    });
  }

  // 4. DMARC
  if (dnsCheck.dmarc.found) {
    records.push({
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: dnsCheck.dmarc.record || '',
      purpose: 'DMARC policy tells receiving servers how to handle failed authentication',
      status: dnsCheck.dmarc.policy === 'reject' || dnsCheck.dmarc.policy === 'quarantine' ? 'verified' : 'warning',
    });
  } else {
    records.push({
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100`,
      purpose: 'DMARC policy tells receiving servers how to handle failed authentication',
      status: 'missing',
    });
  }

  return records;
}

export const domainService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('sending_domains')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('sending_domains')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Domain not found', 404);
    return data;
  },

  async create(userId: string, domain: string) {
    const cleanDomain = domain.replace(/^@/, '').toLowerCase().trim();
    if (!cleanDomain || !cleanDomain.includes('.')) {
      throw new AppError('Invalid domain', 400);
    }

    const verificationToken = generateVerificationToken();

    const { data, error } = await supabaseAdmin
      .from('sending_domains')
      .insert({
        user_id: userId,
        domain: cleanDomain,
        verification_token: verificationToken,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('This domain is already added to your account', 409);
      }
      throw new AppError(error.message, 500);
    }

    // Run initial DNS check
    const dnsCheck = await performDnsCheck(cleanDomain, verificationToken);
    const records = buildRecordInstructions(cleanDomain, verificationToken, dnsCheck);

    return { domain: data, dns: dnsCheck, records };
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('sending_domains')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  /** Verify DNS records for a domain */
  async verify(userId: string, id: string) {
    const { data: domainRow, error } = await supabaseAdmin
      .from('sending_domains')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !domainRow) throw new AppError('Domain not found', 404);

    const dnsCheck = await performDnsCheck(domainRow.domain, domainRow.verification_token);
    const records = buildRecordInstructions(domainRow.domain, domainRow.verification_token, dnsCheck);

    // Update domain record with results
    const isVerified = dnsCheck.verification_txt.found;
    const updateData = {
      is_verified: isVerified,
      txt_verified: dnsCheck.verification_txt.found,
      spf_ok: dnsCheck.spf.found && dnsCheck.spf.valid,
      dkim_ok: dnsCheck.dkim.found,
      dmarc_ok: dnsCheck.dmarc.found,
      last_dns_check: dnsCheck as any,
      last_checked_at: new Date().toISOString(),
      detected_provider: dnsCheck.provider_hint,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('sending_domains')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw new AppError(updateError.message, 500);

    return { domain: updated, dns: dnsCheck, records };
  },

  /** Get DNS records that user needs to add (without re-checking) */
  async getRecords(userId: string, id: string) {
    const { data: domainRow, error } = await supabaseAdmin
      .from('sending_domains')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !domainRow) throw new AppError('Domain not found', 404);

    // If we have cached DNS results, use them; otherwise do a fresh check
    const dnsCheck = domainRow.last_dns_check
      ? (domainRow.last_dns_check as unknown as DnsCheckResult)
      : await performDnsCheck(domainRow.domain, domainRow.verification_token);

    const records = buildRecordInstructions(domainRow.domain, domainRow.verification_token, dnsCheck);

    return { domain: domainRow, dns: dnsCheck, records };
  },
};
