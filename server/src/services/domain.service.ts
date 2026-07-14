import crypto from 'crypto';
import dns from 'dns';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { DnsCheckResult, DnsRecordInstruction } from '@lemlist/shared';

// A dedicated resolver so slow/unresponsive nameservers can't hang a verify
// request: 4s per attempt, 2 attempts max per lookup.
const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });

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

const FALLBACK_DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'dkim', 'k1', 's1', 'mail'];

function generateVerificationToken(): string {
  return `sincerely-verify=${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Normalize whatever the user pasted (URL, email address, domain with a
 * trailing dot, uppercase…) down to a bare registrable domain, or throw.
 */
export function normalizeDomain(input: string): string {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip protocol (https://, ftp://…)
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1); // extract domain from an email address
  d = d.split('/')[0].split('?')[0].split('#')[0]; // strip path/query/fragment
  d = d.split(':')[0]; // strip port
  d = d.replace(/^www\./, '').replace(/\.+$/, '');

  const valid = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
  if (!valid) {
    throw new AppError('Enter a valid domain like example.com (no http://, paths or email addresses)', 400);
  }
  return d;
}

/** Detect the mailbox provider from MX hostnames. */
function detectProvider(mxHosts: string[]): string | null {
  const mxStr = mxHosts.join(' ').toLowerCase();
  if (mxStr.includes('google') || mxStr.includes('gmail')) return 'Google Workspace';
  if (mxStr.includes('outlook') || mxStr.includes('microsoft')) return 'Microsoft 365';
  if (mxStr.includes('zoho')) return 'Zoho Mail';
  if (mxStr.includes('fastmail') || mxStr.includes('messagingengine')) return 'Fastmail';
  if (mxStr.includes('protonmail') || mxStr.includes('proton')) return 'ProtonMail';
  if (mxStr.includes('yahoo')) return 'Yahoo Mail';
  if (mxStr.includes('sendgrid')) return 'SendGrid';
  if (mxStr.includes('mailgun')) return 'Mailgun';
  if (mxStr.includes('amazonaws') || mxStr.includes('amazonses')) return 'Amazon SES';
  return null;
}

/** Parse the DMARC policy without being fooled by sp= / np= / fo= tags. */
function parseDmarcPolicy(record: string): string | null {
  const m = record.match(/(?:^|[;\s])p\s*=\s*([a-zA-Z]+)/);
  return m ? m[1].toLowerCase() : null;
}

/** True when a TXT payload looks like an actual DKIM key record. */
function looksLikeDkim(txt: string): boolean {
  return /(^|;)\s*v\s*=\s*DKIM1/i.test(txt) || /(^|;)\s*[kp]\s*=/.test(txt);
}

/**
 * Probe one DKIM selector. resolveTxt follows CNAME chains, so provider
 * CNAME setups (SendGrid, M365, SES) are found via the TXT path too; the
 * CNAME fallback only matters when the target zone is temporarily broken,
 * and it requires a DKIM-looking target to avoid wildcard-DNS false hits.
 */
async function probeDkimSelector(domain: string, selector: string): Promise<{ selector: string; via: 'txt' | 'cname' } | null> {
  const host = `${selector}._domainkey.${domain}`;
  try {
    const records = await resolver.resolveTxt(host);
    for (const chunks of records) {
      if (looksLikeDkim(chunks.join(''))) return { selector, via: 'txt' };
    }
  } catch { /* fall through to CNAME */ }
  try {
    const targets = await resolver.resolveCname(host);
    if (targets.some((t) => /domainkey|dkim/i.test(t))) return { selector, via: 'cname' };
  } catch { /* selector not configured */ }
  return null;
}

async function performDnsCheck(domain: string, verificationToken: string): Promise<DnsCheckResult> {
  const result: DnsCheckResult = {
    mx: { found: false, records: [] },
    spf: { found: false, record: null, valid: false, includes_provider: false, multiple: false },
    dkim: { found: false, selector: null, note: 'No DKIM record found' },
    dmarc: { found: false, record: null, policy: null },
    verification_txt: { found: false },
    provider_hint: null,
  };

  // MX, root TXT (SPF + ownership token) and DMARC lookups are independent —
  // run them in parallel instead of serially.
  const [mxRes, txtRes, dmarcRes] = await Promise.allSettled([
    resolver.resolveMx(domain),
    resolver.resolveTxt(domain),
    resolver.resolveTxt(`_dmarc.${domain}`),
  ]);

  // 1. MX records + provider detection
  if (mxRes.status === 'fulfilled' && mxRes.value.length > 0) {
    const mxRecords = [...mxRes.value].sort((a, b) => a.priority - b.priority);
    result.mx.found = true;
    result.mx.records = mxRecords.map((r) => ({ exchange: r.exchange, priority: r.priority }));
    result.provider_hint = detectProvider(mxRecords.map((r) => r.exchange));
  }

  // 2. TXT records (SPF + verification token)
  if (txtRes.status === 'fulfilled') {
    const spfRecords: string[] = [];
    for (const chunks of txtRes.value) {
      const joined = chunks.join('');
      if (/^v=spf1(\s|$)/i.test(joined.trim())) spfRecords.push(joined.trim());
      // The ownership token may be pasted with surrounding quotes/whitespace.
      if (joined.trim().replace(/^"|"$/g, '') === verificationToken) {
        result.verification_txt.found = true;
      }
    }
    if (spfRecords.length > 0) {
      const spf = spfRecords[0];
      result.spf.found = true;
      result.spf.record = spf;
      // More than one SPF record is a hard permerror per RFC 7208 §4.5.
      result.spf.multiple = spfRecords.length > 1;
      const hasMechanism = /(\s|^)(include:|ip4:|ip6:|a[\s:]|mx[\s:]|exists:|redirect=)/i.test(spf + ' ');
      const hasTerminal = /(\s)([~\-?+]?all)(\s|$)/i.test(spf + ' ') || /redirect=/i.test(spf);
      result.spf.valid = hasMechanism && hasTerminal && !result.spf.multiple;
      if (result.provider_hint) {
        const providerIncludes = PROVIDER_SPF_MAP[result.provider_hint] || [];
        result.spf.includes_provider = providerIncludes.some((inc) => spf.toLowerCase().includes(inc));
      }
    }
  }

  // 3. DMARC
  if (dmarcRes.status === 'fulfilled') {
    for (const chunks of dmarcRes.value) {
      const joined = chunks.join('');
      if (/^v=DMARC1/i.test(joined.trim())) {
        result.dmarc.found = true;
        result.dmarc.record = joined.trim();
        result.dmarc.policy = parseDmarcPolicy(joined);
        break;
      }
    }
  }

  // 4. DKIM — probe provider-specific selectors first, then common ones,
  // all in parallel. First hit (in priority order) wins.
  const providerSelectors = result.provider_hint ? (PROVIDER_DKIM_SELECTORS[result.provider_hint] || []) : [];
  const allSelectors = [...new Set([...providerSelectors, ...FALLBACK_DKIM_SELECTORS])];
  const probes = await Promise.all(allSelectors.map((s) => probeDkimSelector(domain, s)));
  const hit = probes.find((p) => p !== null);
  if (hit) {
    result.dkim.found = true;
    result.dkim.selector = hit.selector;
    result.dkim.note = hit.via === 'txt'
      ? `DKIM configured with selector "${hit.selector}"`
      : `DKIM CNAME configured with selector "${hit.selector}"`;
  }

  return result;
}

/** Generate the DNS records the user needs to add */
function buildRecordInstructions(domain: string, verificationToken: string, dnsCheck: DnsCheckResult): DnsRecordInstruction[] {
  const records: DnsRecordInstruction[] = [];
  const provider = dnsCheck.provider_hint;

  // 1. Verification TXT record
  records.push({
    id: 'ownership',
    label: 'Ownership',
    type: 'TXT',
    host: domain,
    value: verificationToken,
    purpose: 'Proves you own this domain so Sincerely can send on its behalf.',
    status: dnsCheck.verification_txt.found ? 'verified' : 'missing',
  });

  // 2. SPF record
  const spfIncludes = provider ? PROVIDER_SPF_MAP[provider] : null;
  const suggestedSpf = spfIncludes
    ? `v=spf1 include:${spfIncludes[0]} ~all`
    : 'v=spf1 include:YOUR_PROVIDER ~all';
  if (dnsCheck.spf.found) {
    const status = dnsCheck.spf.multiple ? 'warning' : dnsCheck.spf.valid ? 'verified' : 'warning';
    records.push({
      id: 'spf',
      label: 'SPF',
      type: 'TXT',
      host: domain,
      value: dnsCheck.spf.record || suggestedSpf,
      current: dnsCheck.spf.record,
      purpose: 'Lists the servers allowed to send email for your domain.',
      status,
      note: dnsCheck.spf.multiple
        ? 'Multiple SPF records found — mail servers treat this as a permanent error. Merge them into a single record.'
        : !dnsCheck.spf.valid
          ? 'SPF record found but it looks incomplete — it should list a mechanism (include:, ip4:…) and end with ~all or -all.'
          : provider && !dnsCheck.spf.includes_provider
            ? `Doesn't include ${provider} (${spfIncludes?.[0]}). Add it if you send through ${provider}.`
            : undefined,
    });
  } else {
    records.push({
      id: 'spf',
      label: 'SPF',
      type: 'TXT',
      host: domain,
      value: suggestedSpf,
      purpose: 'Lists the servers allowed to send email for your domain.',
      status: 'missing',
      note: spfIncludes ? undefined : 'Replace YOUR_PROVIDER with your email provider’s SPF include (e.g. _spf.google.com).',
    });
  }

  // 3. DKIM
  if (dnsCheck.dkim.found) {
    records.push({
      id: 'dkim',
      label: 'DKIM',
      type: 'TXT',
      host: `${dnsCheck.dkim.selector}._domainkey.${domain}`,
      value: '',
      current: dnsCheck.dkim.note,
      purpose: 'Cryptographically signs your emails so receivers can verify they weren’t tampered with.',
      status: 'verified',
      copyable: false,
      note: dnsCheck.dkim.note,
    });
  } else {
    const selectors = provider ? (PROVIDER_DKIM_SELECTORS[provider] || ['default']) : ['default'];
    records.push({
      id: 'dkim',
      label: 'DKIM',
      type: 'CNAME',
      host: `${selectors[0]}._domainkey.${domain}`,
      value: '',
      purpose: 'Cryptographically signs your emails so receivers can verify they weren’t tampered with.',
      status: 'missing',
      copyable: false,
      note: provider
        ? `Enable DKIM in your ${provider} admin console — it will give you the exact record (host + value) to add.`
        : 'Enable DKIM in your email provider’s dashboard — it will give you the exact record (host + value) to add.',
    });
  }

  // 4. DMARC
  const suggestedDmarc = `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100`;
  if (dnsCheck.dmarc.found) {
    const strict = dnsCheck.dmarc.policy === 'reject' || dnsCheck.dmarc.policy === 'quarantine';
    records.push({
      id: 'dmarc',
      label: 'DMARC',
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: dnsCheck.dmarc.record || suggestedDmarc,
      current: dnsCheck.dmarc.record,
      purpose: 'Tells receiving servers what to do when SPF/DKIM checks fail.',
      status: strict ? 'verified' : 'warning',
      note: strict ? undefined : `Policy is "p=${dnsCheck.dmarc.policy || 'none'}" — Gmail & Yahoo bulk-sender rules expect at least p=quarantine once you’re confident in your setup.`,
    });
  } else {
    records.push({
      id: 'dmarc',
      label: 'DMARC',
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: suggestedDmarc,
      purpose: 'Tells receiving servers what to do when SPF/DKIM checks fail.',
      status: 'missing',
    });
  }

  return records;
}

/** Persistable column updates derived from a DNS check. */
function dnsUpdatePayload(dnsCheck: DnsCheckResult) {
  return {
    is_verified: dnsCheck.verification_txt.found,
    txt_verified: dnsCheck.verification_txt.found,
    spf_ok: dnsCheck.spf.found && dnsCheck.spf.valid,
    dkim_ok: dnsCheck.dkim.found,
    dmarc_ok: dnsCheck.dmarc.found,
    last_dns_check: dnsCheck as any,
    last_checked_at: new Date().toISOString(),
    detected_provider: dnsCheck.provider_hint,
    updated_at: new Date().toISOString(),
  };
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
    const cleanDomain = normalizeDomain(domain);
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

    // Run the initial DNS check and persist it so the list immediately shows
    // real SPF/DKIM/DMARC state instead of all-red until a manual verify.
    // DNS hiccups must not fail the create — fall back to an empty check.
    let row = data;
    let dnsCheck: DnsCheckResult = {
      mx: { found: false, records: [] },
      spf: { found: false, record: null, valid: false, includes_provider: false, multiple: false },
      dkim: { found: false, selector: null, note: 'No DKIM record found' },
      dmarc: { found: false, record: null, policy: null },
      verification_txt: { found: false },
      provider_hint: null,
    };
    try {
      dnsCheck = await performDnsCheck(cleanDomain, verificationToken);
      const { data: updated } = await supabaseAdmin
        .from('sending_domains')
        .update(dnsUpdatePayload(dnsCheck))
        .eq('id', data.id)
        .eq('user_id', userId)
        .select()
        .single();
      if (updated) row = updated;
    } catch { /* client can hit Verify to retry */ }

    const records = buildRecordInstructions(cleanDomain, verificationToken, dnsCheck);
    return { domain: row, dns: dnsCheck, records };
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

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('sending_domains')
      .update(dnsUpdatePayload(dnsCheck))
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
