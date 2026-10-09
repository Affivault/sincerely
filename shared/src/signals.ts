/* ═══════════════════════════════════════════════════════════════════════
   Moments: who to email today, and why.

   A cold email lands when something has just changed for the reader. This
   finds those changes, from two places:

     1. What the account already knows. Someone who went quiet is reading
        again; a "not now" whose time has come; a lost deal three months
        on; several people at one company engaging in the same week; a yes
        that never became a meeting; a past replier who has moved on.
     2. The websites of companies already in the account's lists. A new
        careers listing, a news post, a new product page - judged against
        what THIS account sells, so a logistics tool sees "hiring a fleet
        manager" and a recruiter sees "opening a Leeds office".

   Every moment carries its evidence. Nothing is shown that cannot be
   pointed at. This file is the pure part: kinds, ranking, reading "come
   back in Q2", and turning web pages into comparable text.
   ═══════════════════════════════════════════════════════════════════════ */

export const SIGNAL_KINDS = [
  're_engaged', 'not_now_due', 'lost_deal_return', 'company_buzz', 'stalled_positive', 'left_company', 'web_change',
] as const;
export type SignalKind = typeof SIGNAL_KINDS[number];

export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  re_engaged: 'Reading again',
  not_now_due: 'The time they gave is here',
  lost_deal_return: 'Lost deal, three months on',
  company_buzz: 'Several people engaging',
  stalled_positive: 'Said yes, then went quiet',
  left_company: 'Moved on',
  web_change: 'Changed on their website',
};

export type SignalStatus = 'new' | 'acted' | 'dismissed';

export interface SignalPerson {
  id: string;
  name: string | null;
  email: string;
  title: string | null;
}

export interface Signal {
  id: string;
  kind: SignalKind;
  /** One factual line: what happened. */
  headline: string;
  /** Why it is a reason to write now, in a sentence. */
  detail: string | null;
  evidence_url: string | null;
  /** Words from the source, verbatim, when there are any. */
  evidence_quote: string | null;
  /** 1 weak, 2 good, 3 strong. */
  strength: 1 | 2 | 3;
  occurred_at: string;
  status: SignalStatus;
  /** A first line that mentions it, when Relay has written one. */
  opener: string | null;
  contact: SignalPerson | null;
  company: { id: string; name: string; domain: string | null } | null;
  /** Other people the account has at the company, best first - for company-level moments. */
  people: SignalPerson[];
  deal: { id: string; title: string } | null;
  score: number;
}

export interface SignalTopic { label: string; on: boolean }

export interface SignalSettings {
  /** Watch company websites. */
  web: boolean;
  /** What counts as a moment on a website, from this account's offer. */
  topics: SignalTopic[];
  /** Claude configured: website changes can be judged. */
  ai: boolean;
  /** Companies with a website and someone to email there. */
  watching: number;
  last_checked: string | null;
  /** False until migration 083. */
  ready: boolean;
}

/** Used when Claude cannot suggest topics from the offer. */
export const DEFAULT_SIGNAL_TOPICS: string[] = [
  'Hiring for a role my product helps',
  'A new product or service launch',
  'Opening a new office or entering a new market',
  'A new leader in the team I sell to',
];

/* ── Ranking ───────────────────────────────────────────────────────── */

const DAY = 86_400_000;
export const SIGNAL_HALF_LIFE_DAYS = 7;
/** Moments older than this are not shown. */
export const SIGNAL_MAX_AGE_DAYS = 30;

/** Strength, fading by half every week. */
export function signalScore(strength: number, occurredAt: string, now = Date.now()): number {
  const age = Math.max(0, (now - Date.parse(occurredAt)) / DAY);
  return Math.round(Math.max(1, Math.min(3, strength)) * 0.5 ** (age / SIGNAL_HALF_LIFE_DAYS) * 1000) / 1000;
}

/** ISO year-week, for "once per person per week" keys. */
export function isoWeek(at: number | string | Date): string {
  const d = new Date(typeof at === 'number' ? at : Date.parse(String(at instanceof Date ? at.toISOString() : at)));
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/* ── "Try me again in Q2" ──────────────────────────────────────────── */

export interface ComeBack {
  /** The calendar day to come back on. */
  due: string;
  /** The words it was read from, or null when it is the default. */
  phrase: string | null;
}

/** With no time given, "not now" is taken to mean about three months. */
export const NOT_NOW_DEFAULT_DAYS = 90;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUM_WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3, several: 4 };

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m, d);

/** The next time a month (0-11) starts, strictly after `from`. */
function nextMonthStart(month: number, from: number): number {
  const f = new Date(from);
  let y = f.getUTCFullYear();
  if (utc(y, month) <= from) y += 1;
  return utc(y, month);
}

/**
 * When a "not now" asked to be contacted again. Reads the common ways
 * people say it - "next quarter", "Q2", "in a couple of months", "after
 * the summer", "in January", "next year" - and falls back to three months.
 */
export function comeBackDate(text: string, receivedAt: number | string | Date = Date.now()): ComeBack {
  const from = typeof receivedAt === 'number' ? receivedAt : Date.parse(receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt);
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ');
  const f = new Date(from);
  const y = f.getUTCFullYear(); const m = f.getUTCMonth();
  const hit = (re: RegExp) => re.exec(t);
  let due: number | null = null; let phrase: string | null = null;
  let r: RegExpExecArray | null;

  if ((r = hit(/\bin (\d+|a|an|one|two|three|four|five|six|a couple of|a few|several|couple of|few) (day|week|month)s?\b/))) {
    const raw = r[1].replace(/^a (couple|few) of$/, '$1').replace(/ of$/, '');
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUM_WORD[raw] ?? 1);
    due = from + n * (r[2] === 'day' ? 1 : r[2] === 'week' ? 7 : 30) * DAY;
    phrase = r[0];
  } else if ((r = hit(/\bnext week\b/))) {
    due = from + 7 * DAY; phrase = r[0];
  } else if ((r = hit(/\bnext month\b/))) {
    due = utc(y, m + 1); phrase = r[0];
  } else if ((r = hit(/\bnext quarter\b/))) {
    due = utc(y, (Math.floor(m / 3) + 1) * 3); phrase = r[0];
  } else if ((r = hit(/\bq([1-4])(?:\s*(?:of\s*)?(20\d\d))?\b/))) {
    const q = Number(r[1]) - 1;
    const year = r[2] ? Number(r[2]) : (utc(y, q * 3) <= from ? y + 1 : y);
    due = utc(year, q * 3); phrase = r[0];
  } else if ((r = hit(/\b(after|end of) (the )?summer\b/))) {
    due = nextMonthStart(8, from); phrase = r[0];
  } else if ((r = hit(/\b(after (christmas|the holidays|the new year)|in the new year|new year)\b/))) {
    due = nextMonthStart(0, from) + 7 * DAY; phrase = r[0];
  } else if ((r = hit(/\bnext year\b/))) {
    due = utc(y + 1, 0, 10); phrase = r[0];
  } else if ((r = hit(/\b(end of (the|this) year|later this year|towards the end of the year)\b/))) {
    due = Math.max(utc(y, 10), from + 30 * DAY); phrase = r[0];
  } else if ((r = hit(new RegExp(`\\b(in|after|from|around|until|till|before|early|mid|late|start of|end of) ${MONTH_WORD}\\b`)))) {
    const month = MONTHS.indexOf(r[2].slice(0, 3));
    let start = nextMonthStart(month, from);
    if (r[1] === 'after' || r[1] === 'end of' || r[1] === 'late') start = nextMonthStart((month + 1) % 12, start - DAY);
    else if (r[1] === 'mid') start += 14 * DAY;
    due = start; phrase = r[0];
  }

  // Implausible readings fall back to the default.
  if (due === null || due <= from || due - from > 400 * DAY) {
    return { due: ymd(from + NOT_NOW_DEFAULT_DAYS * DAY), phrase: null };
  }
  return { due: ymd(due), phrase };
}

/* ── Web pages as comparable text ──────────────────────────────────── */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-', hellip: '...' };

/** The words a person would read on a page, one block per line. */
export function pageText(html: string, maxChars = 20_000): string {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|br|tr|td|th|section|article|header|footer|nav|main|aside|a|button|span|dt|dd)\b[^>]*>/gi, (tag) => (/^<\/?(span|a)\b/i.test(tag) ? ' ' : '\n'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (all, e) => ENTITIES[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCharCode(Number(e.slice(1).replace(/^x/i, '0x')) || 32) : all))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3)
    .join('\n')
    .slice(0, maxChars);
}

/** Counters, dates and years differ on every visit; they are not news. */
const comparable = (line: string) => line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * What a page says now that it did not say before, line by line. Lines
 * that differ only in numbers (dates, "3 days ago", counters) do not count.
 */
export function addedText(before: string, after: string, maxChars = 4000): string {
  const seen = new Set((before || '').split('\n').map(comparable));
  const out: string[] = [];
  const mine = new Set<string>();
  for (const line of (after || '').split('\n')) {
    const key = comparable(line);
    if (!key || seen.has(key) || mine.has(key)) continue;
    mine.add(key);
    out.push(line);
  }
  return out.join('\n').slice(0, maxChars);
}

/** A cheap fingerprint of a page's comparable text. */
export function pageFingerprint(text: string): string {
  const s = (text || '').split('\n').map(comparable).join('\n');
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}:${s.length}`;
}

export type WatchPageKind = 'home' | 'careers' | 'news';

const CAREERS = /\b(careers?|jobs?|vacanc(y|ies)|join[-_ ]?(us|the[-_ ]team|our[-_ ]team)|work[-_ ]with[-_ ]us|we'?re[-_ ]hiring|hiring|open[-_ ]?(roles|positions)|opportunities)\b/i;
const NEWS = /\b(news|press|newsroom|media|blog|announcements?|updates|insights|stories|whats[-_ ]new|what'?s[-_ ]new)\b/i;
/** Job boards companies send their careers link to. */
const ATS_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|recruitee\.com|teamtailor\.com|personio\.(de|com)|bamboohr\.com|smartrecruiters\.com|breezy\.hr|jobs\.workday\.com|myworkdayjobs\.com)$/i;

function sameSite(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase().replace(/^www\./, '');
  return h === d || h.endsWith(`.${d}`);
}

/**
 * The careers and news pages a homepage links to, on the company's own
 * site (or a job board for careers). Their own site beats a job board,
 * then the shortest path wins, for each kind.
 */
export function findWatchPages(html: string, pageUrl: string, domain: string): Array<{ kind: WatchPageKind; url: string }> {
  const best: Partial<Record<WatchPageKind, string>> = {};
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    let url: URL;
    try { url = new URL(m[1], pageUrl); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const pathish = `${url.pathname} ${text}`;
    const own = sameSite(url.hostname, domain);
    let kind: WatchPageKind | null = null;
    if (CAREERS.test(pathish) && (own || ATS_HOSTS.test(url.hostname))) kind = 'careers';
    else if (NEWS.test(pathish) && own) kind = 'news';
    if (!kind) continue;
    url.hash = '';
    const candidate = url.toString();
    const current = best[kind];
    // Their own page beats a job board; then the shortest path.
    const currentOwn = current ? sameSite(new URL(current).hostname, domain) : false;
    const better = !current
      || (own && !currentOwn)
      || (own === currentOwn && url.pathname.length < new URL(current).pathname.length);
    if (better) best[kind] = candidate;
  }
  return (Object.entries(best) as Array<[WatchPageKind, string]>).map(([kind, url]) => ({ kind, url }));
}

/* ── robots.txt ────────────────────────────────────────────────────── */

export const WATCH_USER_AGENT = 'SincerelyBot';

/** Whether robots.txt lets SincerelyBot read a path. Longest matching rule wins; ties go to Allow. */
export function robotsAllows(robots: string, path: string, agent = WATCH_USER_AGENT): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; prefix: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of (robots || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const mm = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!mm) continue;
    const key = mm[1].toLowerCase(); const value = mm[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (key === 'disallow' && !value) continue;
      current.rules.push({ allow: key === 'allow', prefix: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let verdict: { allow: boolean; len: number } | null = null;
  for (const g of applicable) {
    for (const rule of g.rules) {
      const prefix = rule.prefix.replace(/\*$/, '');
      if (!path.startsWith(prefix)) continue;
      if (!verdict || prefix.length > verdict.len || (prefix.length === verdict.len && rule.allow)) {
        verdict = { allow: rule.allow, len: prefix.length };
      }
    }
  }
  return verdict ? verdict.allow : true;
}
