/* ═══════════════════════════════════════════════════════════════════════
   Where the mail actually landed.

   Everything else in this product is in service of deliverability -
   authenticating the domain, warming the mailbox, throttling the burst,
   guarding the bounce rate - and none of it could measure the thing it is
   all for. The closest the app came was a "health score" that starts at
   100 and only moves when something bounces, which is a number about
   rejections, not about folders. A campaign can bounce nothing at all and
   go entirely to spam.

   A seed test is the only way to find out without asking the recipient:
   send the same message to mailboxes you control at each provider, then
   read those mailboxes over IMAP and see which folder it is in.

   THE LIMITS, WRITTEN DOWN, BECAUSE A DELIVERABILITY TOOL THAT OVERCLAIMS
   IS WORSE THAN NONE:

   - Seed placement is not real placement. Seed mailboxes have no history
     with your sender, never reply, and never move a message out of spam.
     Real recipients do all three, so a real list usually does better than
     its seeds. This is a directional instrument, not a measurement of any
     individual recipient.

   - Providers detect seed networks. Public shared seed lists are
     discounted by Gmail and Outlook precisely because they are shared.
     These seeds are the account's own mailboxes, which is better, but the
     principle stands: a good seed result is necessary, not sufficient.

   - MISSING IS NOT SPAM. A message that has not appeared may be greylisted,
     queued, delayed behind a slow provider, or genuinely blocked at the
     gateway. Filing it under spam would invent a filtering decision nobody
     observed. It is reported as its own outcome, always.

   - Gmail's tabs (Primary, Promotions, Updates) are labels on the inbox
     rather than folders, and IMAP does not reliably expose which one a
     message got. So this reports INBOX, SPAM and MISSING, and does not
     guess at a tab. A tool that confidently says "Promotions" when it
     cannot tell is the same failure as a green tick over no evidence.
   ═══════════════════════════════════════════════════════════════════════ */

/** How long to keep looking before an unfound probe is called missing. */
export const PLACEMENT_WAIT_MS = 20 * 60 * 1000;

/** Below this many seeds answering, a percentage is not reported. */
export const MIN_SEEDS_FOR_RATE = 4;

export type MailProvider = 'gmail' | 'outlook' | 'yahoo' | 'other';

export const PROVIDER_LABELS: Record<MailProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  yahoo: 'Yahoo',
  other: 'Other',
};

/**
 * Where one probe ended up.
 *
 * Named ProbePlacement rather than Placement: calendar.types already
 * exports a Placement<T> for laying out events, and two exported names
 * that mean different things is a wrong import waiting to happen.
 *
 * `error` is deliberately separate from `missing`. A probe that never left
 * our own SMTP server says nothing whatsoever about the receiving
 * provider, and counting it as a delivery failure would blame a spam
 * filter for our outage.
 */
export type ProbePlacement = 'pending' | 'inbox' | 'spam' | 'missing' | 'error';

export interface PlacementResult {
  provider: MailProvider;
  placement: ProbePlacement;
  /** The folder it was found in, for the ones that were found. */
  folder?: string | null;
}

/* ── Which provider a seed mailbox is at ──────────────────────────────── */

const DOMAIN_PROVIDER: Array<[RegExp, MailProvider]> = [
  [/(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i, 'gmail'],
  [/(^|\.)(outlook|hotmail|live|msn)\.[a-z.]+$/i, 'outlook'],
  [/(^|\.)(yahoo|ymail|rocketmail)\.[a-z.]+$/i, 'yahoo'],
];

const HOST_PROVIDER: Array<[RegExp, MailProvider]> = [
  [/(^|\.)google\.com$|(^|\.)gmail\.com$/i, 'gmail'],
  [/(^|\.)outlook\.(com|office365\.com)$|(^|\.)office365\.com$/i, 'outlook'],
  [/(^|\.)mail\.yahoo\.com$|(^|\.)yahoo\.com$/i, 'yahoo'],
];

/**
 * Which provider is behind this seed.
 *
 * Not called providerOf - warm-up already has one of those, and it
 * answers a different question: whether two mailboxes are at the same
 * place, as a registrable-domain string. This names one of the providers
 * a placement report groups by.
 *
 * The address first, then the IMAP host - a Google Workspace mailbox on a
 * custom domain is a Gmail inbox with Gmail's filters, and calling it
 * "other" would put the single most important provider in the bucket that
 * says nothing.
 */
export function seedProvider(email: string | null | undefined, imapHost?: string | null): MailProvider {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim() || '';
  for (const [re, provider] of DOMAIN_PROVIDER) if (re.test(domain)) return provider;

  const host = (imapHost || '').toLowerCase().trim();
  for (const [re, provider] of HOST_PROVIDER) if (re.test(host)) return provider;

  return 'other';
}

/* ── Which folder counts as what ──────────────────────────────────────── */

/**
 * Names that mean "this was filtered", across the providers and languages
 * this is likely to meet. Matched as whole path segments rather than as
 * substrings: "Spam" must not match a user folder called "Spammers", and
 * "Junk" must not match "Junk Drawer Ideas".
 */
const SPAM_NAMES = [
  'spam', 'junk', 'junk e-mail', 'junk email', 'bulk mail', 'bulk',
  'unwanted', 'quarantine',
  // Non-English names the major providers localise to.
  'correo no deseado', 'courrier indésirable', 'indesiderata', 'lixo eletrônico',
  'spamverdacht', 'ongewenste e-mail', 'skräppost', 'roskaposti',
];

const INBOX_NAMES = ['inbox', 'bandeja de entrada', 'boîte de réception', 'posteingang', 'caixa de entrada'];

export type FolderKind = 'inbox' | 'spam' | 'other';

/**
 * What kind of folder this is.
 *
 * `specialUse` is the IMAP server's own answer (`\Junk`, `\Inbox`) and is
 * trusted first, because it is the only one that does not depend on
 * guessing at names in a language nobody here reads.
 */
export function classifyFolder(path: string, specialUse?: string | null): FolderKind {
  const special = (specialUse || '').toLowerCase();
  if (special.includes('junk')) return 'spam';
  if (special.includes('inbox')) return 'inbox';

  const segments = (path || '').split(/[/.]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (segments.length === 0) return 'other';
  const leaf = segments[segments.length - 1];

  // "[Gmail]/Spam" and "INBOX.Junk" both end in the meaningful segment.
  if (SPAM_NAMES.includes(leaf)) return 'spam';
  if (INBOX_NAMES.includes(leaf)) return 'inbox';

  /*
   * A subfolder of the inbox is not the inbox. Gmail's "INBOX/Receipts" is
   * somewhere a filter put it, which is a different outcome from landing
   * in front of somebody - and much closer to being filed away unread.
   */
  return 'other';
}

/* ── Reading a whole test ─────────────────────────────────────────────── */

export type PlacementVerdict = 'good' | 'mixed' | 'poor' | 'too-early' | 'unknown';

export interface PlacementSummary {
  inbox: number;
  spam: number;
  missing: number;
  /** Still being looked for. */
  pending: number;
  /** Probes that never left our end. Not a deliverability outcome. */
  errored: number;
  /** Seeds that produced a real answer: inbox + spam + missing. */
  answered: number;
  total: number;
  /**
   * Share of answered seeds that reached the inbox, 0-1. Null when the
   * test is still running or too few seeds answered to mean anything.
   */
  inboxRate: number | null;
  verdict: PlacementVerdict;
  /** One sentence. Never empty. */
  headline: string;
}

/**
 * Summarise a set of probes.
 *
 * The rules that make this honest rather than reassuring:
 *
 *   A TEST STILL RUNNING HAS NO RATE. Two seeds in out of eight is not
 *   "100% inbox", and showing it as one invites somebody to launch on it.
 *
 *   ERRORED PROBES ARE NOT COUNTED EITHER WAY. They are our failure, and
 *   putting them in the denominator would drag the number down for a
 *   reason that has nothing to do with the receiving provider.
 *
 *   MISSING IS ITS OWN COLUMN. It is not filtering we observed, and it is
 *   not delivery either.
 */
export function placementSummary(results: readonly PlacementResult[]): PlacementSummary {
  const count = (p: ProbePlacement) => results.filter((r) => r.placement === p).length;

  const inbox = count('inbox');
  const spam = count('spam');
  const missing = count('missing');
  const pending = count('pending');
  const errored = count('error');
  const answered = inbox + spam + missing;
  const total = results.length;

  if (total === 0) {
    return {
      inbox, spam, missing, pending, errored, answered, total,
      inboxRate: null,
      verdict: 'unknown',
      headline: 'No seed mailboxes were tested.',
    };
  }

  if (errored === total) {
    return {
      inbox, spam, missing, pending, errored, answered, total,
      inboxRate: null,
      verdict: 'unknown',
      headline: 'None of the test messages could be sent, so nothing was measured.',
    };
  }

  if (pending > 0) {
    return {
      inbox, spam, missing, pending, errored, answered, total,
      inboxRate: null,
      verdict: 'too-early',
      headline: answered === 0
        ? `Waiting on ${pending} seed mailbox${pending === 1 ? '' : 'es'}. Nothing has arrived yet.`
        : `${answered} of ${answered + pending} seeds have answered so far. Still looking.`,
    };
  }

  if (answered < MIN_SEEDS_FOR_RATE) {
    return {
      inbox, spam, missing, pending, errored, answered, total,
      inboxRate: null,
      verdict: 'too-early',
      headline: `Only ${answered} seed${answered === 1 ? '' : 's'} answered. Connect at least ${MIN_SEEDS_FOR_RATE} - ideally one per provider - before reading anything into this.`,
    };
  }

  const inboxRate = inbox / answered;

  /*
   * Anything in spam is a finding, not a rounding error. One seed in spam
   * out of six means a filter somewhere made that decision about this
   * message, and that decision generalises to recipients far more than a
   * single good result does.
   */
  const verdict: PlacementVerdict = spam === 0 && missing === 0 ? 'good'
    : inboxRate >= 0.8 ? 'mixed'
    : 'poor';

  const parts: string[] = [`${inbox} of ${answered} reached the inbox`];
  if (spam > 0) parts.push(`${spam} went to spam`);
  if (missing > 0) parts.push(`${missing} never arrived`);

  return {
    inbox, spam, missing, pending, errored, answered, total,
    inboxRate,
    verdict,
    headline: `${parts.join(', ')}.`,
  };
}

/** The same summary, per provider, for the ones that were tested. */
export function placementByProvider(
  results: readonly PlacementResult[],
): Array<{ provider: MailProvider; summary: PlacementSummary }> {
  const order: MailProvider[] = ['gmail', 'outlook', 'yahoo', 'other'];
  return order
    .map((provider) => ({ provider, results: results.filter((r) => r.provider === provider) }))
    .filter((g) => g.results.length > 0)
    .map((g) => ({ provider: g.provider, summary: placementSummary(g.results) }));
}

/**
 * What to do about a result, in one line.
 *
 * Deliberately specific. "Improve your deliverability" is not advice, and
 * the whole point of measuring placement is to turn it into a next step.
 */
export function placementAdvice(s: PlacementSummary): string {
  if (s.verdict === 'too-early' || s.verdict === 'unknown') return '';
  if (s.verdict === 'good') {
    return 'Every seed reached the inbox. Re-run this after any change to your domain records, your sending volume, or the copy itself.';
  }
  if (s.missing > s.spam) {
    return 'More messages went missing than were filtered, which usually means a gateway rejected them outright rather than a spam folder. Check the bounce log and your domain authentication before sending more.';
  }
  return 'Messages from this mailbox are being filtered. The three things that move this, in order: authenticate the sending domain (SPF, DKIM and DMARC all passing), cut daily volume and let warm-up rebuild, and remove the links and attachments from the first message in the sequence.';
}
