/* ═══════════════════════════════════════════════════════════════════════
   Recently opened records, for the command palette's "Recent" group.

   Kept in localStorage rather than a query param or server table — this is
   a per-browser convenience (jump back to who you were just looking at),
   not data anyone needs synced across devices or surfaced anywhere else.
   ═══════════════════════════════════════════════════════════════════════ */

export type RecentItemType = 'contact' | 'deal' | 'company';

export interface RecentItem {
  type: RecentItemType;
  id: string;
  label: string;
  sublabel?: string | null;
}

const KEY = 'sincerely.recentItems';
const MAX = 8;

export function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Private-browsing / quota-exceeded / disabled storage — recents are a
    // nicety, not something worth surfacing an error for.
    return [];
  }
}

/** Bumps `item` to the front, deduped against any earlier entry for the same record. */
export function addRecentItem(item: RecentItem): void {
  try {
    const rest = getRecentItems().filter((r) => !(r.type === item.type && r.id === item.id));
    localStorage.setItem(KEY, JSON.stringify([item, ...rest].slice(0, MAX)));
  } catch {
    // Same as above — nothing to recover from, and nothing worth surfacing.
  }
}
