/* ═══════════════════════════════════════════════════════════════════════
   What is already known about a mailbox, and what is still missing.

   The connect form was three tabs - Account, Server, Options - which split
   the two things you need in order to connect at all across two of them:
   the password on the first, the host on the second. So "Check connection"
   could fail for a reason sitting on a panel you were not looking at, and
   the only cue was a small amber dot on a tab.

   Tabs were the wrong shape for this because the three panels are not
   peers. One of them is the whole job (which mailbox, and its password),
   one is usually already correct because the provider was detected, and one
   has defaults that work. That is a disclosure problem, not a navigation
   problem.

   Collapsing sections is only safe under one rule, and it is the rule this
   module exists to make assertable:

     A COLLAPSED SECTION MUST NEVER HIDE SOMETHING THAT IS WRONG OR MISSING.

   Hiding a required empty field behind a summary is strictly worse than the
   tab was, because a tab at least looked like somewhere to go. So the
   decision about what starts open is derived from the values, the collapsed
   summary reports the gap in words, and both are checked here rather than
   by reading a component and hoping.
   ═══════════════════════════════════════════════════════════════════════ */

/** The three real questions, in the order they are asked. */
export type SetupSectionId = 'mailbox' | 'servers' | 'sending';

export interface SetupField {
  /** Matches the form field, so it can be flagged in place. */
  key: string;
  /** Names it in a sentence, lower case: "add your password first". */
  label: string;
  section: SetupSectionId;
}

export interface SetupFacts {
  email_address?: string | null;
  smtp_pass?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  imap_host?: string | null;
  imap_port?: number | null;
  /** A mailbox that already exists: its password is held server-side. */
  saved?: boolean;
}

const filled = (v: string | null | undefined) => !!(v || '').trim();
const port = (v: number | null | undefined) => typeof v === 'number' && v > 0;

/**
 * Everything that has to be there before this mailbox can be connected.
 *
 * One list, used both for the connection test and for saving. There were
 * two - `missingForCheck` and `missingForSave`, the second being the first
 * plus a label - and two lists that agree until one is edited is the shape
 * that produced the imapHostFor bug.
 *
 * Ordered, because the first entry is where the user gets sent.
 */
export function missingFields(f: SetupFacts): SetupField[] {
  const out: SetupField[] = [];
  if (!filled(f.email_address)) out.push({ key: 'email_address', label: 'email address', section: 'mailbox' });
  /*
   * A saved mailbox keeps its password server-side and the field is
   * deliberately blank, so requiring one here would make every edit demand
   * a retype of a credential the user may not have to hand.
   */
  if (!filled(f.smtp_pass) && !f.saved) out.push({ key: 'smtp_pass', label: 'password', section: 'mailbox' });
  if (!filled(f.smtp_host)) out.push({ key: 'smtp_host', label: 'outgoing server', section: 'servers' });
  if (!port(f.smtp_port)) out.push({ key: 'smtp_port', label: 'outgoing port', section: 'servers' });
  return out;
}

/**
 * The internal name for a mailbox.
 *
 * "Label" was a required field that blocked saving, and for a custom domain
 * - where no preset fills it in - that meant typing a name for something
 * that already has a perfectly good one. The address is unique, always
 * present by the time anything can be saved, and is what people would have
 * typed anyway.
 */
export function mailboxLabel(label: string | null | undefined, email: string | null | undefined): string {
  return (label || '').trim() || (email || '').trim();
}

export type SummaryTone = 'ok' | 'warning' | 'empty';

export interface SetupSummary {
  /** One line, readable with the section shut. */
  text: string;
  tone: SummaryTone;
}

/**
 * The servers, in one line, for when the section is closed.
 *
 * Never reads 'ok' while something is missing - that is the whole contract
 * of collapsing it. A mailbox with no incoming server is a mailbox whose
 * replies never arrive, and that has to be legible without opening
 * anything.
 */
export function serverSummary(f: SetupFacts): SetupSummary {
  const smtp = (f.smtp_host || '').trim();
  const imap = (f.imap_host || '').trim();

  if (!smtp) {
    return { text: 'Not set yet - this mailbox cannot send until it has an outgoing server.', tone: 'empty' };
  }

  const sends = `${smtp}:${port(f.smtp_port) ? f.smtp_port : 587}`;
  if (!imap) {
    return {
      text: `Sends via ${sends}. No incoming server, so replies will not reach your inbox here.`,
      tone: 'warning',
    };
  }

  return {
    text: `Sends via ${sends}, receives from ${imap}:${port(f.imap_port) ? f.imap_port : 993}.`,
    tone: 'ok',
  };
}

export interface SendingFacts {
  daily_send_limit?: number | null;
  signature_html?: string | null;
  signature_auto?: boolean | null;
}

/** The limit and the signature, in one line, for when the section is closed. */
export function sendingSummary(f: SendingFacts): SetupSummary {
  const limit = typeof f.daily_send_limit === 'number' ? f.daily_send_limit : 0;
  const hasSig = !!(f.signature_html || '').replace(/<[^>]*>/g, '').trim();
  const sig = !hasSig ? 'no signature'
    : f.signature_auto ? 'signature added automatically'
    : 'signature available in the composer';

  const advice = limitAdvice(limit);
  if (advice.tone !== 'ok') return { text: `${advice.note} ${cap(sig)}.`, tone: 'warning' };
  return { text: `Up to ${limit} a day, ${sig}.`, tone: 'ok' };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Whether a daily send limit is a sensible one.
 *
 * The field was a bare number input with no guidance whatsoever, which is
 * how a mailbox ends up set to 2,000 a day. Volume is the single easiest
 * way to get a new domain filtered, and nothing in the form said so.
 */
export function limitAdvice(limit: number): { tone: 'ok' | 'warning' | 'danger'; note: string } {
  if (!(limit > 0)) {
    return { tone: 'danger', note: 'At zero, this mailbox will not send anything.' };
  }
  if (limit > 500) {
    return {
      tone: 'danger',
      note: `${limit} a day from one mailbox is far past what cold outreach survives; most providers start filtering well below this.`,
    };
  }
  if (limit > 200) {
    return {
      tone: 'warning',
      note: `${limit} a day is above the 200 most providers tolerate from a single mailbox. Add another mailbox rather than raising this one.`,
    };
  }
  return { tone: 'ok', note: '' };
}

/**
 * Which sections should be open when the form appears.
 *
 * The rule, in code: anything with a gap in it, or anything whose one-line
 * summary is not clean, is open. Everything else starts shut. A detected
 * Gmail account therefore opens as a single short panel - address and
 * password - while a custom domain whose MX lookup found nothing opens with
 * the server fields already in front of you.
 */
export function sectionsToOpen(f: SetupFacts): SetupSectionId[] {
  const open = new Set<SetupSectionId>(['mailbox']);
  for (const m of missingFields(f)) open.add(m.section);
  if (serverSummary(f).tone !== 'ok') open.add('servers');
  // Sending is never forced open: its defaults are safe, and an existing
  // over-limit value is surfaced in the summary line instead.
  return (['mailbox', 'servers', 'sending'] as SetupSectionId[]).filter((s) => open.has(s));
}
