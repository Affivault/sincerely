import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Banknote, TrendingUp, Reply, Handshake, AlertTriangle } from 'lucide-react';
import { analyticsApi, type StepRevenueRow, type AttributedDealRow } from '../../api/analytics.api';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/shared/EmptyState';
import { ATTRIBUTION_LABEL, type Attribution } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   One campaign, sent to banked.

   The list view answers "which sequence made money". This answers "which
   part of it did", which is the actionable half: a sequence is usually
   carried by one step, and knowing which is the difference between
   rewriting the whole thing and rewriting the one email that works.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/**
 * The funnel, drawn as survival from the step before it.
 *
 * The obvious version scales every bar against the top, and for a real
 * outreach funnel that is useless: 2,000 sent against 14 replies makes every
 * bar after the first a 16px nub, so you cannot see that six deals became
 * three wins - which is the part you can actually act on.
 *
 * So each bar is that step's share of the one above. The first is the
 * baseline. A near-empty second bar is not a rendering failure, it is the
 * honest shape of cold outreach, and the bars below it stay readable enough
 * to compare against each other.
 */
function Funnel({ steps }: { steps: { label: string; count: number; ofPrevious: number | null }[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const share = s.ofPrevious === null ? 1 : s.ofPrevious;
        // Floored so a real but tiny conversion is still a visible mark
        // rather than nothing at all, which would read as "no data".
        const width = Math.max(s.count > 0 ? 2 : 0, Math.min(100, share * 100));
        const first = i === 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-[104px] flex-shrink-0 text-[11.5px] font-medium text-[var(--text-secondary)]">
              {s.label}
            </span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-[5px] bg-[var(--bg-elevated)]">
              <div
                className={cn(
                  // A real Tailwind colour, not bg-[var(--indigo)]/70: an
                  // alpha modifier cannot be applied to an arbitrary var(),
                  // so that emits nothing and the bar renders invisible at
                  // exactly the right width.
                  'h-full rounded-[5px] transition-all',
                  first ? 'bg-indigo-500/25' : 'bg-indigo-500/80',
                )}
                style={{ width: `${width}%` }}
              />
              {!first && s.ofPrevious !== null && (
                <span className={cn(
                  'absolute inset-y-0 flex items-center text-[10.5px] font-semibold tabular-nums',
                  // Inside the bar once there is room; beside it when there
                  // is not, which for a cold funnel is most of the time.
                  width > 12 ? 'left-2 text-white' : 'text-[var(--text-tertiary)]',
                )}
                style={width > 12 ? undefined : { left: `calc(${width}% + 8px)` }}>
                  {pct(s.ofPrevious)} of {steps[i - 1].label.toLowerCase()}
                </span>
              )}
            </div>
            <span className="w-16 flex-shrink-0 text-right text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">
              {s.count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'money' }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className={cn(
        'mt-1.5 text-[20px] font-semibold leading-none tabular-nums',
        tone === 'money' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-primary)]',
      )}>{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

const ATTR_TONE: Record<Attribution, string> = {
  thread: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  reply: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  manual: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]',
  enrolment: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
};

export function CampaignRevenuePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'revenue', id],
    queryFn: () => analyticsApi.campaignRevenue(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[82px] rounded-xl" />)}
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="panel">
        <EmptyState icon={AlertTriangle} title="That campaign could not be loaded" description="It may have been deleted, or belong to another account." />
      </div>
    );
  }

  const { campaign, funnel, totals, steps, unrecorded_step: unrecorded, deals } = data;
  // The step that actually carried the sequence. Worth naming outright rather
  // than leaving somebody to scan a column for the biggest number.
  const best = [...steps].sort((a, b) => b.won_value - a.won_value)[0];
  const carried = best && best.won_value > 0 && best.won_value >= totals.won_value * 0.5;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/analytics/revenue" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <ArrowLeft className="h-3 w-3" /> Revenue
        </Link>
        <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{campaign.name}</h1>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)]">
          {totals.won_value > 0
            ? `Earned ${money(totals.won_value)} from ${totals.replied.toLocaleString()} repl${totals.replied === 1 ? 'y' : 'ies'}.`
            : 'Nothing closed from this campaign yet.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Closed" tone="money" value={money(totals.won_value)}
              sub={totals.strong_won_value < totals.won_value
                ? `${money(totals.strong_won_value)} on strong evidence`
                : 'All on strong evidence'} />
        <Stat label="Weighted pipeline" value={money(totals.weighted_open)} sub={`${totals.open} deal(s) still open`} />
        <Stat label="Value per reply" value={totals.value_per_reply === null ? '—' : money(totals.value_per_reply)}
              sub={totals.replied > 0 ? `${totals.replied} repl${totals.replied === 1 ? 'y' : 'ies'}` : 'No replies yet'} />
        <Stat label="Win rate" value={pct(totals.win_rate)} sub={`${totals.won} won · ${totals.lost} lost`} />
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 text-[11px] font-bold text-[var(--text-tertiary)]">Sent to won</h2>
        <Funnel steps={funnel} />
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <h2 className="text-[11px] font-bold text-[var(--text-tertiary)]">Which step earned it</h2>
          {carried && (
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              Step {best.step_order} carried this sequence
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-2.5 pl-4 pr-3">Step</th>
                <th className="py-2.5 px-3 text-right">Sent</th>
                <th className="py-2.5 px-3 text-right">Replied</th>
                <th className="py-2.5 px-3 text-right">Deals</th>
                <th className="py-2.5 px-3 text-right">Per reply</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Closed</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((st: StepRevenueRow) => (
                <tr key={st.id} className={cn(
                  'border-b border-[var(--border-subtle)] last:border-0',
                  carried && st.id === best.id && 'bg-emerald-500/[0.05]',
                )}>
                  <td className="py-2.5 pl-4 pr-3 max-w-[300px]">
                    <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">Step {st.step_order}</span>
                    {st.subject && (
                      <p className="truncate text-[11px] text-[var(--text-tertiary)]">{st.subject}</p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-tertiary)]">{st.sent.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-secondary)]">{st.replied.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-secondary)]">{st.deals.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-tertiary)]">
                    {st.value_per_reply === null ? '—' : money(st.value_per_reply)}
                  </td>
                  <td className={cn(
                    'py-2.5 pl-3 pr-4 text-right text-[13px] font-semibold tabular-nums',
                    st.won_value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-muted)]',
                  )}>
                    {st.won_value > 0 ? money(st.won_value) : '—'}
                  </td>
                </tr>
              ))}
              {unrecorded && (
                <tr className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="py-2.5 pl-4 pr-3" colSpan={4}>
                    <span className="text-[12.5px] font-medium text-[var(--text-tertiary)]">Step not recorded</span>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {unrecorded.deals} deal(s) credited to this campaign but not to one of its steps.
                    </p>
                  </td>
                  <td />
                  <td className="py-2.5 pl-3 pr-4 text-right text-[13px] font-semibold tabular-nums text-[var(--text-tertiary)]">
                    {unrecorded.won_value > 0 ? money(unrecorded.won_value) : '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] px-4 py-2.5">
          <h2 className="text-[11px] font-bold text-[var(--text-tertiary)]">
            The deals behind these numbers
          </h2>
        </div>
        {deals.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--text-tertiary)]">
            Nothing has been credited to this campaign yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {deals.map((d: AttributedDealRow) => (
              <Link
                key={d.id}
                to={`/deals/${d.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{d.title}</span>
                  {(d.contact_name || d.contact_email) && (
                    <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{d.contact_name || d.contact_email}</span>
                  )}
                </span>
                {d.attribution && (
                  <span className={cn('inline-flex flex-shrink-0 items-center px-1.5 h-[19px] rounded-md text-[10.5px] font-semibold', ATTR_TONE[d.attribution])}>
                    {ATTRIBUTION_LABEL[d.attribution]}
                  </span>
                )}
                <span className={cn(
                  'w-24 flex-shrink-0 text-right text-[12.5px] font-semibold tabular-nums',
                  d.stage === 'won' ? 'text-emerald-600 dark:text-emerald-400'
                    : d.stage === 'lost' ? 'text-[var(--text-muted)] line-through'
                    : 'text-[var(--text-secondary)]',
                )}>
                  {money(d.value)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
