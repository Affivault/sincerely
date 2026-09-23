/* ═══════════════════════════════════════════════════════════════════════
   The command bar, read as a sentence.

   The palette already finds records and creates activities from a typed
   line ("call ada tomorrow 3pm"). This reads the other half of what people
   type into a box like that - instructions and questions:

     pause acme.com                     hold every sequence to that company
     stop emailing bob@acme.com         the same, for one person
     resume acme.com                    let them go again
     add jane@acme.com to Q4 outbound   enrol somebody in a campaign by name
     deals over 10k closing this month  a filtered pipeline, answered inline
     at risk deals / stalled deals in proposal

   Deliberately a small grammar rather than a guess: a command that pauses
   outreach has to mean exactly what it says, and anything this does not
   recognise falls through to plain search.
   ═══════════════════════════════════════════════════════════════════════ */

import type { DealStage } from './crm.types.js';
import { parseDay } from './format-date.js';

export interface DealQuery {
  min_value?: number;
  max_value?: number;
  closing?: 'this_week' | 'this_month' | 'next_month' | 'overdue';
  health?: 'at_risk' | 'watch';
  stalled?: boolean;
  stage?: DealStage;
  /** Free words left over, matched against title/company. */
  text?: string;
}

export type CommandIntent =
  | { kind: 'pause_recipient'; target: string }
  | { kind: 'resume_recipient'; target: string }
  | { kind: 'enroll'; email: string; campaign: string }
  | { kind: 'deal_query'; query: DealQuery; label: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function isTarget(s: string): boolean {
  return EMAIL.test(s) || DOMAIN.test(s);
}

/** "10k" -> 10000, "1.5m" -> 1500000, "$2,500" -> 2500. */
export function parseAmount(raw: string): number | null {
  const m = /^[$€£]?\s*([\d,.]+)\s*([km])?$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult);
}

const STAGE_WORDS: Record<string, DealStage> = {
  lead: 'lead', leads: 'lead', qualified: 'qualified', proposal: 'proposal', proposals: 'proposal',
};

export function parseCommand(input: string): CommandIntent | null {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // pause / stop (emailing|everything to|outreach to) <target>
  let m = /^(?:pause|stop|hold)(?:\s+(?:emailing|mailing|everything\s+to|all\s+outreach\s+to|outreach\s+to|sequences\s+to|sending\s+to))?\s+(\S+)$/.exec(lower);
  if (m && isTarget(m[1])) return { kind: 'pause_recipient', target: m[1] };

  m = /^(?:resume|unpause|restart)(?:\s+(?:emailing|everything\s+to|outreach\s+to|sequences\s+to|sending\s+to))?\s+(\S+)$/.exec(lower);
  if (m && isTarget(m[1])) return { kind: 'resume_recipient', target: m[1] };

  // add|enrol <email> to|into <campaign name>
  m = /^(?:add|enrol|enroll|put)\s+(\S+@\S+)\s+(?:to|into|in)\s+(?:the\s+)?(?:campaign\s+)?(.+)$/i.exec(raw);
  if (m && EMAIL.test(m[1])) {
    const campaign = m[2].replace(/\s+campaign$/i, '').replace(/^["']|["']$/g, '').trim();
    if (campaign) return { kind: 'enroll', email: m[1].toLowerCase(), campaign };
  }

  // Anything that talks about deals.
  if (!/\bdeals?\b|\bpipeline\b|\bopportunit/.test(lower)) return null;
  const q: DealQuery = {};
  const parts: string[] = [];

  const over = /(?:over|above|more than|>)\s*([$€£]?[\d.,]+\s*[km]?)/.exec(lower);
  if (over) { const n = parseAmount(over[1]); if (n !== null) { q.min_value = n; parts.push(`over ${over[1].trim()}`); } }
  const under = /(?:under|below|less than|<)\s*([$€£]?[\d.,]+\s*[km]?)/.exec(lower);
  if (under) { const n = parseAmount(under[1]); if (n !== null) { q.max_value = n; parts.push(`under ${under[1].trim()}`); } }

  if (/closing (?:this )?week/.test(lower)) { q.closing = 'this_week'; parts.push('closing this week'); }
  else if (/closing next month/.test(lower)) { q.closing = 'next_month'; parts.push('closing next month'); }
  else if (/closing (?:this )?month|closing soon/.test(lower)) { q.closing = 'this_month'; parts.push('closing this month'); }
  else if (/overdue|past (?:their )?close|late/.test(lower)) { q.closing = 'overdue'; parts.push('past close date'); }

  if (/at[- ]risk|dying|in trouble/.test(lower)) { q.health = 'at_risk'; parts.push('at risk'); }
  else if (/need(?:s|ing)? attention|watch/.test(lower)) { q.health = 'watch'; parts.push('needing attention'); }
  if (/stalled|stuck|rotting|not moving/.test(lower)) { q.stalled = true; parts.push('stalled'); }

  for (const [word, stage] of Object.entries(STAGE_WORDS)) {
    if (new RegExp(`\\b(?:in|at)\\s+${word}\\b`).test(lower)) { q.stage = stage; parts.push(`in ${stage}`); break; }
  }

  // "deals with acme" / "acme deals"
  const withWho = /deals?\s+(?:with|for|at)\s+([a-z0-9][\w .&-]*?)(?:\s+(?:over|under|closing|in|at|that)\b|$)/.exec(lower);
  if (withWho && !STAGE_WORDS[withWho[1].trim()]) { q.text = withWho[1].trim(); parts.push(`with ${q.text}`); }

  if (parts.length === 0) return null;
  return { kind: 'deal_query', query: q, label: `Deals ${parts.join(', ')}` };
}

interface DealLike {
  title: string;
  company: string | null;
  value: number;
  stage: DealStage;
  expected_close_date: string | null;
}

/** Apply a parsed deal query. `stalled` and `health` are supplied by the caller. */
export function matchesDealQuery(
  d: DealLike,
  q: DealQuery,
  extra: { stalled?: boolean; grade?: 'healthy' | 'watch' | 'at_risk' | null } = {},
  now: Date = new Date(),
): boolean {
  const open = d.stage === 'lead' || d.stage === 'qualified' || d.stage === 'proposal';
  if (!open) return false;
  if (q.min_value !== undefined && !(Number(d.value) > q.min_value)) return false;
  if (q.max_value !== undefined && !(Number(d.value) < q.max_value)) return false;
  if (q.stage && d.stage !== q.stage) return false;
  if (q.stalled && !extra.stalled) return false;
  if (q.health === 'at_risk' && extra.grade !== 'at_risk') return false;
  if (q.health === 'watch' && extra.grade !== 'watch' && extra.grade !== 'at_risk') return false;
  if (q.text) {
    const hay = `${d.title} ${d.company || ''}`.toLowerCase();
    if (!hay.includes(q.text.toLowerCase())) return false;
  }
  if (q.closing) {
    // A bare date is that calendar day here, not UTC midnight.
    const close = parseDay(d.expected_close_date);
    if (!close) return false;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (q.closing === 'overdue') return close < today;
    if (close < today) return false;
    if (q.closing === 'this_week') {
      const end = new Date(today); end.setDate(end.getDate() + (7 - end.getDay()));
      return close <= end;
    }
    if (q.closing === 'this_month') return close.getFullYear() === now.getFullYear() && close.getMonth() === now.getMonth();
    if (q.closing === 'next_month') {
      const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return close.getFullYear() === nm.getFullYear() && close.getMonth() === nm.getMonth();
    }
  }
  return true;
}
