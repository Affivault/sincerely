/* ═══════════════════════════════════════════════════════════════════════
   Telling a person from an autoresponder.

   Every inbound email matched to a campaign was recorded as a reply. An
   out-of-office bounce-back is an inbound email from the prospect's own
   address, so a fortnight of annual leave counted as interest: it inflated
   the reply rate — the number the whole product is judged on — halted the
   sequence if stop_on_reply was set, fired an email.replied webhook, and
   could open a CRM deal. The prospect never saw the message and never
   heard from you again.

   Headers first. RFC 3834 exists precisely so that automatic responders
   can be recognised without guessing, and Exchange, Gmail, Zimbra and the
   rest all set one form of it. Body text is the fallback, for the
   responders that set nothing — it is far weaker, so it is deliberately
   the second question and needs a phrase that a human would rarely write.
   ═══════════════════════════════════════════════════════════════════════ */

export type AutoReplyKind = 'out_of_office' | 'auto_reply' | null;

/**
 * Header names and the values that mark a message as machine-generated.
 *
 * `Auto-Submitted` is the standard (RFC 3834): anything other than `no`
 * means automatic. `Precedence: bulk|auto_reply|junk` is the older
 * convention and still what a lot of mail sets. The `X-` names are vendor
 * markers — Exchange, older Outlook, Zimbra, and several ticketing systems.
 */
const HEADER_RULES: { name: string; matches: (value: string) => boolean }[] = [
  { name: 'auto-submitted', matches: (v) => v.length > 0 && v.toLowerCase() !== 'no' },
  { name: 'precedence', matches: (v) => /^(bulk|auto_reply|auto-reply|junk|list)$/i.test(v.trim()) },
  { name: 'x-auto-response-suppress', matches: () => true },
  { name: 'x-autoreply', matches: () => true },
  { name: 'x-autorespond', matches: () => true },
  { name: 'x-autoresponder', matches: () => true },
  { name: 'x-mail-autoreply', matches: () => true },
  { name: 'x-autoreply-from', matches: () => true },
];

/** Vendor markers that identify the responder but not that it *is* one. */
const OOO_HEADER_HINTS = ['x-auto-response-suppress'];

/**
 * Phrases a human writing a genuine reply would almost never use, in the
 * languages this platform's users actually send to. Kept tight on purpose:
 * a false positive here is worse than a miss, because it discards a real
 * reply from a real prospect.
 */
const OOO_PHRASES: RegExp[] = [
  /\bout of (the )?office\b/i,
  /\bautomatic(ally)? (generated |sent )?(reply|response)\b/i,
  /\bauto[-\s]?reply\b/i,
  /\bthis is an automated\b/i,
  /\bon (annual |parental |maternity |paternity |sick )?leave\b.{0,40}\b(until|till|returning|return)\b/i,
  /\bon (vacation|holiday|pto)\b.{0,40}\b(until|till|returning|return|back)\b/i,
  /\bI (am|'m) currently (away|out|travel(l)?ing|unavailable)\b/i,
  /\bwill be (back|returning) (in|on|the)\b/i,
  /\blimited access to (my )?e-?mail\b/i,
  /\bno longer (with|works? (at|for))\b/i,        // left the company
  // Non-English, common in European B2B
  /\babwesenheitsnotiz\b/i,                        // German
  /\bautomatische antwort\b/i,
  /\bréponse automatique\b/i,                      // French
  /\babsence du bureau\b/i,
  /\brespuesta automática\b/i,                     // Spanish
  /\bfuori sede\b/i,                               // Italian
  /\bautomatisch antwoord\b/i,                     // Dutch
];

/**
 * Machine-written, but nobody is away — a helpdesk or form acknowledging
 * receipt. Worth telling apart, because the Unibox labels the two
 * differently and "Away" on a ticket confirmation is simply wrong.
 */
const ACK_PHRASES: RegExp[] = [
  /\bthank you for (your (e-?mail|message)|contacting)\b.{0,60}\b(we (will|'ll) (respond|reply|get back))\b/i,
  /\bticket\b.{0,30}\b(has been (created|received|logged)|received)\b/i,
  /\byour (request|enquiry|inquiry) has been (received|logged)\b/i,
];

/** Subject prefixes several responders use verbatim. */
const OOO_SUBJECTS: RegExp[] = [
  /^\s*(automatic reply|auto:|autoreply|out of office|abwesend|abwesenheitsnotiz)/i,
  /\bout of (the )?office\b/i,
];

export interface AutoReplyVerdict {
  kind: AutoReplyKind;
  /** Why, in a few words, for the activity record and for support. */
  reason: string | null;
  /** Headers are authoritative; body text is a guess. */
  confident: boolean;
}

/**
 * Normalise whatever the parser handed us into a plain lowercase-keyed map.
 *
 * mailparser gives a Map of lowercased names whose values may be strings,
 * arrays or structured objects depending on the header. Everything is
 * flattened to a string because every rule here is a simple match.
 */
function normaliseHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  const entries: [unknown, unknown][] =
    headers instanceof Map ? [...headers.entries()]
      : typeof headers === 'object' ? Object.entries(headers as Record<string, unknown>)
        : [];

  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).toLowerCase().trim();
    if (!key) continue;
    let value = '';
    if (typeof rawValue === 'string') value = rawValue;
    else if (Array.isArray(rawValue)) value = rawValue.map((v) => String(v)).join(' ');
    else if (rawValue && typeof rawValue === 'object') {
      const v = rawValue as any;
      value = String(v.value ?? v.text ?? JSON.stringify(v));
    } else if (rawValue !== undefined && rawValue !== null) value = String(rawValue);
    out[key] = value.trim();
  }
  return out;
}

/**
 * Is this message from a machine?
 *
 * @param headers  Parsed headers — mailparser's Map, or any string map.
 * @param subject  The Subject line.
 * @param body     Plain-text body. Only the opening is read: an
 *                 autoresponder says so immediately, whereas a quoted
 *                 thread further down may contain anything at all,
 *                 including a previous out-of-office nobody meant to match.
 */
export function detectAutoReply(
  headers: unknown,
  subject?: string | null,
  body?: string | null,
): AutoReplyVerdict {
  const map = normaliseHeaders(headers);

  const opening = (body || '').slice(0, 600);
  const readsAsAway = OOO_HEADER_HINTS.some((h) => map[h] !== undefined)
    || OOO_SUBJECTS.some((re) => re.test(subject || ''))
    || OOO_PHRASES.some((re) => re.test(opening));

  for (const rule of HEADER_RULES) {
    const value = map[rule.name];
    if (value !== undefined && rule.matches(value)) {
      // The header settles *that* it is automatic. The subject and opening
      // lines settle *which kind*, which is what the Unibox labels — a
      // vacation responder and a helpdesk acknowledgement are both machines
      // but they mean different things to whoever is reading the thread.
      return {
        kind: readsAsAway ? 'out_of_office' : 'auto_reply',
        reason: `${rule.name}${value ? `: ${value.slice(0, 40)}` : ''}`,
        confident: true,
      };
    }
  }

  for (const re of OOO_SUBJECTS) {
    if (re.test(subject || '')) {
      return { kind: 'out_of_office', reason: 'subject line', confident: false };
    }
  }

  for (const re of OOO_PHRASES) {
    if (re.test(opening)) {
      return { kind: 'out_of_office', reason: 'opening lines', confident: false };
    }
  }

  for (const re of ACK_PHRASES) {
    if (re.test(opening)) {
      return { kind: 'auto_reply', reason: 'acknowledgement', confident: false };
    }
  }

  return { kind: null, reason: null, confident: false };
}
