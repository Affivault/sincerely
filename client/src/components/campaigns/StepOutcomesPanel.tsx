/* ═══════════════════════════════════════════════════════════════════════
   Meetings and money per hundred emails, step by step.

   Opens and replies say an email was read. This says whether it booked
   anything: interested and meeting replies credited to the email just
   before them, won deals to their recorded step, both per 100 sent - and,
   for a split step, per version, with the switch offered once one version
   is clearly better at booking meetings.
   ═══════════════════════════════════════════════════════════════════════ */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Banknote, CalendarCheck, GitBranch, Loader2, Trophy } from 'lucide-react';
import type { StepOutcomeArm } from '@lemlist/shared';
import { analyticsApi } from '../../api/analytics.api';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';

function money(v: number): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
  catch { return `$${Math.round(v)}`; }
}

function ArmLine({ label, arm, best }: { label: string; arm: StepOutcomeArm; best: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 text-caption', best ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
      <span className="w-5 font-semibold">{label}</span>
      <span className="w-20 tabular">{arm.sent.toLocaleString()} sent</span>
      <span className="w-28 tabular">{arm.meetings_per_100.toFixed(1)} meetings/100</span>
      <span className="tabular">{money(arm.revenue_per_100)}/100</span>
      {best && <Trophy className="h-3 w-3 text-amber-500" />}
    </div>
  );
}

export function StepOutcomesPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['analytics', 'step-outcomes', campaignId],
    queryFn: () => analyticsApi.stepOutcomes(campaignId),
    staleTime: 60_000,
  });
  const promote = useMutation({
    mutationFn: ({ stepId, variant }: { stepId: string; variant: 'a' | 'b' }) => campaignsApi.promoteAbVariant(campaignId, stepId, variant),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId] });
      toast.success('Switched - everyone still to get that step gets the winner');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not switch'),
  });

  if (!data || data.steps.every((s) => s.sent === 0)) return null;
  const peak = Math.max(0.1, ...data.steps.map((s) => s.meetings_per_100));

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-strong font-semibold text-[var(--text-primary)]">
          <CalendarCheck className="h-4 w-4 text-[var(--indigo)]" /> What each step books
        </h3>
        <p className="text-caption text-[var(--text-tertiary)]">{data.headline}</p>
      </div>
      <ul className="space-y-3">
        {data.steps.map((s) => (
          <li key={s.step_id}>
            <div className="flex items-center gap-3">
              <span className="w-12 flex-shrink-0 text-caption font-semibold text-[var(--text-tertiary)]">Step {s.step_order}</span>
              <span className="min-w-0 flex-1 truncate text-body text-[var(--text-secondary)]" title={s.subject}>{s.subject}</span>
              <span className="hidden w-40 sm:block">
                <span className="block h-1.5 rounded-full bg-[var(--bg-elevated)]">
                  <span className="block h-1.5 rounded-full bg-[var(--indigo)]" style={{ width: `${(s.meetings_per_100 / peak) * 100}%` }} />
                </span>
              </span>
              <span className="w-28 text-right text-caption tabular text-[var(--text-primary)]">{s.meetings_per_100.toFixed(1)} meetings/100</span>
              <span className="hidden w-24 items-center justify-end gap-1 text-right text-caption tabular text-[var(--text-secondary)] md:flex">
                <Banknote className="h-3 w-3" />{money(s.revenue_per_100)}/100
              </span>
            </div>
            {s.split && s.a && s.b && (
              <div className="ml-12 mt-1.5 space-y-1 border-l border-[var(--border-subtle)] pl-3">
                <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]"><GitBranch className="h-3 w-3" /> Split test</p>
                <ArmLine label="A" arm={s.a} best={s.suggestion?.variant === 'a'} />
                <ArmLine label="B" arm={s.b} best={s.suggestion?.variant === 'b'} />
                {s.suggestion && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5">
                    <span className="text-caption text-[var(--text-secondary)]">{s.suggestion.text}</span>
                    <button
                      onClick={() => promote.mutate({ stepId: s.step_id, variant: s.suggestion!.variant })}
                      disabled={promote.isPending}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {promote.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trophy className="h-3 w-3" />}
                      Use {s.suggestion.variant.toUpperCase()}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
