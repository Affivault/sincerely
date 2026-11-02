/* ═══════════════════════════════════════════════════════════════════════
   The traffic light on an email address.

   Every lead and contact gets one of four, and the same four are used
   everywhere - the dot on a row, the filter chips above a list, the
   counts at launch, and the gate the sender checks before every email:

     green   verified: the mailbox exists and accepts mail
     amber   unsure: risky / catch-all, or not checked yet
     red     bad: invalid, no mail server, or it has bounced
     none    no usable email at all - people held in a list until one is
             found or typed in (held_people, migration 110)

   A campaign sends only to the lights it is set to (green by default),
   which is the whole point: sending to unverified and bad addresses is
   how a sending domain loses its reputation, and the person launching
   should decide, in front of the numbers, rather than find out from the
   bounce report.
   ═══════════════════════════════════════════════════════════════════════ */

export type EmailLight = 'green' | 'amber' | 'red' | 'none';
/** The lights a campaign can send to. 'none' has no address to send to. */
export type SendLight = Exclude<EmailLight, 'none'>;

export type EmailState = 'valid' | 'risky' | 'unverified' | 'invalid' | 'not_found' | 'bounced' | 'no_email';

export const EMAIL_LIGHTS: EmailLight[] = ['green', 'amber', 'red', 'none'];
export const SEND_LIGHTS: SendLight[] = ['green', 'amber', 'red'];
/** What a new campaign sends to unless the person launching it says otherwise. */
export const DEFAULT_SEND_LIGHTS: SendLight[] = ['green'];

export const LIGHT_LABEL: Record<EmailLight, string> = {
  green: 'Verified',
  amber: 'Unsure',
  red: 'Bad',
  none: 'No email',
};

export const LIGHT_HINT: Record<EmailLight, string> = {
  green: 'The mailbox exists and accepts mail',
  amber: 'Risky, catch-all, or not checked yet',
  red: 'Invalid, no mail server, or it bounced',
  none: 'No usable address yet - add one or re-import',
};

export const STATE_LIGHT: Record<EmailState, EmailLight> = {
  valid: 'green',
  risky: 'amber',
  unverified: 'amber',
  invalid: 'red',
  not_found: 'red',
  bounced: 'red',
  no_email: 'none',
};

export interface LightFields {
  email?: string | null;
  is_bounced?: boolean | null;
  dcs_verified_at?: string | null;
  dcs_score?: number | null;
  dcs_syntax_ok?: boolean | null;
  dcs_domain_ok?: boolean | null;
}

/**
 * The address's state. The buckets are the ones the server filters on
 * (contacts.service verification_status), so the dot on a row, the count
 * on a chip and the rows under it always agree.
 */
export function emailState(c: LightFields): EmailState {
  if (!c.email || !String(c.email).trim()) return 'no_email';
  if (c.is_bounced) return 'bounced';
  if (!c.dcs_verified_at) return 'unverified';
  if (c.dcs_syntax_ok === false) return 'invalid';
  if (c.dcs_domain_ok === false) return 'not_found';
  const score = typeof c.dcs_score === 'number' ? c.dcs_score : 0;
  if (score >= 80) return 'valid';
  if (score >= 50) return 'risky';
  return 'invalid';
}

export function emailLight(c: LightFields): EmailLight {
  return STATE_LIGHT[emailState(c)];
}

/** The lights a campaign row asks for; null (campaigns from before 110) means "no light gate". */
export function normalizeSendLights(v: unknown): SendLight[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  const out = SEND_LIGHTS.filter((l) => v.includes(l));
  return out;
}

/** What the sender does with an address whose light the campaign does not send to. */
export type LightGateAction = 'send' | 'wait' | 'skip';

/**
 * At send time. Allowed: send. An unchecked address in a campaign that only
 * sends to verified ones waits for its check (for up to `maxWaitHours` after
 * enrolment, then it is skipped). Anything else not allowed is skipped.
 */
export function lightGate(
  c: LightFields,
  allowed: SendLight[] | null,
  hoursSinceEnrolled: number,
  maxWaitHours = 72,
): LightGateAction {
  if (allowed == null) return 'send';
  const state = emailState(c);
  const light = STATE_LIGHT[state];
  if (light !== 'none' && allowed.includes(light as SendLight)) return 'send';
  if (state === 'unverified' && hoursSinceEnrolled < maxWaitHours) return 'wait';
  return 'skip';
}

/**
 * Counts by light, from the per-state counts the server already returns
 * (verification-breakdown) plus held people without an email.
 */
export function lightCounts(b: { valid?: number; risky?: number; unverified?: number; invalid?: number; not_found?: number; no_email?: number }): Record<EmailLight, number> {
  return {
    green: b.valid || 0,
    amber: (b.risky || 0) + (b.unverified || 0),
    red: (b.invalid || 0) + (b.not_found || 0),
    none: b.no_email || 0,
  };
}

/* ---- people held without an email ------------------------------------ */

/**
 * How a held person is recognised when they come back with an email - a
 * re-import of the fixed file, typically. Their LinkedIn profile when they
 * have one, otherwise name and company.
 */
export function heldMatchKey(p: { linkedin_url?: string | null; first_name?: string | null; last_name?: string | null; company?: string | null }): string | null {
  const li = String(p.linkedin_url || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^(www\.|[a-z]{2}\.)/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (/^linkedin\.com\/(in|pub)\//.test(li)) return `li:${li}`;
  const norm = (s?: string | null) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const first = norm(p.first_name);
  const last = norm(p.last_name);
  const company = norm(p.company);
  if (!first && !last) return null;
  return `n:${first}|${last}|${company}`;
}

export interface HeldPerson {
  id: string;
  list_id: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  /** Everything else the row carried, in the shape the import sends a contact. */
  data: Record<string, any>;
  /** What was in the email column, when it was not an address ("n/a"). */
  raw_email: string | null;
  reason: 'no_email' | 'invalid_email';
  kind: 'lead' | 'contact';
  import_source: string | null;
  created_at: string;
}
