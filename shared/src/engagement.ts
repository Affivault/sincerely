/* ═══════════════════════════════════════════════════════════════════════
   How warm is this person, 0 to 100.

   The contacts list could say who someone is and whether their address
   works, but not whether they have been paying attention - which is the
   question somebody is asking when they scroll a list looking for who to
   call. This answers it from what they did, not from what we sent.

   What counts, and how much:

       a reply from a person     8 points
       a meeting that happened  12 points
       a click                   3 points
       an open                   1 point, and opens together never more
                                 than 6: an open is the weakest evidence
                                 there is, and one forwarded thread can
                                 rack up dozens

   Only human opens. 'machine_open' (085) is a mail scanner or a privacy
   proxy fetching the pixel, and counting it would make every Apple Mail
   recipient look engaged. Auto-replies are not replies. A cancelled meeting
   or a no-show did not happen.

   Every point fades with a 30-day half-life: a reply last week is worth
   most of 8, one last spring is worth almost nothing. That decay is what
   lets the score fall on its own when somebody goes quiet, without anybody
   having to mark them cold.

   The faded total is squashed onto 0-100 with 1 - e^(-raw/12), so the
   scale saturates rather than overflowing: one fresh reply is about 49,
   a reply and a meeting about 81, and nothing gets to 100 by being opened
   a lot.

   This is the one definition. The server's engagement job and the contact
   page's breakdown both call it, and contact-hygiene-check.mts pins it.
   ═══════════════════════════════════════════════════════════════════════ */

export type EngagementKind = 'open' | 'click' | 'reply' | 'meeting';

export interface EngagementEvent {
  kind: EngagementKind;
  /** When it happened: an ISO string or a Date. */
  at: string | Date;
}

export const ENGAGEMENT_WEIGHTS: Record<EngagementKind, number> = {
  open: 1,
  click: 3,
  reply: 8,
  meeting: 12,
};

/** Opens together never contribute more than this, before squashing. */
export const ENGAGEMENT_OPEN_CAP = 6;
/** Days for an event's weight to halve. */
export const ENGAGEMENT_HALF_LIFE_DAYS = 30;
/** Events older than this are not even fetched: they are worth under 2%. */
export const ENGAGEMENT_WINDOW_DAYS = 180;
/** The raw total that maps to about 63 on the 0-100 scale. */
const SCALE = 12;

const DAY_MS = 86_400_000;

export interface EngagementFactor {
  kind: EngagementKind;
  count: number;
  /** This kind's share of the final score, in score points. */
  points: number;
}

export interface EngagementResult {
  score: number;
  factors: EngagementFactor[];
  /** The most recent counted event, or null when there was none. */
  last_at: string | null;
}

/** The compact form stored on contacts.engagement_factors. */
export interface StoredEngagementFactors {
  opens: number;
  clicks: number;
  replies: number;
  meetings: number;
  last_at: string | null;
}

export function engagementScore(events: EngagementEvent[], now: Date = new Date()): EngagementResult {
  const raw: Record<EngagementKind, number> = { open: 0, click: 0, reply: 0, meeting: 0 };
  const count: Record<EngagementKind, number> = { open: 0, click: 0, reply: 0, meeting: 0 };
  let last = 0;
  const nowMs = now.getTime();

  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || !(e.kind in ENGAGEMENT_WEIGHTS)) continue;
    // A meeting in the future has not happened yet, and a clock a little
    // ahead of ours is not a reason to drop an open.
    const ageDays = Math.max(0, (nowMs - t) / DAY_MS);
    if (t > nowMs + DAY_MS) continue;
    if (ageDays > ENGAGEMENT_WINDOW_DAYS) continue;
    raw[e.kind] += ENGAGEMENT_WEIGHTS[e.kind] * Math.pow(0.5, ageDays / ENGAGEMENT_HALF_LIFE_DAYS);
    count[e.kind] += 1;
    if (t > last) last = t;
  }
  raw.open = Math.min(raw.open, ENGAGEMENT_OPEN_CAP);

  const total = raw.open + raw.click + raw.reply + raw.meeting;
  const score = Math.round(100 * (1 - Math.exp(-total / SCALE)));

  const kinds: EngagementKind[] = ['reply', 'meeting', 'click', 'open'];
  const factors = kinds
    .filter((k) => count[k] > 0)
    .map((k) => ({
      kind: k,
      count: count[k],
      // Shared out in proportion to what each kind put in, so the parts
      // add up to the score a person sees.
      points: total > 0 ? Math.round((score * raw[k]) / total) : 0,
    }));

  return { score, factors, last_at: last > 0 ? new Date(last).toISOString() : null };
}

export function storedFactors(r: EngagementResult): StoredEngagementFactors {
  const n = (k: EngagementKind) => r.factors.find((f) => f.kind === k)?.count ?? 0;
  return { opens: n('open'), clicks: n('click'), replies: n('reply'), meetings: n('meeting'), last_at: r.last_at };
}

/** A word for a score, for a badge that has no room for a number's context. */
export function engagementBand(score: number | null | undefined): 'hot' | 'warm' | 'cool' | 'cold' {
  const s = score ?? 0;
  if (s >= 70) return 'hot';
  if (s >= 40) return 'warm';
  if (s >= 10) return 'cool';
  return 'cold';
}

const NOUN: Record<EngagementKind, [string, string]> = {
  open: ['open', 'opens'],
  click: ['click', 'clicks'],
  reply: ['reply', 'replies'],
  meeting: ['meeting', 'meetings'],
};

/** "2 replies (+31), 4 opens (+3)". The short "why" under a score. */
export function describeEngagement(factors: EngagementFactor[]): string {
  if (factors.length === 0) return 'No opens, clicks, replies or meetings in the last six months';
  return factors
    .map((f) => `${f.count} ${NOUN[f.kind][f.count === 1 ? 0 : 1]} (+${f.points})`)
    .join(', ');
}
