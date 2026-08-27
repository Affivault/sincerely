import { DEAL_STAGES, OPEN_STAGES, daysByStage } from '@lemlist/shared';
import type { Deal, DealStage, DealStageEvent } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { Check, Trophy, XCircle } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Where the deal is, how long it took to get there, and the two buttons
   that end it.

   The single most-used control on a deal page in every CRM worth copying,
   because it collapses three questions into one glance: which stage, how
   long in each, and how far along. Moving the deal is a click on the stage
   you want rather than a dropdown you have to open and read.

   Won and lost sit apart from the open stages on purpose. They are not the
   next step along a path, they are the end of it, and putting them in the
   same row invites the mis-click that marks a deal won by accident.
   ═══════════════════════════════════════════════════════════════════════ */

function spellDays(days: number | undefined): string {
  if (days === undefined) return '';
  if (days <= 0) return '<1d';
  return `${days}d`;
}

export function DealStageBar({
  deal, history, onStage, busy,
}: {
  deal: Deal;
  history: DealStageEvent[];
  onStage: (stage: DealStage) => void;
  busy?: boolean;
}) {
  const spent = daysByStage(history);
  const closed = deal.stage === 'won' || deal.stage === 'lost';
  const currentIndex = OPEN_STAGES.indexOf(deal.stage);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-stretch gap-1">
        {OPEN_STAGES.map((id, i) => {
          const meta = DEAL_STAGES.find((s) => s.id === id);
          const active = deal.stage === id;
          // On a closed deal every open stage is history, so none of them is
          // "still to come" — shading them all as done reads as the path it
          // actually took rather than a journey it abandoned.
          const done = closed || (currentIndex > -1 && i < currentIndex);
          const days = spent[id];
          return (
            <button
              key={id}
              type="button"
              disabled={busy || active}
              onClick={() => onStage(id)}
              title={active ? `Currently in ${meta?.label}` : `Move to ${meta?.label}`}
              className={cn(
                'group relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-left transition-all',
                active
                  ? 'bg-[var(--indigo)] text-white shadow-[var(--shadow-sm)]'
                  : done
                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)] hover:bg-[var(--indigo)]/20'
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                (busy || active) && 'cursor-default',
              )}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                {done && !active && <Check className="h-3 w-3 flex-shrink-0" />}
                <span className="truncate">{meta?.label}</span>
              </span>
              <span
                className={cn(
                  'text-[10.5px] tabular-nums',
                  active ? 'text-white/75' : 'text-[var(--text-muted)]',
                )}
              >
                {days === undefined ? 'not reached' : `${spellDays(days)} spent`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5 sm:border-l sm:border-[var(--border-subtle)] sm:pl-2.5">
        <button
          type="button"
          disabled={busy || deal.stage === 'won'}
          onClick={() => onStage('won')}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
            deal.stage === 'won'
              ? 'cursor-default bg-emerald-500 text-white'
              : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400',
          )}
        >
          <Trophy className="h-3.5 w-3.5" /> Won
        </button>
        <button
          type="button"
          disabled={busy || deal.stage === 'lost'}
          onClick={() => onStage('lost')}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
            deal.stage === 'lost'
              ? 'cursor-default bg-rose-500 text-white'
              : 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400',
          )}
        >
          <XCircle className="h-3.5 w-3.5" /> Lost
        </button>
      </div>
    </div>
  );
}
