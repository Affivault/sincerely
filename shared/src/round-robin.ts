/* ═══════════════════════════════════════════════════════════════════════
   Team round-robin booking.

   One booking link, several teammates. The page offers every time at least
   one of them is free; the booking goes to one of the hosts free at the
   chosen time, picked by the rules below. Kept here, apart from the server,
   so the order is pinned by a check rather than by reading a query.
   ═══════════════════════════════════════════════════════════════════════ */

export type BookingAssignment = 'single' | 'round_robin';
export type RoundRobinStrategy = 'balanced' | 'priority';

export const ROUND_ROBIN_STRATEGIES: { value: RoundRobinStrategy; label: string; hint: string }[] = [
  {
    value: 'balanced',
    label: 'Share evenly',
    hint: 'Whoever is free and has had the fewest meetings from this link in the last 30 days.',
  },
  {
    value: 'priority',
    label: 'By priority',
    hint: 'The free host with the best priority (1 first). Equal priorities are shared evenly.',
  },
];

/** How far back "fewest meetings lately" looks. */
export const ROUND_ROBIN_WINDOW_DAYS = 30;
/** A link spread over more people than this is a queue, not a team. */
export const ROUND_ROBIN_MAX_HOSTS = 20;

/** A host as the link's owner manages them. */
export interface BookingLinkHost {
  user_id: string;
  /** 1 is first. Only matters for the 'priority' strategy. */
  priority: number;
  /** The owner's switch for this host on this link. */
  is_active: boolean;
  /** The host's own "not now" switch. The owner cannot override it. */
  host_paused: boolean;
  last_assigned_at: string | null;
  /** Joined in for display. */
  email?: string | null;
  name?: string | null;
  /** Whether a confirmation can go out when this host is given a meeting. */
  can_email?: boolean;
  /** Meetings from this link in the last ROUND_ROBIN_WINDOW_DAYS. */
  recent_bookings?: number;
}

/** The team setting, as the Team page and the links page read it. */
export interface RoundRobinStatus {
  enabled: boolean;
  /** Owner or admin: the people who may switch it. */
  can_manage: boolean;
  /** Teammates who could host (they have an account, not just an invite). */
  members: { user_id: string; email: string; name: string | null; role: string }[];
}

/** A round-robin link the current person hosts, for their own pause switch. */
export interface HostedRoundRobinLink {
  link_id: string;
  headline: string;
  slug: string;
  owner_name: string;
  host_paused: boolean;
  is_active: boolean;
}

/** What ranking needs to know about one host free at the chosen time. */
export interface RankableHost {
  user_id: string;
  priority: number;
  /** Meetings from this link in the fairness window. */
  recent: number;
  last_assigned_at: string | null;
}

function lastAssignedMs(h: RankableHost): number {
  if (!h.last_assigned_at) return -Infinity;
  const t = new Date(h.last_assigned_at).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * The order to offer a booking to the hosts free at its time.
 *
 * The first is who gets it; the rest are who it falls to if the first turns
 * out to be taken in the instant between the check and the write. Ties end
 * on the user id so the order never depends on how rows came back.
 */
export function rankHosts(hosts: RankableHost[], strategy: RoundRobinStrategy): string[] {
  const balanced = (a: RankableHost, b: RankableHost) =>
    a.recent - b.recent
    || lastAssignedMs(a) - lastAssignedMs(b)
    || a.priority - b.priority
    || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0);

  const sorted = [...hosts].sort((a, b) =>
    strategy === 'priority'
      ? (a.priority - b.priority) || balanced(a, b)
      : balanced(a, b));
  return sorted.map((h) => h.user_id);
}

/** Several hosts' free times as one list: each start once, in order. */
export function mergeSlotLists<T extends { start: Date | string; end: Date | string }>(lists: T[][]): T[] {
  const byStart = new Map<number, T>();
  for (const list of lists) {
    for (const slot of list) {
      const t = new Date(slot.start).getTime();
      if (!Number.isFinite(t) || byStart.has(t)) continue;
      byStart.set(t, slot);
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/** Whether a host may be offered meetings from a link at all. */
export function hostIsBookable(h: Pick<BookingLinkHost, 'is_active' | 'host_paused'>): boolean {
  return h.is_active && !h.host_paused;
}
