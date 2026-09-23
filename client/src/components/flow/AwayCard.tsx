/* ═══════════════════════════════════════════════════════════════════════
   While you were away.

   The first screen after a long gap says what changed, in counts that each
   open the thing they count. Shown once per return: the moment of the last
   visit is captured at the start of the session, and dismissing the card
   (or a fresh gap under eight hours) keeps it out of the way.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Coffee } from 'lucide-react';
import { awayApi } from '../../api/flow.api';
import { formatRelativeTime } from '../../lib/utils';

const LAST_SEEN = 'sincerely_last_seen';
const SESSION_SINCE = 'sincerely_away_since';
const DISMISSED = 'sincerely_away_dismissed';
/** Shorter than a working day's gap is not "away". */
const MIN_GAP_MS = 8 * 3_600_000;

/**
 * The previous visit, captured once per browser session. Called by the app
 * shell on every page load, so "last seen" means last seen anywhere in the
 * app, not only on the pages that show the card.
 */
export function captureAwaySince(): string | null {
  try {
    let since = sessionStorage.getItem(SESSION_SINCE);
    if (since === null) {
      const last = localStorage.getItem(LAST_SEEN);
      since = last && Date.now() - Date.parse(last) >= MIN_GAP_MS ? last : '';
      sessionStorage.setItem(SESSION_SINCE, since);
    }
    localStorage.setItem(LAST_SEEN, new Date().toISOString());
    return since || null;
  } catch {
    return null;
  }
}

export function AwayCard() {
  const [since] = useState(() => {
    try { return sessionStorage.getItem(SESSION_SINCE) || captureAwaySince(); } catch { return null; }
  });
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(DISMISSED) === '1'; } catch { return false; }
  });
  const { data } = useQuery({
    queryKey: ['away', since],
    queryFn: () => awayApi.since(since!),
    enabled: !!since && !hidden,
    staleTime: Infinity,
  });
  if (!since || hidden || !data) return null;

  const items: { n: number; label: string; to: string; strong?: boolean }[] = [
    { n: data.positive_replies, label: data.positive_replies === 1 ? 'interested reply' : 'interested replies', to: '/flow', strong: true },
    { n: data.replies - data.positive_replies, label: 'other replies', to: '/replies' },
    { n: data.meetings_booked, label: data.meetings_booked === 1 ? 'meeting booked' : 'meetings booked', to: '/calendar', strong: true },
    { n: data.deals_created, label: data.deals_created === 1 ? 'new deal' : 'new deals', to: '/deals' },
    { n: data.deals_won, label: data.deals_won === 1 ? 'deal won' : 'deals won', to: '/deals', strong: true },
    { n: data.campaigns_completed, label: data.campaigns_completed === 1 ? 'campaign finished' : 'campaigns finished', to: '/campaigns' },
    { n: data.bounces, label: data.bounces === 1 ? 'bounce' : 'bounces', to: '/analytics' },
  ].filter((i) => i.n > 0);

  const close = () => {
    setHidden(true);
    try { sessionStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ }
  };

  return (
    <div className="relative mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <button onClick={close} className="absolute right-2 top-2 icon-btn h-7 w-7" title="Dismiss"><X className="h-3.5 w-3.5" /></button>
      <p className="flex items-center gap-1.5 text-body font-semibold text-[var(--text-primary)]">
        <Coffee className="h-4 w-4 text-[var(--indigo)]" /> Since you were last here {formatRelativeTime(data.since)}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-caption text-[var(--text-tertiary)]">Quiet - nothing new came in.</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pr-8">
          {items.map((i) => (
            <Link key={i.label} to={i.to} className="text-body text-[var(--text-secondary)] hover:text-[var(--indigo)]">
              <span className={i.strong ? 'font-semibold text-[var(--text-primary)]' : 'font-medium'}>{i.n.toLocaleString()}</span> {i.label}
            </Link>
          ))}
          {data.won_value > 0 && (
            <span className="text-body text-emerald-600 dark:text-emerald-400">
              {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(data.won_value)} closed
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * For the app shell: capture the previous visit once, then keep "last seen"
 * current while the app is open, so a tab left open all day does not come
 * back tomorrow claiming to have been away since this morning.
 */
export function useTrackLastSeen() {
  useEffect(() => {
    captureAwaySince();
    const tick = () => { try { localStorage.setItem(LAST_SEEN, new Date().toISOString()); } catch { /* ignore */ } };
    const id = setInterval(tick, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
}
