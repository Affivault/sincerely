import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api/analytics.api';
import { STEP_VERDICT_LABELS } from '@lemlist/shared';
import type { SequenceStepPerformance, StepVerdict } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { Lightbulb, Scissors, TrendingUp } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Which step earns the replies.

   The step table underneath this answers "what happened at each step". It
   cannot answer "should I keep sending step five", and its own numbers
   quietly argue the wrong way: a follow-up's reply rate is measured over
   the survivors, so the pool shrinks at every step and the rate flatters
   whatever is last. Two replies out of eighteen reads as 11% and looks like
   the best step in the sequence.

   This leads with share of replies, which does not shrink with the pool,
   and says out loud where the sequence stops paying for itself.
   ═══════════════════════════════════════════════════════════════════════ */

const VERDICT_STYLE: Record<StepVerdict, { chip: string; bar: string }> = {
  earning: {
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  marginal: {
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  unproductive: {
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    bar: 'bg-rose-500',
  },
  too_early: {
    chip: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
    bar: 'bg-[var(--text-muted)]',
  },
};

function hoursLabel(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function StepRow({ step, widest }: { step: SequenceStepPerformance; widest: number }) {
  const style = VERDICT_STYLE[step.verdict];
  const width = widest > 0 ? Math.max(step.share_of_replies / widest, 0) * 100 : 0;

  return (
    <li className="px-4 py-3 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[11px] font-bold tabular text-[var(--text-secondary)]">
          {step.step_number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">
              {step.subject}
            </p>
            <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', style.chip)}>
              {STEP_VERDICT_LABELS[step.verdict]}
            </span>
          </div>

          {/* Share of the campaign's replies — the number that does not
              shrink with the pool, so it is the one given the length. */}
          <div className="mt-2 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div className={cn('h-full rounded-full transition-all', style.bar)} style={{ width: `${width}%` }} />
            </div>
            <span className="w-[86px] flex-shrink-0 text-right text-[11.5px] tabular text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">{(step.share_of_replies * 100).toFixed(0)}%</span>
              <span className="text-[var(--text-tertiary)]"> of replies</span>
            </span>
          </div>

          <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">{step.note}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span>Sent <span className="font-semibold tabular text-[var(--text-secondary)]">{step.sent.toLocaleString()}</span></span>
            <span>Replies <span className="font-semibold tabular text-[var(--text-secondary)]">{step.replied.toLocaleString()}</span></span>
            <span>Per 100 <span className="font-semibold tabular text-[var(--text-secondary)]">{step.replies_per_100.toFixed(1)}</span></span>
            <span>Usually within <span className="font-semibold tabular text-[var(--text-secondary)]">{hoursLabel(step.median_hours_to_reply)}</span></span>
            {step.unsubscribed > 0 && (
              <span>Unsubscribed <span className="font-semibold tabular text-[var(--text-secondary)]">{step.unsubscribed.toLocaleString()}</span></span>
            )}
            {step.delay_days > 0 && <span className="text-[var(--text-muted)]">+{step.delay_days}d after the previous step</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

export function SequenceStepsPanel({ campaignId }: { campaignId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'sequence-steps', campaignId],
    queryFn: () => analyticsApi.sequenceSteps(campaignId),
    enabled: !!campaignId,
    meta: { silentError: true },
  });

  if (isLoading) return <div className="h-48 rounded-xl bg-[var(--bg-elevated)] animate-pulse" />;
  if (isError || !data) return null;
  if (data.steps.length === 0) {
    return (
      <div className="panel p-5">
        <p className="text-[12.5px] text-[var(--text-secondary)]">{data.headline}</p>
      </div>
    );
  }

  const trimming = data.recommended_length !== null && data.recommended_length < data.steps.length;
  const widest = Math.max(...data.steps.map((s) => s.share_of_replies), 0);
  const Icon = trimming ? Scissors : data.recommended_length === null ? Lightbulb : TrendingUp;

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] p-4">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Which step earns the replies</h3>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">
          Share of every reply this campaign has earned. Reply <em>rate</em> rises through a sequence
          simply because the pool shrinks — share does not.
        </p>

        <div
          className={cn(
            'mt-3 flex items-start gap-2.5 rounded-lg border p-3',
            trimming
              ? 'border-amber-500/25 bg-amber-500/[0.06]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50',
          )}
        >
          <Icon className={cn('mt-px h-4 w-4 flex-shrink-0', trimming ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--indigo)]')} />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium leading-snug text-[var(--text-primary)]">{data.headline}</p>
            <p className="mt-1 text-[11px] tabular text-[var(--text-tertiary)]">
              {data.total_replied.toLocaleString()} {data.total_replied === 1 ? 'reply' : 'replies'} from{' '}
              {data.total_sent.toLocaleString()} emails across {data.steps.length}{' '}
              {data.steps.length === 1 ? 'step' : 'steps'}.
            </p>
          </div>
        </div>
      </div>

      <ul>
        {data.steps.map((step) => (
          <StepRow key={step.step_id} step={step} widest={widest} />
        ))}
      </ul>
    </div>
  );
}
