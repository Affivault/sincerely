/* ═══════════════════════════════════════════════════════════════════════
   Universal search.

   One query across every object the user owns, so finding a person is two
   keystrokes rather than three navigation decisions. Also home to the
   quick-add parser: typing "call ada tomorrow 3pm" should offer to create
   that activity outright instead of making you open a form.
   ═══════════════════════════════════════════════════════════════════════ */

export type SearchHitType =
  | 'contact' | 'company' | 'deal' | 'campaign' | 'list' | 'activity' | 'meeting' | 'template' | 'message';

export interface SearchHit {
  id: string;
  type: SearchHitType;
  /** Primary line — a name, a title, a subject. */
  title: string;
  /** Secondary line — email, company, stage, due date. */
  subtitle?: string | null;
  /** Right-aligned hint — a value, a count, a date. */
  meta?: string | null;
  /** Where selecting it takes you. */
  href: string;
}

export interface SearchResults {
  hits: SearchHit[];
  /** Server-side duration, surfaced in the palette footer. */
  took_ms: number;
}

export const SEARCH_TYPE_LABEL: Record<SearchHitType, string> = {
  contact: 'People',
  company: 'Companies',
  deal: 'Deals',
  campaign: 'Campaigns',
  list: 'Lead lists',
  activity: 'Activities',
  meeting: 'Meetings',
  template: 'Templates',
  message: 'Emails',
};

/* ── Quick add ────────────────────────────────────────────────────────── */

export type QuickAddKind = 'call' | 'meeting' | 'email' | 'todo' | 'deal';

export interface QuickAdd {
  kind: QuickAddKind;
  /** What's left once the verb and any date/time words are removed. */
  subject: string;
  /** Resolved moment, when the text carried one. */
  when: string | null;
  /** How the parsed time reads back, for confirmation in the palette. */
  whenLabel: string | null;
}

const VERBS: Array<{ words: string[]; kind: QuickAddKind }> = [
  { words: ['call', 'ring', 'phone'], kind: 'call' },
  { words: ['meet', 'meeting'], kind: 'meeting' },
  { words: ['email', 'mail'], kind: 'email' },
  { words: ['task', 'todo', 'remind', 'follow'], kind: 'todo' },
  { words: ['deal', 'opportunity'], kind: 'deal' },
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// 3-letter prefixes that double as ordinary English words ("sun", "sat", "wed")
// are excluded from abbreviation matching below — otherwise "email team about
// sun campaign" gets misread as a date reference to next Sunday.
const AMBIGUOUS_DAY_ABBREVIATIONS = new Set(['sun', 'sat', 'wed']);

/** Words consumed by date parsing, so they don't end up in the subject. */
interface DateMatch {
  at: Date;
  label: string;
  consumed: string[];
  /** Set for matches that already resolved an exact moment ("in 30 min") —
   *  skips the default 9am / explicit-time layering applied to bare dates. */
  precise?: boolean;
}

function atTime(base: Date, hours: number, minutes: number): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Pull a time-of-day out of the token stream: `3pm`, `3:30pm`, `15:00`, `9am`.
 * Returns null rather than guessing — a bare number is far more likely to be
 * part of the subject ("call 3 brokers") than a time.
 */
function matchTime(tokens: string[]): { hours: number; minutes: number; token: string } | null {
  for (const t of tokens) {
    const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(t);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      if (h > 12 || min > 59) continue;
      const pm = m[3].toLowerCase() === 'pm';
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
      return { hours: h, minutes: min, token: t };
    }
    const m24 = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m24) {
      const h = parseInt(m24[1], 10);
      const min = parseInt(m24[2], 10);
      if (h < 24 && min < 60) return { hours: h, minutes: min, token: t };
    }
  }
  return null;
}

function matchDate(tokens: string[], now: Date): DateMatch | null {
  const lower = tokens.map((t) => t.toLowerCase());

  for (let i = 0; i < lower.length; i++) {
    const t = lower[i];

    if (t === 'today' || t === 'tonight') {
      return { at: new Date(now), label: 'today', consumed: [tokens[i]] };
    }
    if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return { at: d, label: 'tomorrow', consumed: [tokens[i]] };
    }

    // "in 3 days" / "in 2 weeks"
    if (t === 'in' && i + 2 < lower.length) {
      const n = parseInt(lower[i + 1], 10);
      const unit = lower[i + 2];
      if (Number.isFinite(n) && n > 0) {
        if (unit.startsWith('day')) {
          const d = new Date(now);
          d.setDate(d.getDate() + n);
          return { at: d, label: `in ${n} day${n === 1 ? '' : 's'}`, consumed: [tokens[i], tokens[i + 1], tokens[i + 2]] };
        }
        if (unit.startsWith('week')) {
          const d = new Date(now);
          d.setDate(d.getDate() + n * 7);
          return { at: d, label: `in ${n} week${n === 1 ? '' : 's'}`, consumed: [tokens[i], tokens[i + 1], tokens[i + 2]] };
        }
        if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') {
          const d = new Date(now);
          d.setMinutes(d.getMinutes() + n * 60);
          return { at: d, label: `in ${n} hour${n === 1 ? '' : 's'}`, consumed: [tokens[i], tokens[i + 1], tokens[i + 2]], precise: true };
        }
        if (unit.startsWith('min')) {
          const d = new Date(now);
          d.setMinutes(d.getMinutes() + n);
          return { at: d, label: `in ${n} minute${n === 1 ? '' : 's'}`, consumed: [tokens[i], tokens[i + 1], tokens[i + 2]], precise: true };
        }
      }
    }

    // "monday" / "next monday" / "mon"
    const next = t === 'next' && i + 1 < lower.length;
    const dayToken = next ? lower[i + 1] : t;
    const dayIdx = WEEKDAYS.findIndex((w) =>
      w === dayToken || (!AMBIGUOUS_DAY_ABBREVIATIONS.has(dayToken) && w.slice(0, 3) === dayToken)
    );
    if (dayIdx !== -1) {
      const d = new Date(now);
      let delta = (dayIdx - d.getDay() + 7) % 7;
      // A bare weekday means the NEXT one — "monday" said on a Monday is a
      // week away, not this morning, which has already happened.
      if (delta === 0) delta = 7;
      if (next && delta < 7) delta += 7;
      d.setDate(d.getDate() + delta);
      const label = next ? `next ${WEEKDAYS[dayIdx]}` : WEEKDAYS[dayIdx];
      return { at: d, label, consumed: next ? [tokens[i], tokens[i + 1]] : [tokens[i]] };
    }
  }
  return null;
}

/**
 * Turn a typed line into a create-this intent, or null when it isn't one.
 *
 * `now` is injectable so the behaviour is deterministic under test.
 */
export function parseQuickAdd(input: string, now: Date = new Date()): QuickAdd | null {
  const raw = input.trim();
  if (!raw) return null;

  const tokens = raw.split(/\s+/);
  const first = tokens[0].toLowerCase().replace(/[^a-z]/g, '');
  const verb = VERBS.find((v) => v.words.includes(first));
  if (!verb) return null;

  let rest = tokens.slice(1);
  // "follow up with ada" — treat the particle as part of the verb.
  if (first === 'follow' && rest[0]?.toLowerCase() === 'up') rest = rest.slice(1);
  if (rest.length === 0) return null;

  const time = matchTime(rest);
  const withoutTime = time ? rest.filter((t) => t !== time.token) : rest;
  const date = matchDate(withoutTime, now);

  const consumed = new Set((date?.consumed || []).map((c) => c.toLowerCase()));
  // A precise relative-time phrase ("in 30 min") wins over an explicit clock
  // time ("3pm") below and never reads `time` at all — so if we built the
  // subject from `withoutTime`, the clock time would vanish with no trace
  // instead of at least surviving as plain subject text.
  const subjectSource = date?.precise && time ? rest : withoutTime;
  const subjectTokens = subjectSource.filter((t) => !consumed.has(t.toLowerCase()));
  // Trailing connectives left dangling by removing the date read badly.
  while (subjectTokens.length && ['on', 'at', 'this', 'with'].includes(subjectTokens[subjectTokens.length - 1].toLowerCase())) {
    subjectTokens.pop();
  }
  const subject = subjectTokens.join(' ').trim();
  if (!subject) return null;

  let when: Date | null = null;
  let whenLabel: string | null = null;

  if (date?.precise) {
    when = date.at;
    whenLabel = date.label;
  } else if (date) {
    when = atTime(date.at, time ? time.hours : 9, time ? time.minutes : 0);
    whenLabel = time ? `${date.label} at ${formatClock(when)}` : date.label;
  } else if (time) {
    // A time with no day means today — unless today's has passed.
    let candidate = atTime(now, time.hours, time.minutes);
    if (candidate.getTime() <= now.getTime()) {
      candidate = new Date(candidate);
      candidate.setDate(candidate.getDate() + 1);
      whenLabel = `tomorrow at ${formatClock(candidate)}`;
    } else {
      whenLabel = `today at ${formatClock(candidate)}`;
    }
    when = candidate;
  }

  return {
    kind: verb.kind,
    subject,
    when: when ? when.toISOString() : null,
    whenLabel,
  };
}

function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}
