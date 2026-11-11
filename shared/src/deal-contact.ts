/* ═══════════════════════════════════════════════════════════════════════
   When did we last speak to anyone on this deal?

   A deal is a conversation with several people at once: the champion,
   the person who signs, somebody in procurement. "Days in stage" says how
   long the card has sat still, which is not the same thing at all. What
   decides whether a deal is alive is when somebody on their side last
   heard from us, and when we last heard from them.

   This turns the email back and forth (and any meetings or calls held)
   with everybody on the deal into:
     - the last touch either way, who it was with, and who made it
     - the last time anybody on their side wrote back or met us
     - who holds the ball (they wrote last, so it is on you)
     - a pace: fresh, cooling, gone quiet, or never contacted
     - the same per person, so a deal that is lively with one contact and
       silent with the decision maker shows it

   Pure, so the wording and the thresholds can be asserted. The server
   feeds it for the board; the deal page feeds it from what it already has.
   ═══════════════════════════════════════════════════════════════════════ */

export type DealContactPace = 'fresh' | 'cooling' | 'quiet' | 'never';

/** Under this many days since the last touch, a deal is fresh. */
export const DEAL_CONTACT_COOLING_DAYS = 7;
/** From this many days, a deal has gone quiet. */
export const DEAL_CONTACT_QUIET_DAYS = 14;

export type DealTouchKind = 'email_in' | 'email_out' | 'meeting' | 'call';

export interface DealTouchInput {
  at: string;
  kind: DealTouchKind;
  /** The person on their side it was with. Null when it cannot be told (a meeting with no guest email). */
  email: string | null;
}

export interface DealPersonInput {
  email: string;
  name?: string | null;
  contact_id?: string | null;
  role?: string | null;
  primary?: boolean;
}

export interface DealPersonContact {
  email: string;
  name: string;
  contact_id: string | null;
  role: string | null;
  primary: boolean;
  /** Last email from them to us. */
  last_in: string | null;
  /** Last email from us to them. */
  last_out: string | null;
  /** Last meeting or call held with them. */
  last_met: string | null;
  /** The latest of the three. */
  last_at: string | null;
  days: number | null;
  pace: DealContactPace;
  /** One short line, e.g. "Replied 3 days ago" or "You emailed 2 weeks ago, no reply". */
  line: string;
}

export interface DealLastTouch {
  at: string;
  by: 'you' | 'them' | 'both';
  kind: 'email' | 'meeting' | 'call';
  email: string | null;
  name: string | null;
}

export interface DealContactActivity {
  last: DealLastTouch | null;
  /** The last time anybody on their side wrote to us, or we met. */
  last_heard: { at: string; email: string | null; name: string | null } | null;
  days_since: number | null;
  days_since_heard: number | null;
  pace: DealContactPace;
  /** 'you' when they wrote last and are waiting; 'them' when we wrote last. */
  ball: 'you' | 'them' | null;
  /** Everybody on the deal, most recently in touch first, never contacted last. */
  people: DealPersonContact[];
  /** People who have written back or met us. */
  engaged: number;
  total: number;
  /** Headline: "Sarah Lee replied 3 days ago". */
  sentence: string;
}

const DAY = 86_400_000;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}

export function paceOf(days: number | null): DealContactPace {
  if (days === null) return 'never';
  if (days >= DEAL_CONTACT_QUIET_DAYS) return 'quiet';
  if (days >= DEAL_CONTACT_COOLING_DAYS) return 'cooling';
  return 'fresh';
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "3 months ago". */
export function agoLabel(days: number | null): string {
  if (days === null) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

/** "3d", "2w", "4mo": for a card or a table cell. */
export function agoShort(days: number | null): string {
  if (days === null) return '-';
  if (days <= 0) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.max(2, Math.round(days / 30))}mo`;
}

function firstName(name: string): string {
  if (name.includes('@')) return name;
  return name.split(/\s+/)[0] || name;
}

const latest = (...xs: Array<string | null>): string | null =>
  xs.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

export function dealContactActivity(input: {
  people: DealPersonInput[];
  touches: DealTouchInput[];
  now?: Date | number;
  /** How far back the touches were read, when the reader had a limit. "Never" then means "not in this long". */
  windowDays?: number;
}): DealContactActivity {
  const now = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now());

  const byEmail = new Map<string, DealPersonContact>();
  for (const p of input.people) {
    const email = String(p.email || '').trim().toLowerCase();
    if (!email || byEmail.has(email)) {
      // The primary contact listed again as a participant keeps the role.
      const existing = byEmail.get(email);
      if (existing && !existing.role && p.role) existing.role = p.role;
      continue;
    }
    byEmail.set(email, {
      email,
      name: (p.name || '').trim() || email,
      contact_id: p.contact_id ?? null,
      role: p.role ?? null,
      primary: !!p.primary,
      last_in: null, last_out: null, last_met: null, last_at: null,
      days: null, pace: 'never', line: '',
    });
  }

  let last: DealLastTouch | null = null;
  let lastIn: string | null = null;
  let lastOut: string | null = null;
  let heard: { at: string; email: string | null } | null = null;

  for (const t of input.touches) {
    if (!t.at || !Number.isFinite(Date.parse(t.at)) || Date.parse(t.at) > now + 60_000) continue;
    const email = t.email ? t.email.trim().toLowerCase() : null;
    const person = email ? byEmail.get(email) : undefined;
    if (person) {
      if (t.kind === 'email_in') person.last_in = latest(person.last_in, t.at);
      else if (t.kind === 'email_out') person.last_out = latest(person.last_out, t.at);
      else person.last_met = latest(person.last_met, t.at);
    }
    if (t.kind === 'email_in') lastIn = latest(lastIn, t.at);
    if (t.kind === 'email_out') lastOut = latest(lastOut, t.at);
    if (t.kind !== 'email_out' && (!heard || t.at > heard.at)) heard = { at: t.at, email };

    if (!last || t.at > last.at) {
      last = {
        at: t.at,
        by: t.kind === 'email_in' ? 'them' : t.kind === 'email_out' ? 'you' : 'both',
        kind: t.kind === 'meeting' ? 'meeting' : t.kind === 'call' ? 'call' : 'email',
        email,
        name: person?.name ?? null,
      };
    }
  }

  const people = [...byEmail.values()];
  for (const p of people) {
    p.last_at = latest(p.last_in, p.last_out, p.last_met);
    p.days = daysSince(p.last_at, now);
    p.pace = paceOf(p.days);
    p.line = personLine(p, now, input.windowDays);
  }
  people.sort((a, b) => {
    if (!a.last_at !== !b.last_at) return a.last_at ? -1 : 1;
    if (a.last_at && b.last_at && a.last_at !== b.last_at) return b.last_at.localeCompare(a.last_at);
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const days_since = daysSince(last?.at ?? null, now);
  const last_heard = heard ? { at: heard.at, email: heard.email, name: heard.email ? byEmail.get(heard.email)?.name ?? null : null } : null;
  const ball: DealContactActivity['ball'] = lastIn && (!lastOut || lastIn > lastOut) ? 'you' : lastOut ? 'them' : null;

  const result: DealContactActivity = {
    last,
    last_heard,
    days_since,
    days_since_heard: daysSince(last_heard?.at ?? null, now),
    pace: paceOf(days_since),
    ball,
    people,
    engaged: people.filter((p) => p.last_in || p.last_met).length,
    total: people.length,
    sentence: '',
  };
  result.sentence = dealContactSentence(result, input.windowDays);
  return result;
}

function personLine(p: DealPersonContact, now: number, windowDays?: number): string {
  if (!p.last_at) return windowDays ? `No contact in the last ${windowDays} days` : 'Not contacted yet';
  const inDays = daysSince(p.last_in, now);
  const outDays = daysSince(p.last_out, now);
  const metDays = daysSince(p.last_met, now);
  if (p.last_met && p.last_met === p.last_at) return `Met ${agoLabel(metDays)}`;
  if (p.last_in && (!p.last_out || p.last_in >= p.last_out)) return `Replied ${agoLabel(inDays)}, waiting on you`;
  if (p.last_out && p.last_in) return `You emailed ${agoLabel(outDays)} · replied ${agoLabel(inDays)}`;
  if (p.last_out && p.last_met) return `You emailed ${agoLabel(outDays)} · met ${agoLabel(metDays)}`;
  return `You emailed ${agoLabel(outDays)}, no reply yet`;
}

export function dealContactSentence(a: Pick<DealContactActivity, 'last' | 'last_heard' | 'days_since' | 'days_since_heard'>, windowDays?: number): string {
  if (!a.last) {
    return windowDays
      ? `No emails or meetings with anyone on this deal in the last ${windowDays} days`
      : 'Nobody on this deal has been emailed or met yet';
  }
  const who = a.last.name ? firstName(a.last.name) : a.last.email || 'them';
  const when = agoLabel(a.days_since);
  if (a.last.kind === 'meeting') return `Met with ${who} ${when}`;
  if (a.last.kind === 'call') return `Spoke to ${who} ${when}`;
  if (a.last.by === 'them') return `${a.last.name ? who : 'They'} replied ${when}`;
  const heard = a.last_heard
    ? `, last heard from ${a.last_heard.name ? firstName(a.last_heard.name) : 'them'} ${agoLabel(a.days_since_heard)}`
    : ', no reply from anyone yet';
  return `You emailed ${who} ${when}${heard}`;
}

/** Short card label: "Sarah replied 3d", "You emailed 12d", "No contact yet". */
export function dealContactShort(a: DealContactActivity | null | undefined): string {
  if (!a || !a.last) return 'No contact yet';
  const who = a.last.name ? firstName(a.last.name) : null;
  const ago = agoShort(a.days_since);
  const tail = ago === 'today' ? 'today' : `${ago} ago`;
  if (a.last.kind === 'meeting') return `Met${who ? ` ${who}` : ''} ${tail}`;
  if (a.last.kind === 'call') return `Call${who ? ` with ${who}` : ''} ${tail}`;
  if (a.last.by === 'them') return `${who || 'They'} replied ${tail}`;
  return `Emailed${who ? ` ${who}` : ''} ${tail}`;
}

/**
 * The same read from what the deal page already loaded: the deal, its
 * people, its emails and its meetings. No extra request, and it works on
 * closed deals too, which the board's read leaves out.
 */
export function dealContactFromDetail(detail: {
  deal: { contact_id?: string | null; contact_name?: string | null; contact_email?: string | null; contact?: { id?: string | null; email?: string | null; first_name?: string | null; last_name?: string | null } | null };
  participants: Array<{ contact_id?: string | null; role?: string | null; contact?: { email?: string | null; first_name?: string | null; last_name?: string | null } | null }>;
  emails: Array<{ from_email: string | null; to_email: string | null; direction: string | null; received_at: string; auto_reply_kind?: string | null }>;
  events: Array<{ starts_at: string; type?: string | null; status?: string | null; contact_email?: string | null }>;
}, now: Date | number = Date.now()): DealContactActivity {
  const t = now instanceof Date ? now.getTime() : now;
  const nameOf = (c: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
    [c?.first_name, c?.last_name].filter(Boolean).join(' ') || null;
  const d = detail.deal;
  const people: DealPersonInput[] = [];
  const primaryEmail = d.contact?.email || d.contact_email;
  if (primaryEmail) {
    people.push({ email: primaryEmail, name: nameOf(d.contact) || d.contact_name || null, contact_id: d.contact?.id ?? d.contact_id ?? null, primary: true });
  }
  for (const p of detail.participants) {
    if (p.contact?.email) people.push({ email: p.contact.email, name: nameOf(p.contact), contact_id: p.contact_id ?? null, role: p.role ?? null });
  }
  const addrs = new Set(people.map((p) => p.email.trim().toLowerCase()));

  const touches: DealTouchInput[] = [];
  for (const m of detail.emails) {
    if (m.auto_reply_kind) continue;
    const from = String(m.from_email || '').trim().toLowerCase();
    const inbound = m.direction === 'inbound' || (m.direction !== 'outbound' && addrs.has(from));
    touches.push({ at: m.received_at, kind: inbound ? 'email_in' : 'email_out', email: inbound ? from : String(m.to_email || '').trim().toLowerCase() || null });
  }
  for (const e of detail.events) {
    if (e.status === 'cancelled' || e.status === 'no_show') continue;
    if (Date.parse(e.starts_at) > t) continue;
    touches.push({ at: e.starts_at, kind: e.type === 'call' ? 'call' : 'meeting', email: e.contact_email || null });
  }
  return dealContactActivity({ people, touches, now: t });
}
