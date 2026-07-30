import dns from 'dns';
import net from 'net';
import { supabaseAdmin } from '../config/supabase.js';
import {
  noteSmtpOutcome,
  shouldSkipSmtpProbe,
  smtpBlockedMessage,
} from './smtp-reachability.service.js';
import type {
  EmailCandidate,
  EmailPatternId,
  FindEmailInput,
  FindEmailResult,
} from '@lemlist/shared';

/**
 * Work out the address for a person at a domain, when nothing published it.
 *
 * Three sources of truth, in descending order of how much they're worth:
 *
 *  1. The account's own contacts at that domain. If jane.doe@acme.com is
 *     already on file and her name is Jane Doe, the convention is `first.last`
 *     and every other guess at acme.com follows from it. This is free, instant,
 *     and better than any heuristic.
 *  2. The mail server. RCPT TO on a candidate is the only way to *prove* a
 *     mailbox exists. Done strictly here, unlike verification.service, which
 *     deliberately assumes valid on ambiguity — fine when checking an address a
 *     human supplied, useless when sifting a dozen guesses, because everything
 *     would come back valid.
 *  3. Which conventions are common. A last resort, and reported as a guess.
 *
 * Two things routinely make step 2 impossible, and both are reported rather
 * than papered over: a catch-all domain accepts every address (so acceptance
 * proves nothing), and many hosts — Render and most PaaS included — block
 * outbound port 25 entirely.
 */

/* ------------------------------------------------------------------ */
/* Candidate construction                                             */
/* ------------------------------------------------------------------ */

/**
 * Conventions in rough order of how often they're used, which is the fallback
 * ranking when the account has nothing to learn from.
 */
const PATTERN_ORDER: EmailPatternId[] = [
  'first.last',
  'first',
  'firstlast',
  'flast',
  'first_last',
  'f.last',
  'firstl',
  'last.first',
  'first-last',
  'lastfirst',
  'last',
  'lastf',
  'fl',
];

/**
 * Build the local part for one convention. Returns null when the pattern needs
 * a name part that wasn't supplied — a first-name-only person has no `flast`.
 *
 * @param pattern
 * @param first Lower-cased, stripped of anything but letters/digits.
 * @param last Same.
 */
export function localPart(pattern: EmailPatternId, first: string, last: string): string | null {
  const f = first.charAt(0);
  const l = last.charAt(0);
  const needsBoth = !first || !last;

  switch (pattern) {
    case 'first.last': return needsBoth ? null : `${first}.${last}`;
    case 'firstlast': return needsBoth ? null : `${first}${last}`;
    case 'first_last': return needsBoth ? null : `${first}_${last}`;
    case 'first-last': return needsBoth ? null : `${first}-${last}`;
    case 'flast': return needsBoth ? null : `${f}${last}`;
    case 'f.last': return needsBoth ? null : `${f}.${last}`;
    case 'firstl': return needsBoth ? null : `${first}${l}`;
    case 'last.first': return needsBoth ? null : `${last}.${first}`;
    case 'lastfirst': return needsBoth ? null : `${last}${first}`;
    case 'lastf': return needsBoth ? null : `${last}${f}`;
    case 'fl': return needsBoth ? null : `${f}${l}`;
    case 'first': return first || null;
    case 'last': return last || null;
    default: return null;
  }
}

/**
 * Strip a name down to what can appear in a local part: accents folded, spaces
 * and punctuation dropped. "Ana-María O'Brien" becomes "anamariaobrien", which
 * is what mailbox names actually look like.
 *
 * @param raw
 */
export function normaliseNamePart(raw: string | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    // Combining marks left behind by NFD: é becomes e + U+0301.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Split a full name into first and last. Middle names are dropped: they almost
 * never appear in a mailbox, and treating one as the surname produces addresses
 * that are confidently wrong.
 *
 * @param fullName
 */
export function splitFullName(fullName: string): { first: string; last: string } {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0 && !/^[A-Z]\.?$/.test(part));
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * Which convention produces `local` for this person, if any. Used to read a
 * pattern off addresses the account already holds.
 *
 * @param local Local part of a known address.
 * @param first
 * @param last
 */
export function patternOf(local: string, first: string, last: string): EmailPatternId | null {
  for (const pattern of PATTERN_ORDER) {
    const candidate = localPart(pattern, first, last);
    if (candidate && candidate === local) return pattern;
  }
  return null;
}

/**
 * The conventions this account's existing contacts reveal for a domain,
 * commonest first.
 *
 * Only contacts with both a first and last name can teach anything — without
 * them there's nothing to match the local part against.
 *
 * @param userId
 * @param domain
 */
async function knownPatternsForDomain(userId: string, domain: string): Promise<EmailPatternId[]> {
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('email, first_name, last_name')
    .eq('user_id', userId)
    .ilike('email', `%@${domain}`)
    .not('first_name', 'is', null)
    .not('last_name', 'is', null)
    .limit(50);

  if (error || !data) return [];

  const tally = new Map<EmailPatternId, number>();
  for (const row of data) {
    const local = String(row.email || '').split('@')[0]?.toLowerCase();
    const first = normaliseNamePart(row.first_name);
    const last = normaliseNamePart(row.last_name);
    if (!local || !first || !last) continue;
    const pattern = patternOf(local, first, last);
    if (pattern) tally.set(pattern, (tally.get(pattern) || 0) + 1);
  }

  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([pattern]) => pattern);
}

/** Cap on how many addresses one lookup will try, to keep an SMTP session civil. */
const MAX_CANDIDATES = 12;

/**
 * Ranked candidate addresses. Patterns the account has evidence for come first;
 * the rest follow in general-frequency order.
 *
 * @param first
 * @param last
 * @param domain
 * @param knownFirst Patterns confirmed from existing contacts at this domain.
 */
export function buildCandidates(
  first: string,
  last: string,
  domain: string,
  knownFirst: EmailPatternId[]
): EmailCandidate[] {
  const ordered = [...knownFirst, ...PATTERN_ORDER.filter((p) => !knownFirst.includes(p))];
  const seen = new Set<string>();
  const candidates: EmailCandidate[] = [];

  for (const pattern of ordered) {
    const local = localPart(pattern, first, last);
    if (!local) continue;
    const email = `${local}@${domain}`;
    if (seen.has(email)) continue;
    seen.add(email);
    candidates.push({ email, pattern, rank: candidates.length + 1, smtp: null });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return candidates;
}

/* ------------------------------------------------------------------ */
/* SMTP probing                                                       */
/* ------------------------------------------------------------------ */

const SMTP_PORT = 25;
const SMTP_CONNECT_TIMEOUT_MS = 8000;
const SMTP_SESSION_TIMEOUT_MS = 25000;
const PROBE_SENDER = 'verify@usesincerely.com';
const EHLO_HOST = 'usesincerely.com';

type RcptVerdict = 'accepted' | 'rejected' | 'inconclusive';

interface SmtpProbeResult {
  reachable: boolean;
  catchAll: boolean;
  /** Verdict per address asked about, in the order asked. */
  verdicts: Map<string, RcptVerdict>;
  reason: string;
}

/**
 * Classify an RCPT TO reply.
 *
 * Strict on purpose: only an explicit acceptance counts. A 4xx is the server
 * declining to say (greylisting, rate limiting), which for a guess means "no
 * information" — treating it as a pass is how a finder ends up returning an
 * address for every name it's given.
 *
 * @param code
 */
export function classifyRcpt(code: number): RcptVerdict {
  if (code === 250 || code === 251) return 'accepted';
  // 550/551/553 no such mailbox, 552 over quota (mailbox exists, but the
  // address is unusable for outreach), 501/513 malformed.
  if (code === 550 || code === 551 || code === 553 || code === 501 || code === 513) return 'rejected';
  if (code === 552 || code === 452) return 'accepted';
  return 'inconclusive';
}

/**
 * Ask one mail server about a list of addresses over a single session.
 *
 * A random local part goes first: a domain that accepts it accepts everything,
 * and every later answer is meaningless. Bailing out there also spares the
 * server eleven pointless RCPTs.
 *
 * @param mxHost
 * @param addresses Ranked; probing stops at the first acceptance.
 */
export function probeMailbox(mxHost: string, addresses: string[]): Promise<SmtpProbeResult> {
  // Already established that this host can't open port 25: say so at once
  // instead of stalling for the connect timeout on every name looked up.
  if (shouldSkipSmtpProbe()) {
    return Promise.resolve({
      reachable: false,
      catchAll: false,
      verdicts: new Map(),
      reason: smtpBlockedMessage(),
    });
  }

  return new Promise((resolve) => {
    const verdicts = new Map<string, RcptVerdict>();
    const domain = addresses[0]?.split('@')[1] || EHLO_HOST;
    // Long enough to be certainly unassigned, and obviously a probe to anyone
    // reading their logs rather than something that looks like an attack.
    const catchAllProbe = `sincerely-catch-all-probe-${Date.now().toString(36)}@${domain}`;
    const queue = [catchAllProbe, ...addresses];

    const socket = new net.Socket();
    let buffer = '';
    let stage: 'greeting' | 'ehlo' | 'mailfrom' | 'rcpt' = 'greeting';
    let index = -1;
    let settled = false;
    let catchAll = false;

    const finish = (reachable: boolean, reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(sessionTimer);
      try {
        if (!socket.destroyed) {
          socket.write('QUIT\r\n');
          socket.destroy();
        }
      } catch {
        // Already gone; nothing to clean up.
      }
      resolve({ reachable, catchAll, verdicts, reason });
    };

    const sessionTimer = setTimeout(
      () => finish(verdicts.size > 0, 'SMTP session timed out'),
      SMTP_SESSION_TIMEOUT_MS
    );

    /** Send the next RCPT, or finish when the queue is done. */
    const askNext = () => {
      index += 1;
      if (index >= queue.length) {
        finish(true, 'All candidates checked');
        return;
      }
      socket.write(`RCPT TO:<${queue[index]}>\r\n`);
    };

    socket.setTimeout(SMTP_CONNECT_TIMEOUT_MS);
    socket.on('timeout', () => finish(verdicts.size > 0, 'Mail server did not respond in time'));
    socket.on('error', (err) => {
      noteSmtpOutcome(false, err.message);
      finish(false, `Could not reach the mail server: ${err.message}`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.length < 4) continue;
        // Multi-line replies use '-' as the fourth character on every line but
        // the last; only the last carries the verdict.
        if (line[3] === '-') continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;

        if (stage === 'greeting') {
          // A greeting of any kind proves the port is open from here.
          noteSmtpOutcome(true);
          if (code !== 220) return finish(false, `Mail server refused the connection (${code})`);
          stage = 'ehlo';
          socket.write(`EHLO ${EHLO_HOST}\r\n`);
        } else if (stage === 'ehlo') {
          if (code !== 250) return finish(false, `Mail server rejected EHLO (${code})`);
          stage = 'mailfrom';
          socket.write(`MAIL FROM:<${PROBE_SENDER}>\r\n`);
        } else if (stage === 'mailfrom') {
          if (code !== 250) return finish(false, `Mail server rejected the sender (${code})`);
          stage = 'rcpt';
          askNext();
        } else {
          const address = queue[index];
          const verdict = classifyRcpt(code);

          if (index === 0) {
            // The random probe. Accepted means the domain takes anything.
            if (verdict === 'accepted') {
              catchAll = true;
              return finish(true, 'Domain accepts any address, so nothing can be confirmed');
            }
            if (verdict === 'inconclusive') {
              return finish(true, `Mail server would not answer clearly (${code})`);
            }
            askNext();
            continue;
          }

          verdicts.set(address, verdict);
          if (verdict === 'accepted') return finish(true, 'Mailbox confirmed');
          // Rate limited or greylisted mid-session: further answers are noise.
          if (code >= 420 && code < 500) return finish(true, `Mail server stopped answering (${code})`);
          askNext();
        }
      }
    });

    socket.connect(SMTP_PORT, mxHost);
  });
}

/* ------------------------------------------------------------------ */
/* Domain checks                                                      */
/* ------------------------------------------------------------------ */

const DNS_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
    promise
      .then((value) => { clearTimeout(timer); resolve(value); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Mail exchangers for a domain, best priority first. Empty when the domain
 * can't receive mail — which settles the whole lookup.
 *
 * @param domain
 */
async function mailHosts(domain: string): Promise<string[]> {
  try {
    const records = await withTimeout(dns.promises.resolveMx(domain), DNS_TIMEOUT_MS);
    return records
      .filter((record) => record.exchange)
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange);
  } catch {
    // No MX is legal: the A record is the implicit mail host.
    try {
      const addresses = await withTimeout(dns.promises.resolve4(domain), DNS_TIMEOUT_MS);
      return addresses.length ? [domain] : [];
    } catch {
      return [];
    }
  }
}

/**
 * Reduce anything domain-ish to a bare registrable host: a full URL, a
 * "www." prefix, or an address someone pasted whole.
 *
 * @param raw
 */
export function normaliseDomain(raw: string): string {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('@')) value = value.split('@').pop() || '';
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.replace(/^www\./, '');
  value = value.replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : '';
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/** Free-mail domains, where a convention guess is worthless. */
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'yandex.com', 'zoho.com', 'qq.com', '163.com',
]);

/**
 * Find the address for a person at a domain.
 *
 * @param userId Whose contacts to learn the domain's convention from.
 * @param input
 */
export async function findEmail(userId: string, input: FindEmailInput): Promise<FindEmailResult> {
  const domain = normaliseDomain(input.domain);

  const empty = (reason: string, overrides: Partial<FindEmailResult> = {}): FindEmailResult => ({
    found: false,
    email: null,
    pattern: null,
    confidence: 0,
    verified: false,
    catch_all: false,
    mx: false,
    smtp_checked: false,
    pattern_from_known: false,
    candidates: [],
    reason,
    ...overrides,
  });

  if (!domain) return empty('That does not look like a company domain.');
  if (CONSUMER_DOMAINS.has(domain)) {
    return empty(
      `${domain} is a personal email provider, so there is no company convention to work from — an address there can only be found, not derived.`
    );
  }

  let first = normaliseNamePart(input.first_name);
  let last = normaliseNamePart(input.last_name);
  if ((!first || !last) && input.full_name) {
    const split = splitFullName(input.full_name);
    if (!first) first = normaliseNamePart(split.first);
    if (!last) last = normaliseNamePart(split.last);
  }

  if (!first && !last) return empty('A name is needed to work out the address.');

  const knownFirst = await knownPatternsForDomain(userId, domain);
  const candidates = buildCandidates(first, last, domain, knownFirst);
  if (candidates.length === 0) return empty('That name gives nothing to build an address from.');

  const hosts = await mailHosts(domain);
  if (hosts.length === 0) {
    return empty(`${domain} has no mail server, so it cannot receive email at all.`, { candidates });
  }

  const probe = await probeMailbox(hosts[0], candidates.map((candidate) => candidate.email));

  const scored = candidates.map((candidate) => ({
    ...candidate,
    smtp: probe.verdicts.get(candidate.email) ?? null,
  }));

  const confirmed = scored.find((candidate) => candidate.smtp === 'accepted');
  if (confirmed) {
    return {
      found: true,
      email: confirmed.email,
      pattern: confirmed.pattern,
      confidence: 95,
      verified: true,
      catch_all: false,
      mx: true,
      smtp_checked: true,
      pattern_from_known: knownFirst.includes(confirmed.pattern),
      candidates: scored,
      reason: `${domain}'s mail server accepts this address.`,
    };
  }

  // Nothing confirmed. A ranked guess is still worth returning — but only with
  // a confidence that says what it is, and a reason that says why it's a guess.
  const best = scored[0];
  const patternFromKnown = knownFirst.includes(best.pattern);
  const everythingRejected =
    probe.reachable &&
    !probe.catchAll &&
    scored.every((candidate) => candidate.smtp === 'rejected');

  if (everythingRejected) {
    return empty(
      `${domain}'s mail server rejected every address this name could produce, so ${
        first && last ? 'they' : 'this person'
      } probably doesn't have a mailbox there.`,
      { mx: true, smtp_checked: true, candidates: scored }
    );
  }

  let confidence: number;
  let reason: string;
  if (probe.catchAll) {
    confidence = patternFromKnown ? 55 : 35;
    reason = `${domain} accepts mail to any address, so no address there can be confirmed. This is ${
      patternFromKnown ? "the convention your other contacts at this domain use" : 'the most common convention'
    }.`;
  } else if (!probe.reachable) {
    confidence = patternFromKnown ? 70 : 45;
    reason = `${probe.reason}. ${
      patternFromKnown
        ? 'This follows the convention your other contacts at this domain use.'
        : 'This is the most common convention, but it is unconfirmed.'
    }`;
  } else {
    confidence = patternFromKnown ? 60 : 40;
    reason = `${domain}'s mail server would not confirm or deny. ${
      patternFromKnown
        ? 'This follows the convention your other contacts at this domain use.'
        : 'This is the most common convention, but it is unconfirmed.'
    }`;
  }

  return {
    found: true,
    email: best.email,
    pattern: best.pattern,
    confidence,
    verified: false,
    catch_all: probe.catchAll,
    mx: true,
    smtp_checked: probe.reachable,
    pattern_from_known: patternFromKnown,
    candidates: scored,
    reason,
  };
}
