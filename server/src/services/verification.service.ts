import { supabaseAdmin } from '../config/supabase.js';
import net from 'net';
import { AppError } from '../middleware/error.middleware.js';
import type { DcsVerificationResult } from '@lemlist/shared';
import { CREDIT_PRICES } from '@lemlist/shared';
import { fireEvent } from './webhook.service.js';
import {
  noteSmtpOutcome,
  outboundSmtpStatus,
  releaseSmtpProbeSlot,
  shouldSkipSmtpProbe,
  smtpBlockedMessage,
} from './smtp-reachability.service.js';
import { resolveDoh, resolveHostIp } from '../utils/dns-doh.js';
import { chunk, fetchAllPages } from '../utils/batch.js';
import { env } from '../config/env.js';
import { connectViaSocks5, parseSocks5Url } from '../utils/socks5.js';
import { icypeas, icypeasAwait } from './prospect-providers.js';
import { creditsService, OutOfCreditsError } from './credits.service.js';
import { withUsage } from './provider-usage.service.js';

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

/*
 * How the check reaches mail servers, following the advice of people who run
 * verification at scale (Reacher's SMTP proxy guide among them):
 *
 *   - Through a SOCKS5 proxy when VERIFY_SMTP_PROXY is set. Render blocks
 *     outbound port 25, and the big mailbox providers judge the caller's IP,
 *     so a proxy on clean IPs is how this check gets a verdict at all. SMTP
 *     cannot go through an HTTP proxy.
 *   - Introducing itself (EHLO) and sending from (MAIL FROM) a domain that
 *     matches those IPs: VERIFY_HELO_NAME and VERIFY_FROM_EMAIL. Ask the
 *     proxy provider which to use. A mismatch is a reason to be refused.
 *   - A refusal aimed at us (our IP's reputation, a blocklist, a rate limit)
 *     says nothing about the address, so it never marks one as bad.
 *   - A domain that accepts any address (catch-all) cannot confirm one, so
 *     a "yes" from it is not counted as checked.
 *   - At most a couple of checks at a time against any one domain, so a list
 *     full of gmail.com does not hammer Gmail from one IP.
 */
const verifyProxy = parseSocks5Url(env.VERIFY_SMTP_PROXY);
const HELO_NAME = env.VERIFY_HELO_NAME || 'usesincerely.com';
const FROM_EMAIL = env.VERIFY_FROM_EMAIL || `verify@${HELO_NAME}`;
const SMTP_TIMEOUT_MS = 10_000;

export interface SmtpVerdict {
  ok: boolean;
  checked: boolean;
  reason?: string;
  /** A mail server answered at all: the route works, whatever it said. */
  reachable: boolean;
  catch_all?: boolean;
}

/* Wording that says a refusal is about the caller, not the mailbox. */
const AIMED_AT_US = /spamhaus|barracuda|spamcop|block ?list|black ?list|blocked|\brbl\b|dnsbl|reputation|policy|5\.7\.\d|not (?:allowed|permitted|authori[sz]ed)|access denied|denied|banned|abuse|too many|rate ?limit|try again later|client host|ptr|reverse dns|helo/i;
/* Wording that says the mailbox itself does not exist. */
const NO_SUCH_MAILBOX = /5\.1\.(?:0|1|10)\b|user unknown|unknown user|no such (?:user|mailbox|recipient)|does not exist|doesn'?t exist|mailbox (?:unavailable|not found)|recipient (?:address )?rejected|invalid (?:recipient|mailbox|address)|address rejected|not a valid|unknown recipient|recipient not found|no mailbox/i;

/** What a reply to RCPT TO says about the address. Exported for the checks. */
export function classifyRcpt(code: number, text: string): Omit<SmtpVerdict, 'reachable'> {
  if (code === 250 || code === 251) return { ok: true, checked: true };
  if (code === 452 || code === 552) {
    // "Mailbox full" exists; "too many recipients" (also 452) is about us.
    return AIMED_AT_US.test(text) && !/full|quota|storage/i.test(text)
      ? { ok: true, checked: false, reason: `The mail server is limiting checks (${code})` }
      : { ok: true, checked: true, reason: 'Mailbox full but exists' };
  }
  if (code >= 500 && code < 600) {
    if (NO_SUCH_MAILBOX.test(text)) return { ok: false, checked: true, reason: `Mailbox does not exist (${code})` };
    if (AIMED_AT_US.test(text)) return { ok: true, checked: false, reason: `The mail server refused our check, not the address (${code})` };
    if (code === 550 || code === 551 || code === 553) return { ok: false, checked: true, reason: `Mailbox does not exist (${code})` };
    return { ok: true, checked: false, reason: `Mail server would not confirm (${code})` };
  }
  // Greylisting, rate limits, a server that won't say: no verdict.
  return { ok: true, checked: false, reason: `Mail server would not confirm (${code})` };
}

/** An address at the same domain that nobody has, to tell a catch-all apart. */
const unlikelyAddress = (domain: string) => `sincerely-check-${Math.random().toString(36).slice(2, 12)}@${domain}`;

/**
 * One SMTP conversation on an open socket: greeting, EHLO, MAIL FROM, RCPT TO
 * for the address, then RCPT TO for an address nobody has. Never sends DATA,
 * so no message is ever sent.
 */
export function smtpConversation(socket: net.Socket, email: string, opts: { helo?: string; from?: string; timeoutMs?: number } = {}): Promise<SmtpVerdict> {
  const helo = opts.helo || HELO_NAME;
  const from = opts.from || FROM_EMAIL;
  const domain = email.split('@')[1] || '';
  return new Promise((resolve) => {
    let lineBuf = '';
    let text = '';
    let step: 'greeting' | 'ehlo' | 'helo' | 'mail' | 'rcpt' | 'probe' = 'greeting';
    let real: Omit<SmtpVerdict, 'reachable'> | null = null;
    let done = false;
    let answered = false;

    const finish = (v: SmtpVerdict) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.write('QUIT\r\n'); } catch { /* already closed */ }
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => {
      // A slow server is not a bad address, nor a checked one. If the real
      // address already got a yes, only the catch-all probe went quiet.
      if (real) finish({ ...real, reachable: true });
      else finish({ ok: true, checked: false, reachable: answered, reason: 'Mail server did not answer in time' });
    }, opts.timeoutMs ?? SMTP_TIMEOUT_MS);

    socket.on('error', (err) => {
      if (real) return finish({ ...real, reachable: true });
      finish({ ok: true, checked: false, reachable: answered, reason: answered ? 'The mail server hung up' : `Could not reach the mail server (${err.message})` });
    });
    socket.on('close', () => {
      if (done) return;
      if (real) return finish({ ...real, reachable: true });
      finish({ ok: true, checked: false, reachable: answered, reason: answered ? 'The mail server hung up' : 'Could not reach the mail server' });
    });

    // A proxied socket arrives paused (see socks5.ts): listen, then resume.
    queueMicrotask(() => socket.resume());
    socket.on('data', (data) => {
      lineBuf += data.toString();
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (done) return;
        if (line.length < 3) continue;
        text += ` ${line.slice(4)}`;
        if (line[3] === '-') continue; // multi-line reply continues
        answered = true;
        const code = parseInt(line.substring(0, 3), 10);
        const said = text.trim();
        text = '';

        if (step === 'greeting') {
          // A refused greeting (554, 421) is about the caller: our IP, a rate
          // limit, a blocklist. It is never evidence against the address.
          if (code !== 220) return finish({ ok: true, checked: false, reachable: true, reason: `The mail server refused our connection (${code})` });
          socket.write(`EHLO ${helo}\r\n`);
          step = 'ehlo';
        } else if (step === 'ehlo' || step === 'helo') {
          if (code === 250) {
            socket.write(`MAIL FROM:<${from}>\r\n`);
            step = 'mail';
          } else if (step === 'ehlo' && code >= 500) {
            // An old server that only speaks HELO.
            socket.write(`HELO ${helo}\r\n`);
            step = 'helo';
          } else {
            return finish({ ok: true, checked: false, reachable: true, reason: `The mail server refused our greeting (${code})` });
          }
        } else if (step === 'mail') {
          if (code !== 250) return finish({ ok: true, checked: false, reachable: true, reason: `The mail server refused our sender (${code})` });
          socket.write(`RCPT TO:<${email}>\r\n`);
          step = 'rcpt';
        } else if (step === 'rcpt') {
          real = classifyRcpt(code, said);
          // Only a yes needs the catch-all test; a no or a shrug is final.
          if (!(real.ok && real.checked) || !domain) return finish({ ...real, reachable: true });
          socket.write(`RCPT TO:<${unlikelyAddress(domain)}>\r\n`);
          step = 'probe';
        } else if (step === 'probe') {
          if (code === 250 || code === 251) {
            return finish({ ok: true, checked: false, reachable: true, catch_all: true, reason: 'The domain accepts every address (catch-all), so this one cannot be confirmed' });
          }
          return finish({ ...real!, reachable: true, catch_all: false });
        }
      }
    });
  });
}

/* At most this many checks at once against one domain. */
const PER_DOMAIN = 2;
const inFlight = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

async function withDomainSlot<T>(domain: string, run: () => Promise<T>): Promise<T> {
  if ((inFlight.get(domain) || 0) >= PER_DOMAIN) {
    await new Promise<void>((r) => waiting.set(domain, [...(waiting.get(domain) || []), r]));
  }
  inFlight.set(domain, (inFlight.get(domain) || 0) + 1);
  try {
    return await run();
  } finally {
    const left = (inFlight.get(domain) || 1) - 1;
    if (left) inFlight.set(domain, left); else inFlight.delete(domain);
    const queue = waiting.get(domain);
    const next = queue?.shift();
    if (queue && !queue.length) waiting.delete(domain);
    next?.();
  }
}

/** Open a connection to a mail server, through the proxy when one is set. */
async function openSmtp(host: string, ip: string | null, port = 25): Promise<net.Socket> {
  if (verifyProxy) return connectViaSocks5(verifyProxy, ip || host, port, SMTP_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    // Dial by resolved IP: net.connect(port, hostname) does its own DNS
    // lookup via the OS resolver, which is the exact resolver DoH avoids.
    const socket = net.connect(port, ip || host);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('connect timed out')); }, SMTP_TIMEOUT_MS);
    socket.once('connect', () => { clearTimeout(timer); socket.removeAllListeners('error'); resolve(socket); });
    socket.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const PROXY_BLOCKED = 'Mail servers cannot be reached through the SMTP proxy. Check its address and login, and that it allows port 25.';
const blockedReason = () => (verifyProxy ? PROXY_BLOCKED : smtpBlockedMessage());

/** How this server reaches mail servers, for the verification page. */
export function smtpRoute(): { via: 'proxy' | 'direct'; helo: string; from: string } {
  return { via: verifyProxy ? 'proxy' : 'direct', helo: HELO_NAME, from: FROM_EMAIL };
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
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return { ok: false, checked: true, reason: 'Invalid domain' };

  // Already established that this host can't reach port 25: answer at once
  // rather than stalling for the connect timeout on every single address.
  if (shouldSkipSmtpProbe()) {
    return { ok: true, checked: false, reason: blockedReason() };
  }

  const mxAnswers = await resolveDoh(domain, 'MX');
  const sorted = mxAnswers
    .map((d) => {
      const m = d.trim().match(/^(\d+)\s+(\S+)$/);
      return m ? { priority: Number(m[1]), exchange: m[2].replace(/\.$/, '') } : null;
    })
    .filter((r): r is { priority: number; exchange: string } => r !== null && r.exchange !== '')
    .sort((a, b) => a.priority - b.priority);

  if (sorted.length === 0) {
    // Bailing out before a socket was ever opened: this says nothing about
    // port 25 reachability, so release the retest slot without recording an
    // outcome. Otherwise, whenever this early return is the allowed one
    // retest after a cooldown, `probing` never gets cleared and every future
    // verification silently skips its real SMTP check forever.
    releaseSmtpProbeSlot();
    return { ok: false, checked: true, reason: 'No MX records' };
  }

  return withDomainSlot(domain, async () => {
    let last: SmtpVerdict = { ok: true, checked: false, reachable: false, reason: 'Could not reach the mail server' };
    // The main server, then one backup when the main one can't be reached.
    for (const mx of sorted.slice(0, 2)) {
      const ip = verifyProxy ? null : await resolveHostIp(mx.exchange);
      let socket: net.Socket;
      try {
        socket = await openSmtp(mx.exchange, ip);
      } catch (err: any) {
        last = { ok: true, checked: false, reachable: false, reason: `Could not reach the mail server (${err?.message || 'error'})` };
        continue;
      }
      last = await smtpConversation(socket, email);
      if (last.reachable) break;
    }
    // On a host with outbound port 25 blocked every connect fails, which is
    // why it is recorded: a few in a row and the probe stops being attempted.
    noteSmtpOutcome(last.reachable, last.reason);
    return { ok: last.ok, checked: last.checked, reason: last.reason };
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
    return { email, syntax_ok: false, domain_ok: false, smtp_ok: false, smtp_checked: false, score: 0, fail_reason: 'Invalid email syntax', verified_by: 'dns' };
  }

  const domainOk = await checkDomain(email);
  if (!domainOk) {
    return { email, syntax_ok: true, domain_ok: false, smtp_ok: false, smtp_checked: true, score: 10, fail_reason: 'Domain has no mail records', verified_by: 'dns' };
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
    verified_by: smtpResult.checked ? 'mail_server' : 'dns',
  };
}

/* ============================================
   Mailbox check through Icypeas
   ============================================

   Our own SMTP probe needs outbound port 25, which Render and most hosts
   block, so in production it almost never gets a verdict and every address
   sat at 60 "could not be checked". When an ICYPEAS_API_KEY is set, an
   address the free checks could not settle goes to Icypeas's email
   verification instead (0.1 Icypeas credit an address).

   Only verifications somebody asked for use it: the Verify buttons on the
   lead and contact lists, and Enrich. The background auto-verify and the
   Prospector's standing searches stay on the free checks, so nothing spends
   credits on its own.

   Icypeas does not publish the shape of a finished verification, so the
   certainty is read from wherever it turns up.
*/

/** Certainty from a finished Icypeas verification item, lower-cased, or null. */
export function icypeasCertaintyFrom(item: any): string | null {
  const seen = new Set<any>();
  const walk = (v: any, depth: number): string | null => {
    if (!v || typeof v !== 'object' || depth > 4 || seen.has(v)) return null;
    seen.add(v);
    if (typeof v.certainty === 'string' && v.certainty.trim()) return v.certainty.trim().toLowerCase();
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      const hit = walk(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(item, 0);
}

/** An Icypeas certainty as our result: the same fields the free checks fill. */
export function resultFromCertainty(base: DcsVerificationResult, certainty: string | null, status: string): DcsVerificationResult {
  const c = certainty || (['FOUND', 'DEBITED'].includes(status) ? 'probable' : 'not_found');
  if (c === 'ultra_sure' || c === 'very_sure') {
    return { ...base, smtp_ok: true, smtp_checked: true, score: 100, fail_reason: null, verified_by: 'icypeas' };
  }
  if (c === 'probable') {
    return { ...base, smtp_ok: true, smtp_checked: true, score: 85, fail_reason: 'Probably deliverable: under 5% bounce risk', verified_by: 'icypeas' };
  }
  if (c === 'undeliverable') {
    return { ...base, smtp_ok: false, smtp_checked: true, score: 5, fail_reason: 'Mailbox does not exist', verified_by: 'icypeas' };
  }
  // not_found, or anything new: Icypeas could not tell either way.
  return {
    ...base, smtp_ok: true, smtp_checked: false, score: 55,
    fail_reason: 'Could not be confirmed: the mail server accepts every address or will not say',
    verified_by: 'icypeas',
  };
}

async function icypeasVerify(base: DcsVerificationResult): Promise<DcsVerificationResult> {
  const started = await icypeas('/email-verification', { email: base.email });
  const searchId = started?.item?._id || started?._id;
  if (!searchId) throw new Error('Icypeas did not return a verification id');
  const item = await icypeasAwait(String(searchId), 'email-verification');
  return resultFromCertainty(base, icypeasCertaintyFrom(item), String(item?.status || '').toUpperCase());
}

/**
 * The free checks, then Icypeas when they could not reach a verdict. A
 * failed Icypeas call falls back to the free result rather than failing the
 * verification: an address is never marked bad because a vendor was down.
 */
export async function verifyEmailDeep(
  email: string,
  historicalBounceRate = 0,
  opts: { chargeUserId?: string } = {},
): Promise<DcsVerificationResult> {
  const base = await verifyEmail(email, historicalBounceRate);
  if (!base.syntax_ok || !base.domain_ok || base.smtp_checked || !env.ICYPEAS_API_KEY) return base;

  /*
   * The paid check costs CREDIT_PRICES.verify. Out of credits keeps the free
   * result and says so, rather than failing the verification; a failed
   * Icypeas call gives the credit back.
   */
  const userId = opts.chargeUserId;
  const spend = { amount: CREDIT_PRICES.verify, action: 'verify', provider: 'icypeas', ref: email };
  let bucket: string | null = null;
  if (userId) {
    try {
      bucket = await creditsService.spend(userId, spend);
    } catch (err) {
      if (err instanceof OutOfCreditsError) return { ...base, deep_skipped: 'no_credits' };
      throw err;
    }
  }
  try {
    const deep = userId ? await withUsage(userId, 'verify', () => icypeasVerify(base)) : await icypeasVerify(base);
    // A known bounce still counts against an address Icypeas thinks is fine.
    if (historicalBounceRate > 0) deep.score = Math.max(0, deep.score - Math.round(historicalBounceRate * 20));
    return deep;
  } catch (err) {
    console.warn('[Verification] Icypeas check failed, keeping the free result:', (err as Error).message);
    if (userId && bucket) await creditsService.refund(userId, { ...spend, reason: 'provider_error', bucket });
    return base;
  }
}

/**
 * The columns a result is stored in. `dcs_smtp_ok` is only true or false
 * when a mail server actually answered: it used to be written true for a
 * check that never ran, and the lead list read that as "Valid".
 */
function resultColumns(result: DcsVerificationResult) {
  return {
    dcs_score: result.score,
    dcs_syntax_ok: result.syntax_ok,
    dcs_domain_ok: result.domain_ok,
    dcs_smtp_ok: result.smtp_checked ? result.smtp_ok : null,
    dcs_verified_at: new Date().toISOString(),
    dcs_fail_reason: result.fail_reason,
    email_verified_by: result.verified_by ?? null,
  };
}

/** Save a result; retried without email_verified_by while migration 099 is not run. */
async function saveResult(contactId: string, userId: string, result: DcsVerificationResult) {
  const columns = resultColumns(result);
  let { error } = await supabaseAdmin.from('contacts').update(columns).eq('id', contactId).eq('user_id', userId);
  if (error && /email_verified_by/.test(error.message)) {
    const { email_verified_by: _skip, ...rest } = columns;
    ({ error } = await supabaseAdmin.from('contacts').update(rest).eq('id', contactId).eq('user_id', userId));
  }
  return error;
}

/**
 * Verify a contact and store DCS results.
 */
export async function verifyContact(
  contactId: string,
  userId: string,
  // `charge: false` when the caller already paid for the check (Enrich).
  opts: { deep?: boolean; charge?: boolean } = {}
): Promise<DcsVerificationResult> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('email, user_id, is_bounced')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact) throw new AppError('Contact not found', 404);

  const result = opts.deep
    ? await verifyEmailDeep(contact.email, contact.is_bounced ? 1 : 0, opts.charge === false ? {} : { chargeUserId: userId })
    : await verifyEmail(contact.email, contact.is_bounced ? 1 : 0);

  const updateErr = await saveResult(contactId, userId, result);
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

const DEEP_BATCH = 25;
const DEEP_LANES = 5;

/**
 * Batch verify contacts for a user. Returns count of verified contacts.
 */
export async function batchVerify(
  userId: string,
  contactIds?: string[],
  opts: { deep?: boolean } = {}
): Promise<{ verified: number; failed: number; no_credits: number }> {
  // A paid check waits on Icypeas for a few seconds an address, so a deep
  // batch is smaller and runs a few at a time to stay inside one request.
  const max = opts.deep && env.ICYPEAS_API_KEY ? DEEP_BATCH : 100;
  let query = supabaseAdmin
    .from('contacts')
    .select('id, email, is_bounced')
    .eq('user_id', userId);

  if (contactIds && contactIds.length > 0) {
    // An explicit selection is verified regardless of prior status — the
    // caller picked these contacts on purpose, possibly to re-check ones
    // that already have a DCS score. Only the first hundred are taken per
    // call (see the limit below), so only those go into the URL.
    query = query.in('id', chunk(contactIds, max)[0]);
  } else {
    query = query.is('dcs_verified_at', null);
  }

  const { data: contacts, error: selectErr } = await query.limit(max);
  if (selectErr) throw new Error(`Failed to load contacts to verify: ${selectErr.message}`);
  if (!contacts || contacts.length === 0) return { verified: 0, failed: 0, no_credits: 0 };

  let verified = 0;
  let failed = 0;
  // Checked with the free checks only, because the account ran out of credits.
  let noCredits = 0;

  const check = (email: string, bounce: number) => (opts.deep ? verifyEmailDeep(email, bounce, { chargeUserId: userId }) : verifyEmail(email, bounce));
  const one = async (contact: { id: string; email: string; is_bounced: boolean }) => {
    const result = await check(contact.email, contact.is_bounced ? 1 : 0);
    if (result.deep_skipped === 'no_credits') noCredits++;
    const batchUpdateErr = await saveResult(contact.id, userId, result);
    if (batchUpdateErr) {
      console.error(`[Verification] Failed to save result for contact ${contact.id}:`, batchUpdateErr.message);
      failed++;
      return;
    }
    if (result.score >= 60) verified++;
    else failed++;
  };
  const lanes = opts.deep ? DEEP_LANES : 1;
  for (const group of chunk(contacts as any[], lanes)) await Promise.all(group.map(one));

  return { verified, failed, no_credits: noCredits };
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
    .select('id, user_id, email, is_bounced')
    .is('dcs_verified_at', null)
    .in('user_id', userIds)
    .limit(maxContacts);

  if (!contacts || contacts.length === 0) return 0;

  let processed = 0;
  for (const contact of contacts) {
    // verifyEmail handles its own errors and always resolves to a result,
    // so dcs_verified_at always gets stamped — no infinite retry loop.
    const result = await verifyEmail(contact.email, contact.is_bounced ? 1 : 0);
    await saveResult(contact.id, (contact as any).user_id, result);
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
    /** Straight out on port 25, or through the SMTP proxy. */
    via: 'proxy' | 'direct';
  };
}> {
  // Paged: an unpaged select stops at 1,000 rows, so on any real account
  // every number on the verification page described the first thousand.
  const all = await fetchAllPages<{ dcs_score: number | null; dcs_verified_at: string | null }>((from, to) =>
    supabaseAdmin
      .from('contacts')
      .select('dcs_score, dcs_verified_at')
      .eq('user_id', userId)
      .order('id')
      .range(from, to));
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
    smtp: (() => {
      const status = outboundSmtpStatus();
      return { ...status, last_reason: status.available === false ? blockedReason() : status.last_reason, via: smtpRoute().via };
    })(),
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
  if (!campaign) throw new AppError('Campaign not found', 404);

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
