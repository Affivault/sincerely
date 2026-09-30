/* ═══════════════════════════════════════════════════════════════════════
   Reading a bounce that arrives as an email.

   Most bounces are not a refusal at send time. The receiving server says
   yes, then sends a "delivery failed" message back to the mailbox minutes
   or hours later - from mailer-daemon@ or postmaster@, in one of a dozen
   formats. The send path only ever saw the first kind, and since the
   people-first inbox those notices are filed under Other mail, where
   nothing reads them. So the address stayed "active", the sequence kept
   following up on a mailbox that does not exist, the bounce guard never
   saw the rate climb, and the sending mailbox's health never moved.

   This reads one. Three verdicts, because they mean different things:

     address   the address is dead (5.1.x, "user unknown", "no such user").
               Stop emailing it, anywhere, ever.
     blocked   the address is fine, the *sender* was refused (5.7.x, "spam",
               "blocked", "reputation", "policy"). The contact is not at
               fault; the mailbox or domain is. This is the signal a
               deliverability autopilot most needs.
     soft      it will be retried (4.x.x, "mailbox full", "delayed"). Noted,
               not acted on.

   Pure and dependency-free so it can be asserted against real notices.
   ═══════════════════════════════════════════════════════════════════════ */

export type BounceKind = 'address' | 'blocked' | 'soft';

export interface BounceNotice {
  kind: BounceKind;
  /** The addresses that failed, lower-cased. Never the mailbox's own. */
  recipients: string[];
  /** The enhanced status code when the notice carries one, e.g. "5.1.1". */
  status: string | null;
  /** A short human reason, e.g. "user unknown". */
  reason: string;
}

export interface BounceNoticeInput {
  fromEmail: string;
  subject?: string | null;
  bodyText?: string | null;
  /** The mailbox that received it - excluded from the recipients. */
  ownAddress?: string | null;
}

const DAEMON_LOCAL = /^(mailer-?daemon|postmaster|mail-?daemon|mail\.?delivery\.?(sub)?system|mdaemon|bounces?)([+.-]|$)/i;

const DSN_SUBJECT = /(undeliver|undelivered mail|delivery status notification|delivery (has )?failed|failure notice|mail delivery (failed|subsystem|system)|returned mail|could not be delivered|message not delivered|delivery failure|non-?delivery|address not found|rejected:|message blocked|nicht zustellbar|non remis|no se pudo entregar)/i;

const SOFT_SUBJECT = /(delayed|delay notification|still trying|will retry|warning: message|delivery status notification \(delay\))/i;

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** Signals, in the order they are trusted. */
const BLOCKED_TEXT = /(5\.7\.\d+|spam|blocked|block ?list|blacklist|reputation|policy|rejected (by|due to)|not authori[sz]ed|access denied|dmarc|spf (check )?fail|dkim|unauthenticated|poor reputation|listed at|rbl|spamhaus|barracuda|message rejected)/i;
const ADDRESS_TEXT = /(5\.1\.[0-9]|5\.5\.0 .*(user|mailbox)|user (unknown|not found)|unknown user|no such (user|recipient|mailbox|address)|mailbox (unavailable|not found|does not exist)|address (not found|rejected|doesn'?t exist|does not exist|couldn'?t be found)|recipient (address )?rejected|does not exist|invalid (recipient|mailbox|address)|account (has been )?(disabled|deactivated|closed|suspended)|no mailbox here|unrouteable address|domain (not found|does not exist)|host or domain name not found|nxdomain|wasn'?t found at)/i;
const SOFT_TEXT = /(4\.\d\.\d+|mailbox (is )?full|over ?quota|quota exceeded|insufficient (storage|system storage)|temporar(y|ily)|try (again )?later|delayed|deferred|greylist)/i;

/** The words that matched, preferring a phrase over a bare status code. */
function why(re: RegExp, text: string, fallback: string): string {
  const all = [...text.matchAll(new RegExp(re.source, 'gi'))].map((m) => m[0].toLowerCase());
  return all.find((m) => /[a-z]/.test(m)) || all[0] || fallback;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

function field(text: string, name: string): string[] {
  const re = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im');
  const out: string[] = [];
  for (const l of lines(text)) {
    const m = l.match(re);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Is this, on its face, a delivery notice? */
export function looksLikeBounceNotice(input: Pick<BounceNoticeInput, 'fromEmail' | 'subject' | 'bodyText'>): boolean {
  const local = (input.fromEmail || '').split('@')[0] || '';
  const body = input.bodyText || '';
  if (DAEMON_LOCAL.test(local)) return true;
  if (DSN_SUBJECT.test(input.subject || '')) {
    // A subject alone could be a person writing "your invoice was
    // undelivered" - require the body to read like a report too.
    return /final-recipient|diagnostic-code|status:\s*[245]\.\d|action:\s*(failed|delayed)|\b5\d\d[ -]|\b4\d\d[ -]|wasn'?t delivered|could not be delivered|permanent(ly)? (error|failure)|delivery to the following recipient/i.test(body);
  }
  return false;
}

/**
 * Read a delivery notice, or say it is not one.
 *
 * Returns null for anything that is not clearly a bounce, or a bounce whose
 * failed address cannot be found - acting on a guess here would mark a
 * real person as dead.
 */
export function parseBounceNotice(input: BounceNoticeInput): BounceNotice | null {
  if (!looksLikeBounceNotice(input)) return null;
  const body = input.bodyText || '';
  const subject = input.subject || '';
  const own = (input.ownAddress || '').toLowerCase();
  const fromLower = (input.fromEmail || '').toLowerCase();

  // 1. The machine-readable part (RFC 3464), when the body kept it.
  const reported = [...field(body, 'Final-Recipient'), ...field(body, 'Original-Recipient')]
    .map((v) => v.replace(/^rfc822\s*;\s*/i, '').replace(/[<>]/g, '').trim().toLowerCase())
    .filter((v) => /@/.test(v));

  // 2. The human-readable part: the address near the words that name it.
  const near: string[] = [];
  const phrases = /(wasn'?t delivered to|could not be delivered to|delivery to the following recipients? (failed|has been delayed)|following (address|recipient)\(?e?s?\)? (failed|had permanent fatal errors)|undeliverable to|failed recipient|recipient address|address not found|to the following recipients?)/i;
  const ls = lines(body);
  for (let i = 0; i < ls.length; i++) {
    if (!phrases.test(ls[i])) continue;
    const window = ls.slice(i, i + 4).join(' ');
    for (const m of window.match(EMAIL_RE) || []) near.push(m.toLowerCase());
  }

  // 3. Exim / qmail list the address on a line of its own after the header.
  for (const l of ls) {
    const m = l.match(/^\s*<?([a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})>?\s*:?\s*$/i);
    if (m) near.push(m[1].toLowerCase());
  }

  const excluded = (e: string) => e === own || e === fromLower || DAEMON_LOCAL.test(e.split('@')[0]);
  const recipients = [...new Set((reported.length ? reported : near).filter((e) => !excluded(e)))];
  if (recipients.length === 0) return null;

  // Enhanced status: Status: header first, then any x.y.z in the text.
  const statusField = field(body, 'Status')[0]?.match(/[245]\.\d{1,3}\.\d{1,3}/)?.[0] || null;
  const action = (field(body, 'Action')[0] || '').toLowerCase();
  // Not preceded or followed by a digit or dot, so an IP address is not
  // read as a status code.
  const inline = body.match(/(?<![\d.])([245]\.\d{1,3}\.\d{1,3})(?![\d.])/)?.[1] || null;
  const status = statusField || inline;
  const diagnostic = field(body, 'Diagnostic-Code')[0] || '';
  const evidence = `${diagnostic}\n${subject}\n${body.slice(0, 6000)}`;

  let kind: BounceKind;
  let reason: string;
  if (action === 'delayed' || SOFT_SUBJECT.test(subject) || (status && status.startsWith('4.'))) {
    kind = 'soft';
    reason = why(SOFT_TEXT, evidence, 'delayed, will be retried');
  } else if ((status && status.startsWith('5.7.')) || (!ADDRESS_TEXT.test(diagnostic || evidence) && BLOCKED_TEXT.test(evidence))) {
    kind = 'blocked';
    reason = why(BLOCKED_TEXT, evidence, 'refused by policy');
  } else if ((status && status.startsWith('5.')) || action === 'failed' || ADDRESS_TEXT.test(evidence)) {
    kind = 'address';
    reason = why(ADDRESS_TEXT, evidence, 'permanent failure');
  } else if (SOFT_TEXT.test(evidence)) {
    kind = 'soft';
    reason = why(SOFT_TEXT, evidence, 'temporary failure');
  } else {
    // A notice with an address and no reason at all: the conservative
    // reading is the one that stops emailing a dead address.
    kind = 'address';
    reason = 'undeliverable';
  }

  return { kind, recipients, status, reason };
}

/**
 * The same question for a refusal at send time: a dead address, or a
 * sender the receiving server would not accept? Reads the SMTP reply text.
 */
export function classifyRejection(text: string): 'address' | 'blocked' {
  const t = String(text || '');
  const status = t.match(/(?<![\d.])(5\.\d{1,3}\.\d{1,3})(?![\d.])/)?.[1] || '';
  if (status.startsWith('5.7.')) return 'blocked';
  if (status.startsWith('5.1.')) return 'address';
  if (ADDRESS_TEXT.test(t)) return 'address';
  if (BLOCKED_TEXT.test(t)) return 'blocked';
  return 'address';
}
