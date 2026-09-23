/* ═══════════════════════════════════════════════════════════════════════
   Who at an account is actually in the conversation.

   Deals are sold to groups, not to people, and the usual way one dies is
   that the only person talking to you cannot sign. A company page listing
   contacts alphabetically hides exactly that. This sorts them by where
   they stand - engaged, contacted but silent, never contacted - and reads
   seniority off the job title so the page can say plainly when nobody who
   can say yes has said anything.
   ═══════════════════════════════════════════════════════════════════════ */

export type CommitteeStanding = 'engaged' | 'contacted' | 'untouched';
export type CommitteeSeniority = 'decision_maker' | 'manager' | 'individual' | 'unknown';

export interface CommitteeMember {
  id: string;
  email: string;
  name: string;
  job_title: string | null;
  standing: CommitteeStanding;
  seniority: CommitteeSeniority;
  last_inbound_at: string | null;
}

export interface BuyingCommittee {
  members: CommitteeMember[];
  engaged: number;
  contacted: number;
  untouched: number;
  /** A decision maker is on the account and has written back. */
  decision_maker_engaged: boolean;
  /** One plain sentence on the gap, or null when there isn't one. */
  gap: string | null;
}

const DM = /\b(ceo|cfo|coo|cto|cmo|cro|cio|chief|founder|co-?founder|owner|president|partner|managing director|md|vp|vice president|head of|director|gm|general manager)\b/i;
const MGR = /\b(manager|lead|principal|senior manager|team lead)\b/i;

export function seniorityOf(title: string | null | undefined): CommitteeSeniority {
  const t = String(title || '').trim();
  if (!t) return 'unknown';
  if (DM.test(t)) return 'decision_maker';
  if (MGR.test(t)) return 'manager';
  return 'individual';
}

export function buyingCommittee(
  contacts: { id: string; email: string; first_name: string | null; last_name: string | null; job_title?: string | null }[],
  messages: { from_email: string; to_email: string; direction: 'inbound' | 'outbound'; received_at: string }[],
): BuyingCommittee {
  const inbound = new Map<string, string>();
  const outbound = new Set<string>();
  for (const m of messages) {
    if (m.direction === 'inbound') {
      const from = m.from_email.toLowerCase();
      if (!inbound.has(from) || m.received_at > inbound.get(from)!) inbound.set(from, m.received_at);
    } else {
      outbound.add(m.to_email.toLowerCase());
    }
  }
  const order: Record<CommitteeStanding, number> = { engaged: 0, contacted: 1, untouched: 2 };
  const rank: Record<CommitteeSeniority, number> = { decision_maker: 0, manager: 1, individual: 2, unknown: 3 };
  const members: CommitteeMember[] = contacts.map((c) => {
    const e = c.email.toLowerCase();
    const standing: CommitteeStanding = inbound.has(e) ? 'engaged' : outbound.has(e) ? 'contacted' : 'untouched';
    return {
      id: c.id, email: c.email,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
      job_title: c.job_title ?? null,
      standing,
      seniority: seniorityOf(c.job_title),
      last_inbound_at: inbound.get(e) || null,
    };
  }).sort((a, b) => order[a.standing] - order[b.standing] || rank[a.seniority] - rank[b.seniority] || a.name.localeCompare(b.name));

  const count = (s: CommitteeStanding) => members.filter((m) => m.standing === s).length;
  const engaged = count('engaged');
  const dmEngaged = members.some((m) => m.standing === 'engaged' && m.seniority === 'decision_maker');
  const dmKnown = members.filter((m) => m.seniority === 'decision_maker');

  let gap: string | null = null;
  if (engaged > 0 && !dmEngaged) {
    gap = dmKnown.length > 0
      ? `Nobody senior has replied yet. ${dmKnown[0].name}${dmKnown[0].job_title ? ` (${dmKnown[0].job_title})` : ''} is on the account${dmKnown[0].standing === 'untouched' ? ' and has not been contacted' : ''}.`
      : 'Only non-senior people are engaged, and no decision maker is on the account yet. Find one before this goes to proposal.';
  } else if (engaged === 1 && members.length > 1) {
    gap = 'Single-threaded: one person is carrying this account. Bring a second in before they go on holiday.';
  }

  return { members, engaged, contacted: count('contacted'), untouched: count('untouched'), decision_maker_engaged: dmEngaged, gap };
}

/* ─── When somebody reads their email ────────────────────────────────────
   From the hours a person has opened, clicked or replied, the two-hour
   window they are most often in their inbox - in the viewer's local time.
   Needs a few events before it will say anything; one open is a guess. */

export function engagementWindow(events: { activity_type: string; occurred_at: string }[], minEvents = 3): { from: number; to: number; count: number } | null {
  const hours = new Array(24).fill(0);
  let n = 0;
  for (const e of events) {
    if (!['opened', 'clicked', 'replied'].includes(e.activity_type)) continue;
    const t = new Date(e.occurred_at);
    if (Number.isNaN(t.getTime())) continue;
    // Replies count double: writing back is a stronger signal than an open.
    const w = e.activity_type === 'replied' ? 2 : 1;
    hours[t.getHours()] += w;
    n++;
  }
  if (n < minEvents) return null;
  let best = 0;
  for (let h = 1; h < 24; h++) {
    if (hours[h] + hours[(h + 1) % 24] > hours[best] + hours[(best + 1) % 24]) best = h;
  }
  return { from: best, to: (best + 2) % 24, count: n };
}
