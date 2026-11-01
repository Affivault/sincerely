import { daysByStage, stageColor } from '@lemlist/shared';
import { STAGE_TONE } from '../../lib/stageColors';
import type { Deal, DealStageEvent, PipelineStage } from '@lemlist/shared';
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
  deal, history, stages, currentStageId, onStage, busy,
}: {
  deal: Deal;
  history: DealStageEvent[];
  /** The open stages of the deal's pipeline, in order. */
  stages: PipelineStage[];
  /** The stage it sits in (or last sat in, once closed). */
  currentStageId: string | null;
  /** A stage id, or 'won' / 'lost'. */
  onStage: (target: string) => void;
  busy?: boolean;
}) {
  // Time is counted per named stage where the history knows it, and per
  // phase for moves recorded before stages had names.
  const byId = daysByStage(history.map((e) => ({
    ...e,
    from_stage: e.from_stage_id || e.from_stage,
    to_stage: e.to_stage_id || e.to_stage,
  }))) as Record<string, number | undefined>;
  const spentIn = (s: PipelineStage): number | undefined => {
    const own = byId[s.id];
    const firstOfPhase = stages.find((x) => x.phase === s.phase)?.id === s.id;
    const legacy = firstOfPhase ? byId[s.phase] : undefined;
    if (own === undefined && legacy === undefined) return undefined;
    return (own ?? 0) + (legacy ?? 0);
  };
  const closed = deal.stage === 'won' || deal.stage === 'lost';
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-stretch gap-1">
        {stages.map((st, i) => {
          const id = st.id;
          const meta = { label: st.name };
          const active = !closed && currentStageId === id;
          // On a closed deal every open stage is history, so none of them is
          // "still to come" — shading them all as done reads as the path it
          // actually took rather than a journey it abandoned.
          const done = (closed && i <= currentIndex) || (currentIndex > -1 && i < currentIndex);
          const days = spentIn(st);
          const tone = STAGE_TONE[stageColor(st, i)];
          return (
            <button
              key={id}
              type="button"
              disabled={busy || active}
              onClick={() => onStage(id)}
              title={`${active ? `Currently in ${meta?.label}` : `Move to ${meta?.label}`}${st.description ? `. ${st.description}` : ''}`}
              className={cn(
                'group relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-left transition-all',
                active
                  ? cn(tone.solid, 'shadow-[var(--shadow-sm)]')
                  : done
                    ? cn(tone.soft, 'hover:opacity-80')
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                (busy || active) && 'cursor-default',
              )}
            >
              <span className="flex items-center gap-1.5 text-body font-semibold">
                {done && !active && <Check className="h-3 w-3 flex-shrink-0" />}
                <span className="truncate">{meta?.label}</span>
              </span>
              <span
                className={cn(
                  'text-micro tabular-nums',
                  active ? 'text-white/75' : 'text-[var(--text-tertiary)]',
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
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-body font-semibold transition-colors',
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
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-body font-semibold transition-colors',
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
