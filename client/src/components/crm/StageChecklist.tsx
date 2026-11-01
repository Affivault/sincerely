import { useMutation } from '@tanstack/react-query';
import { useOptimisticRow } from '../../lib/optimistic';
import toast from 'react-hot-toast';
import { Check, ListChecks } from 'lucide-react';
import { crmApi } from '../../api/crm.api';
import { cn } from '../../lib/utils';
import { STAGE_TONE } from '../../lib/stageColors';
import { checklistProgress, stageColor, type Deal, type PipelineStage } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The stage a deal is in, spelled out, and what is left to do there.

   The note says what is true of a deal in this stage; the checklist is
   what the team agreed to get done before moving it on. Ticks are kept per
   stage, so moving a deal back does not lose what was already done.
   ═══════════════════════════════════════════════════════════════════════ */

export function StageChecklist({ deal, stage, index }: { deal: Deal; stage: PipelineStage | null; index: number }) {
  const items = stage?.checklist || [];
  const checks = deal.stage_checks || {};
  const ticked = new Set(stage ? checks[stage.id] || [] : []);
  const { done, total } = checklistProgress(stage, checks);

  /** The checks with one item flipped, read from the row as it is now. */
  const flip = (current: Record<string, string[]> | undefined, item: string) => {
    const cur = new Set((current && stage ? current[stage.id] : []) || []);
    if (cur.has(item)) cur.delete(item); else cur.add(item);
    // Only items still on the list are kept, so renamed ones fall away.
    return { ...(current || {}), [stage!.id]: items.filter((i) => cur.has(i)) };
  };

  const optimistic = useOptimisticRow<string>({
    scope: ['crm'],
    id: () => deal.id,
    patch: (item, row) => ({ stage_checks: flip(row?.stage_checks, item) }),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that tick'),
  });

  const toggle = useMutation({
    mutationFn: (item: string) => crmApi.updateDeal(deal.id, { stage_checks: flip(checks, item) }),
    ...optimistic,
  });

  const closed = deal.stage === 'won' || deal.stage === 'lost';
  if (!stage || closed || (!stage.description && items.length === 0)) return null;
  const tone = STAGE_TONE[stageColor(stage, index)];
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', tone.dot)} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[var(--text-primary)]">
            In {stage.name}
            {total > 0 && <span className="ml-2 text-caption font-medium tabular-nums text-[var(--text-tertiary)]">{done} of {total} done</span>}
          </p>
          {stage.description && <p className="text-caption text-[var(--text-secondary)]">{stage.description}</p>}
        </div>
        {total > 0 && done === total && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Ready to move on
          </span>
        )}
      </div>
      {total > 0 && (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            <div className={cn('h-full rounded-full transition-all', tone.dot)} style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {items.map((item) => {
              const on = ticked.has(item);
              return (
                <li key={item}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle.mutate(item)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className={cn(
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                      on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--border-default)] bg-[var(--bg-app)]',
                    )}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn('min-w-0 flex-1 text-body', on ? 'text-[var(--text-tertiary)] line-through' : 'text-[var(--text-primary)]')}>{item}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** The small "2/3" on a deal card. Nothing when the stage has no checklist. */
export function ChecklistBadge({ stage, deal }: { stage: PipelineStage | null; deal: Deal }) {
  const { done, total } = checklistProgress(stage, deal.stage_checks);
  if (total === 0) return null;
  const complete = done === total;
  return (
    <span
      title={`${done} of ${total} checklist items done in ${stage!.name}`}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums',
        complete ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]',
      )}
    >
      <ListChecks className="h-2.5 w-2.5" />{done}/{total}
    </span>
  );
}
