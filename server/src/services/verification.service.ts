import { supabaseAdmin } from '../config/supabase.js';
import dns from 'dns';
import net from 'net';
import type { DcsVerificationResult } from '@lemlist/shared';
import { fireEvent } from './webhook.service.js';

/**
 * Triple-Layer Verification Pipeline + Deliverability Confidence Score (DCS)
 *
 * Layer 1: Syntax & format validation
 * Layer 2: Domain DNS (MX record) validation
 * Layer 3: SMTP handshake simulation
 *
 * DCS = weighted score from all three layers + historical bounce data
 */

// ============================================
// Layer 1: Syntax Check
// ============================================
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function checkSyntax(email: string): boolean {
  if (!email || email.length > 254) return false;
  if (!EMAIL_REGEX.test(email)) return false;
  const [local, domain] = email.split('@');
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 253) return false;
  return true;
}

// ============================================
// Layer 2: Domain DNS Check
// ============================================
const DNS_TIMEOUT_MS = 8000;

async function checkDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  // Always clear the timer once the race settles — otherwise every call leaves
  // a live 8s timeout running even after the DNS lookup resolves first, which
  // adds up fast across a batch/auto-verify run (each contact triggers this
  // up to twice: MX then the A-record fallback).
  const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS);
      promise
        .then((value) => { clearTimeout(timer); resolve(value); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });

  try {
    const mxRecords = await withTimeout(dns.promises.resolveMx(domain));
    return mxRecords.length > 0;
  } catch {
    // MX failed — fall back to A record
    try {
      const aRecords = await withTimeout(dns.promises.resolve4(domain));
      return aRecords.length > 0;
    } catch {
      return false;
    }
  }
}

// ============================================
// Layer 3: SMTP Handshake Simulation
// ============================================
async function checkSmtp(email: string): Promise<{ ok: boolean; reason?: string }> {
  const domain = email.split('@')[1];
  if (!domain) return { ok: false, reason: 'Invalid domain' };

  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve({ ok: false, reason: 'No MX records' });
        return;
      }

      // Sort by priority (lowest = highest priority)
      const sorted = addresses.sort((a, b) => a.priority - b.priority);
      const mxHost = sorted[0].exchange;

      const socket = new net.Socket();
      let lineBuf = '';
      let step = 0;

      const timeout = setTimeout(() => {
        socket.destroy();
        // Timeout is not necessarily a failure - many servers are slow
        resolve({ ok: true, reason: 'SMTP timeout (assumed valid)' });
      }, 10000);

      socket.connect(25, mxHost, () => {
        // Connected, wait for greeting
      });

      socket.on('data', (data) => {
        lineBuf += data.toString();
        // Parse complete lines; a final response line has a space at position 3, not '-'
        const lines = lineBuf.split('\r\n');
        lineBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.length < 4) continue;
          if (line[3] === '-') continue; // multi-line continuation, skip
          const code = parseInt(line.substring(0, 3), 10);

          if (step === 0) {
            // Server greeting
            if (code === 220) {
              socket.write('EHLO usesincerely.com\r\n');
              step = 1;
            } else {
              clearTimeout(timeout);
              socket.destroy();
              resolve({ ok: false, reason: `Bad greeting: ${code}` });
            }
          } else if (step === 1) {
            // EHLO response
            if (code === 250) {
              socket.write(`MAIL FROM:<verify@usesincerely.com>\r\n`);
              step = 2;
            } else {
              clearTimeout(timeout);
              socket.destroy();
              resolve({ ok: false, reason: `EHLO rejected: ${code}` });
            }
          } else if (step === 2) {
            // MAIL FROM response
            if (code === 250) {
              socket.write(`RCPT TO:<${email}>\r\n`);
              step = 3;
            } else {
              clearTimeout(timeout);
              socket.destroy();
              resolve({ ok: false, reason: `MAIL FROM rejected: ${code}` });
            }
          } else if (step === 3) {
            // RCPT TO response - this is the key check
            clearTimeout(timeout);
            socket.write('QUIT\r\n');
            socket.destroy();

            if (code === 250 || code === 251) {
              resolve({ ok: true });
            } else if (code === 550 || code === 551 || code === 553) {
              resolve({ ok: false, reason: `Mailbox does not exist (${code})` });
            } else if (code === 452 || code === 552) {
              resolve({ ok: true, reason: 'Mailbox full but exists' });
            } else {
              // Catch-all domains or greylisting - assume valid
              resolve({ ok: true, reason: `Ambiguous response (${code})` });
            }
          }
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        // Connection error - server exists but refused, assume valid
        resolve({ ok: true, reason: 'Connection error (assumed valid)' });
      });
    });
  });
}

// ============================================
// DCS Score Calculation
// ============================================
function calculateDcs(
  syntaxOk: boolean,
  domainOk: boolean,
  smtpOk: boolean,
  historicalBounceRate?: number
): number {
  if (!syntaxOk) return 0;
  if (!domainOk) return 10;

  // Base score from verification layers
  let score = 0;
  score += syntaxOk ? 30 : 0;    // Syntax: 30 points
  score += domainOk ? 30 : 0;    // Domain: 30 points
  score += smtpOk ? 30 : 0;      // SMTP:   30 points

  // Baseline bonus for passing all checks
  if (syntaxOk && domainOk && smtpOk) {
    score += 10;
  }

  // Historical bounce penalty
  if (historicalBounceRate !== undefined && historicalBounceRate > 0) {
    score -= Math.round(historicalBounceRate * 20); // High bounce rate = penalty
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================
// Public API
// ============================================

/**
 * Verify a single email address through the triple-layer pipeline.
 */
export async function verifyEmail(email: string): Promise<DcsVerificationResult> {
  const syntaxOk = checkSyntax(email);

  if (!syntaxOk) {
    return { email, syntax_ok: false, domain_ok: false, smtp_ok: false, score: 0, fail_reason: 'Invalid email syntax' };
  }

  const domainOk = await checkDomain(email);
  if (!domainOk) {
    return { email, syntax_ok: true, domain_ok: false, smtp_ok: false, score: 10, fail_reason: 'Domain has no mail records' };
  }

  const smtpResult = await checkSmtp(email);
  const score = calculateDcs(syntaxOk, domainOk, smtpResult.ok);

  return {
    email,
    syntax_ok: syntaxOk,
    domain_ok: domainOk,
    smtp_ok: smtpResult.ok,
    score,
    fail_reason: smtpResult.ok ? null : (smtpResult.reason || 'SMTP check failed'),
  };
}

/**
 * Verify a contact and store DCS results.
 */
export async function verifyContact(contactId: string, userId: string): Promise<DcsVerificationResult> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('email, user_id')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact) throw new Error('Contact not found');

  const result = await verifyEmail(contact.email);

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update({
      dcs_score: result.score,
      dcs_syntax_ok: result.syntax_ok,
      dcs_domain_ok: result.domain_ok,
      dcs_smtp_ok: result.smtp_ok,
      dcs_verified_at: new Date().toISOString(),
      dcs_fail_reason: result.fail_reason,
    })
    .eq('id', contactId);
  if (updateErr) throw new Error(`Failed to save verification result: ${updateErr.message}`);

  if (contact.user_id) {
    fireEvent(contact.user_id, 'contact.verified', {
      contact_id: contactId,
      email: contact.email,
      dcs_score: result.score,
      syntax_ok: result.syntax_ok,
      domain_ok: result.domain_ok,
      smtp_ok: result.smtp_ok,
    }).catch(() => {});
  }

  return result;
}

/**
 * Batch verify contacts for a user. Returns count of verified contacts.
 */
export async function batchVerify(
  userId: string,
  contactIds?: string[]
): Promise<{ verified: number; failed: number }> {
  let query = supabaseAdmin
    .from('contacts')
    .select('id, email')
    .eq('user_id', userId)
    .is('dcs_verified_at', null);

  if (contactIds && contactIds.length > 0) {
    query = query.in('id', contactIds);
  }

  const { data: contacts } = await query.limit(100);
  if (!contacts || contacts.length === 0) return { verified: 0, failed: 0 };

  let verified = 0;
  let failed = 0;

  for (const contact of contacts) {
    const result = await verifyEmail(contact.email);

    const { error: batchUpdateErr } = await supabaseAdmin
      .from('contacts')
      .update({
        dcs_score: result.score,
        dcs_syntax_ok: result.syntax_ok,
        dcs_domain_ok: result.domain_ok,
        dcs_smtp_ok: result.smtp_ok,
        dcs_verified_at: new Date().toISOString(),
        dcs_fail_reason: result.fail_reason,
      })
      .eq('id', contact.id);

    if (batchUpdateErr) {
      console.error(`[Verification] Failed to save result for contact ${contact.id}:`, batchUpdateErr.message);
      failed++;
      continue;
    }

    if (result.score >= 60) verified++;
    else failed++;
  }

  return { verified, failed };
}

/**
 * Background auto-verification: drain a small, throttled batch of unverified
 * contacts belonging to users who opted in (user_settings.auto_verify_contacts).
 * Keeps the verification status column populated — including freshly imported
 * contacts — without hammering remote mail servers. Returns count processed.
 */
export async function autoVerifyPending(maxContacts = 10): Promise<number> {
  const { data: optedIn } = await supabaseAdmin
    .from('user_settings')
    .select('user_id')
    .eq('auto_verify_contacts', true);

  const userIds = (optedIn || []).map((r: any) => r.user_id).filter(Boolean);
  if (userIds.length === 0) return 0;

  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, email')
    .is('dcs_verified_at', null)
    .in('user_id', userIds)
    .limit(maxContacts);

  if (!contacts || contacts.length === 0) return 0;

  let processed = 0;
  for (const contact of contacts) {
    // verifyEmail handles its own errors and always resolves to a result,
    // so dcs_verified_at always gets stamped — no infinite retry loop.
    const result = await verifyEmail(contact.email);
    await supabaseAdmin
      .from('contacts')
      .update({
        dcs_score: result.score,
        dcs_syntax_ok: result.syntax_ok,
        dcs_domain_ok: result.domain_ok,
        dcs_smtp_ok: result.smtp_ok,
        dcs_verified_at: new Date().toISOString(),
        dcs_fail_reason: result.fail_reason,
      })
      .eq('id', contact.id);
    processed++;
  }
  return processed;
}

/**
 * Get DCS stats for a user's contacts.
 */
export async function getDcsStats(userId: string): Promise<{
  total: number;
  verified: number;
  unverified: number;
  avg_score: number;
  score_distribution: { range: string; count: number }[];
}> {
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('dcs_score, dcs_verified_at')
    .eq('user_id', userId);

  const all = contacts || [];
  const verified = all.filter(c => c.dcs_verified_at !== null);
  const scores = verified.map(c => c.dcs_score || 0);
  const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const distribution = [
    { range: '90-100', count: scores.filter(s => s >= 90).length },
    { range: '70-89', count: scores.filter(s => s >= 70 && s < 90).length },
    { range: '50-69', count: scores.filter(s => s >= 50 && s < 70).length },
    { range: '0-49', count: scores.filter(s => s < 50).length },
  ];

  return {
    total: all.length,
    verified: verified.length,
    unverified: all.length - verified.length,
    avg_score: avg,
    score_distribution: distribution,
  };
}

/**
 * Get suppressed contacts for a campaign based on DCS threshold.
 */
export async function getSuppressedContacts(
  campaignId: string,
  threshold: number,
  userId: string
): Promise<{ contact_id: string; email: string; dcs_score: number }[]> {
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!campaign) throw new Error('Campaign not found');

  const { data } = await supabaseAdmin
    .from('campaign_contacts')
    .select('contact_id, contacts(email, dcs_score)')
    .eq('campaign_id', campaignId)
    .not('contacts.dcs_score', 'is', null)
    .lt('contacts.dcs_score', threshold);

  return (data || []).map((row: any) => ({
    contact_id: row.contact_id,
    email: row.contacts?.email || '',
    dcs_score: row.contacts?.dcs_score || 0,
  }));
}
