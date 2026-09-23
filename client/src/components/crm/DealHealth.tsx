/* ═══════════════════════════════════════════════════════════════════════
   Deal health, on the card and on the deal.

   A dot on every open deal, read from the mailbox and the diary rather than
   from how long the card has sat in its column. Hover for the reasons;
   the deal page shows them in full with the one thing to do about it.
   ═══════════════════════════════════════════════════════════════════════ */

import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Reply, Send, CalendarPlus, UserPlus, CalendarClock, ListChecks, TrendingDown, TrendingUp } from 'lucide-react';
import { DEAL_ACTION_LABEL, type DealHealth, type DealNextAction, type DealHealthGrade } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { cn } from '../../lib/utils';

/** Every open deal's health, shared by the board, the table and the Flow queue. */
export function useDealHealth(enabled = true) {
  return useQuery({
    queryKey: ['crm', 'deal-health'],
    queryFn: () => crmApi.dealHealth(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export const GRADE_STYLE: Record<DealHealthGrade, { dot: string; text: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', label: 'Healthy' },
  watch:   { dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/10',   label: 'Needs attention' },
  at_risk: { dot: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-500/10',    label: 'At risk' },
};

export const ACTION_ICON: Record<DealNextAction, typeof Reply> = {
  reply: Reply,
  follow_up: Send,
  book_meeting: CalendarPlus,
  add_stakeholder: UserPlus,
  update_close_date: CalendarClock,
  do_tasks: ListChecks,
  none: HeartPulse,
};

export function DealHealthDot({ health, withScore = false }: { health?: DealHealth | null; withScore?: boolean }) {
  if (!health) return null;
  const s = GRADE_STYLE[health.grade];
  const tip = `${s.label} (${health.score}/100)\n${health.reasons.map((r) => `${r.impact < 0 ? '−' : '+'} ${r.text}`).join('\n')}`;
  return (
    <span title={tip} className={cn('inline-flex items-center gap-1 flex-shrink-0', withScore && cn('rounded-full px-1.5 py-0.5 text-micro font-semibold tabular', s.bg, s.text))}>
      <span className={cn('inline-block h-2 w-2 rounded-full', s.dot)} aria-label={s.label} />
      {withScore && health.score}
    </span>
  );
}

/**
 * The full read, for the deal page. `onAction` receives the next action so
 * the page can open the composer, the meeting dialog, the people picker.
 */
export function DealHealthPanel({ health, onAction }: { health?: DealHealth | null; onAction?: (a: DealNextAction) => void }) {
  if (!health) return null;
  const s = GRADE_STYLE[health.grade];
  const ActionIcon = ACTION_ICON[health.next_action];
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HeartPulse className={cn('h-4 w-4', s.text)} />
          <span className="text-strong font-semibold text-[var(--text-primary)]">Deal health</span>
          <span className={cn('rounded-full px-2 py-0.5 text-caption font-semibold tabular', s.bg, s.text)}>
            {s.label} · {health.score}
          </span>
        </div>
        {health.next_action !== 'none' && onAction && (
          <button
            onClick={() => onAction(health.next_action)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--indigo)] text-white text-caption font-medium hover:opacity-90 transition-opacity"
          >
            <ActionIcon className="h-3.5 w-3.5" />
            {DEAL_ACTION_LABEL[health.next_action]}
          </button>
        )}
      </div>
      {health.reasons.length === 0 ? (
        <p className="mt-2 text-body text-[var(--text-tertiary)]">Nothing to worry about yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {health.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-body">
              {r.impact < 0
                ? <TrendingDown className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-rose-500" />
                : <TrendingUp className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-emerald-500" />}
              <span className="text-[var(--text-secondary)]">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
