import { supabaseAdmin } from '../config/supabase.js';
import net from 'net';
import type { DcsVerificationResult } from '@lemlist/shared';
import { fireEvent } from './webhook.service.js';
import {
  noteSmtpOutcome,
  outboundSmtpStatus,
  shouldSkipSmtpProbe,
  smtpBlockedMessage,
} from './smtp-reachability.service.js';
import { resolveDoh, resolveHostIp } from '../utils/dns-doh.js';

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

// Resolves via DoH (Cloudflare → Google → OS resolver), same as domain.service.ts
// and smtp.service.ts — classic UDP/TCP port-53 DNS is blocked on the deployed
// host, so a plain dns.promises.resolveMx() here would fail every lookup and
// score every contact as having no mail records regardless of validity.
async function checkDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  const mxRecords = await resolveDoh(domain, 'MX');
  if (mxRecords.length > 0) return true;

  // MX failed — fall back to A record
  const aRecords = await resolveDoh(domain, 'A');
  return aRecords.length > 0;
}

// ============================================
// Layer 3: SMTP Handshake Simulation
// ============================================
/**
 * Ask the domain's mail server whether it will accept this recipient.
 *
 * Returns `checked` separately from `ok`, and the distinction matters more than
 * either field on its own:
 *
 * - `checked: true` means a mail server gave a verdict, so `ok` is evidence.
 * - `checked: false` means nothing was established. `ok` stays true so an
 *   unreachable server doesn't mark every address as bad, but the score must not
 *   credit a check that never ran — which is exactly what it used to do, giving
 *   every address with an MX record 100/100 on any host with port 25 blocked.
 */
async function checkSmtp(
  email: string
): Promise<{ ok: boolean; checked: boolean; reason?: string }> {
  const domain = email.split('@')[1];
  if (!domain) return { ok: false, checked: true, reason: 'Invalid domain' };

  // Already established that this host can't reach port 25: answer at once
  // rather than stalling for the connect timeout on every single address.
  if (shouldSkipSmtpProbe()) {
    return { ok: true, checked: false, reason: smtpBlockedMessage() };
  }

  const mxAnswers = await resolveDoh(domain, 'MX');
  const sorted = mxAnswers
    .map((d) => {
      const m = d.trim().match(/^(\d+)\s+(\S+)$/);
      return m ? { priority: Number(m[1]), exchange: m[2].replace(/\.$/, '') } : null;
    })
    .filter((r): r is { priority: number; exchange: string } => r !== null)
    .sort((a, b) => a.priority - b.priority);

  if (sorted.length === 0) {
    return { ok: false, checked: true, reason: 'No MX records' };
  }

  const mxHost = sorted[0].exchange;
  // Dial by resolved IP — net.Socket.connect(port, hostname) does its own DNS
  // lookup via the OS resolver, which is the exact resolver DoH exists to avoid.
  const mxIp = await resolveHostIp(mxHost);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let lineBuf = '';
    let step = 0;

    const timeout = setTimeout(() => {
      socket.destroy();
      // A slow server is not a bad address, but it is not a checked one either:
      // no verdict arrived, so nothing may be credited to the SMTP layer.
      noteSmtpOutcome(step > 0, 'Mail server did not answer in time');
      resolve({ ok: true, checked: false, reason: 'Mail server did not answer in time' });
    }, 10000);

    socket.connect(25, mxIp || mxHost, () => {
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
            noteSmtpOutcome(true);
            resolve({ ok: false, checked: true, reason: `Bad greeting: ${code}` });
          }
        } else if (step === 1) {
          // EHLO response
          if (code === 250) {
            socket.write(`MAIL FROM:<verify@usesincerely.com>\r\n`);
            step = 2;
          } else {
            clearTimeout(timeout);
            socket.destroy();
            noteSmtpOutcome(true);
            resolve({ ok: false, checked: true, reason: `EHLO rejected: ${code}` });
          }
        } else if (step === 2) {
          // MAIL FROM response
          if (code === 250) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else {
            clearTimeout(timeout);
            socket.destroy();
            noteSmtpOutcome(true);
            resolve({ ok: false, checked: true, reason: `MAIL FROM rejected: ${code}` });
          }
        } else if (step === 3) {
          // RCPT TO response - this is the key check
          clearTimeout(timeout);
          socket.write('QUIT\r\n');
          socket.destroy();

          noteSmtpOutcome(true);

          if (code === 250 || code === 251) {
            resolve({ ok: true, checked: true });
          } else if (code === 550 || code === 551 || code === 553) {
            resolve({ ok: false, checked: true, reason: `Mailbox does not exist (${code})` });
          } else if (code === 452 || code === 552) {
            resolve({ ok: true, checked: true, reason: 'Mailbox full but exists' });
          } else {
            // Greylisting or a server that won't say. Not a bad address, but no
            // verdict either — scoring it as a pass is how a guess becomes a
            // "verified" address.
            resolve({ ok: true, checked: false, reason: `Mail server would not confirm (${code})` });
          }
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      // Could not get a conversation started at all. On a host with outbound
      // port 25 blocked this is every address, which is why it is recorded: a
      // few of these in a row and the probe stops being attempted.
      noteSmtpOutcome(false, err.message);
      resolve({ ok: true, checked: false, reason: 'Could not reach the mail server' });
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
  smtpChecked: boolean,
  historicalBounceRate?: number
): number {
  if (!syntaxOk) return 0;
  if (!domainOk) return 10;

  let score = 0;
  score += 30; // Syntax
  score += 30; // Domain (MX or A records exist)

  /*
   * The SMTP layer only scores when a mail server actually gave a verdict.
   *
   * This used to award the full 30 whenever `smtpOk` was true — and `smtpOk` was
   * set to true on a connection error, a timeout, and any ambiguous reply. On a
   * host with outbound port 25 blocked, which is most managed hosts, that meant
   * every address with an MX record scored 100/100 and the whole score meant
   * nothing. An unrun check now scores nothing and caps the total at 60, which
   * is what "syntax and domain look right, deliverability unknown" is worth.
   */
  if (smtpChecked && smtpOk) {
    score += 30;
    score += 10; // All three layers genuinely passed
  }

  if (historicalBounceRate !== undefined && historicalBounceRate > 0) {
    score -= Math.round(historicalBounceRate * 20);
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================
// Public API
// ============================================

/**
 * Verify a single email address through the triple-layer pipeline.
 */
export async function verifyEmail(email: string, historicalBounceRate = 0): Promise<DcsVerificationResult> {
  const syntaxOk = checkSyntax(email);

  if (!syntaxOk) {
    return { email, syntax_ok: false, domain_ok: false, smtp_ok: false, smtp_checked: false, score: 0, fail_reason: 'Invalid email syntax' };
  }

  const domainOk = await checkDomain(email);
  if (!domainOk) {
    return { email, syntax_ok: true, domain_ok: false, smtp_ok: false, smtp_checked: true, score: 10, fail_reason: 'Domain has no mail records' };
  }

  const smtpResult = await checkSmtp(email);
  const score = calculateDcs(syntaxOk, domainOk, smtpResult.ok, smtpResult.checked, historicalBounceRate);

  return {
    email,
    syntax_ok: syntaxOk,
    domain_ok: domainOk,
    smtp_ok: smtpResult.ok,
    smtp_checked: smtpResult.checked,
    score,
    // Carried even when the address isn't bad: "could not be checked" is the
    // most useful thing to say about a 60, and the UI needs to be able to say it.
    fail_reason: smtpResult.ok && smtpResult.checked ? null : (smtpResult.reason || 'SMTP check failed'),
  };
}

/**
 * Verify a contact and store DCS results.
 */
export async function verifyContact(contactId: string, userId: string): Promise<DcsVerificationResult> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('email, user_id, is_bounced')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact) throw new Error('Contact not found');

  const result = await verifyEmail(contact.email, contact.is_bounced ? 1 : 0);

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
    .select('id, email, is_bounced')
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
    const result = await verifyEmail(contact.email, contact.is_bounced ? 1 : 0);

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
    .select('id, email, is_bounced')
    .is('dcs_verified_at', null)
    .in('user_id', userIds)
    .limit(maxContacts);

  if (!contacts || contacts.length === 0) return 0;

  let processed = 0;
  for (const contact of contacts) {
    // verifyEmail handles its own errors and always resolves to a result,
    // so dcs_verified_at always gets stamped — no infinite retry loop.
    const result = await verifyEmail(contact.email, contact.is_bounced ? 1 : 0);
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
  /**
   * Whether this server can check mailboxes at all. Reported so the app can say
   * so, rather than leaving an operator to wonder why every score is 60 — or
   * worse, to trust scores recorded when a blocked port counted as a pass.
   */
  smtp: {
    available: boolean | null;
    consecutive_failures: number;
    last_reason: string;
    retry_after_seconds: number | null;
  };
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
    smtp: outboundSmtpStatus(),
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
    .select('contact_id, contacts!inner(email, dcs_score)')
    .eq('campaign_id', campaignId)
    .not('contacts.dcs_score', 'is', null)
    .lt('contacts.dcs_score', threshold);

  return (data || []).map((row: any) => ({
    contact_id: row.contact_id,
    email: row.contacts?.email || '',
    dcs_score: row.contacts?.dcs_score || 0,
  }));
}
