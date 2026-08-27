import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DEAL_STAGES, OPEN_STAGES, annualRecurring, dealValue, medianDaysPerStage,
  outcomesByStage, performanceBySource, reasonBreakdown,
} from '@lemlist/shared';
import type { DealStage } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import {
  ArrowLeft, BarChart3, Clock, ThumbsDown, ThumbsUp, TrendingUp, Trophy,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   What the pipeline has been trying to tell you.

   Every deal that has ever closed has been recording where it was when it
   closed, why, how long each stage took and where it came from. None of it
   was ever read back. This is the page that reads it.

   The organising idea is that a percentage is only useful next to the
   thing it is a percentage of. "We lose 60% at proposal" matters because
   of what those deals were worth; a source with a 90% win rate on two
   deals is not better than one with 40% on forty. So every rate here is
   shown with its denominator, and every count with its value.
   ═══════════════════════════════════════════════════════════════════════ */

const WINDOWS = [
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '12 months' },
  { days: 3650, label: 'All time' },
];

function money(v: number, currency = 'USD'): string {
  const abs = Math.abs(v);
  const compact = abs >= 1_000_000
    ? `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    : abs >= 10_000
      ? `${Math.round(v / 1000)}K`
      : Math.round(v).toLocaleString();
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${compact}`;
}

function stageLabel(id: DealStage): string {
  return DEAL_STAGES.find((s) => s.id === id)?.label || id;
}

function Panel({ title, hint, icon: Icon, children }: {
  title: string; hint?: string; icon: typeof Trophy; children: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{title}</p>
          {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-[var(--text-muted)]">{children}</p>;
}

/** A labelled proportion bar. Always shows the counts behind the percentage. */
function Bar({ won, lost }: { won: number; lost: number }) {
  const total = won + lost;
  if (total === 0) return <div className="h-1.5 rounded-full bg-[var(--bg-elevated)]" />;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
      <div className="bg-emerald-500" style={{ width: `${(won / total) * 100}%` }} />
      <div className="bg-rose-500" style={{ width: `${(lost / total) * 100}%` }} />
    </div>
  );
}

export function DealInsightsPage() {
  const [days, setDays] = useState(180);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['crm', 'insights', days],
    queryFn: () => crmApi.insights(days),
  });

  const analysis = useMemo(() => {
    if (!data) return null;
    const { deals, history } = data;
    const closed = deals.filter((d) => d.stage === 'won' || d.stage === 'lost');
    const won = closed.filter((d) => d.stage === 'won');

    const wonValue = won.reduce((n, d) => n + dealValue(d), 0);
    const wonArr = won.reduce((n, d) => n + annualRecurring(d), 0);
    const lostValue = closed
      .filter((d) => d.stage === 'lost')
      .reduce((n, d) => n + dealValue(d), 0);

    /*
     * Sales cycle measured from creation to close, over won deals only.
     * Including losses would mix "how long it takes to win" with "how long
     * we take to give up", which move independently and mean opposite
     * things when they get longer.
     */
    const cycles = won
      .map((d) => (d.closed_at ? Math.round((new Date(d.closed_at).getTime() - new Date(d.created_at).getTime()) / 86_400_000) : null))
      .filter((n): n is number => n !== null && n >= 0)
      .sort((a, b) => a - b);
    const medianCycle = cycles.length
      ? (cycles.length % 2 === 0
        ? Math.round((cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2)
        : cycles[(cycles.length - 1) / 2])
      : null;

    return {
      closedCount: closed.length,
      wonCount: won.length,
      winRate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      wonValue,
      wonArr,
      lostValue,
      medianCycle,
      stages: outcomesByStage(deals as any, history as any),
      lostReasons: reasonBreakdown(deals as any, 'lost'),
      wonReasons: reasonBreakdown(deals as any, 'won'),
      sources: performanceBySource(deals as any),
      stageDays: medianDaysPerStage(history as any),
    };
  }, [data]);

  return (
    <div>
      <Link
        to="/deals"
        className="group mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Pipeline
      </Link>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <BarChart3 className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Win / loss</h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">
              Where deals die, why, how long they take, and which sources are worth the effort.
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                days === w.days
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="md" /></div>
      ) : isError || !analysis ? (
        <div className="panel py-16 text-center">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">Could not load the analysis</p>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">The request failed. It is worth trying again.</p>
        </div>
      ) : analysis.closedCount === 0 ? (
        <div className="panel py-16 text-center">
          <Trophy className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Nothing has closed in this window</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--text-tertiary)]">
            Every stage change is being recorded from now on. Once deals start closing, this page will show
            where they die, what it costs, and which sources are actually worth working.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
              <p className="text-[11px] font-medium text-[var(--text-tertiary)]">Win rate</p>
              <p className="mt-1 text-[21px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
                {analysis.winRate}%
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {analysis.wonCount} of {analysis.closedCount} closed
              </p>
            </div>
            <div className="rounded-xl border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-3.5 py-3">
              <p className="text-[11px] font-medium text-[var(--text-tertiary)]">Won</p>
              <p className="mt-1 text-[21px] font-semibold leading-none tabular-nums text-[var(--indigo)]">
                {money(analysis.wonValue)}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {analysis.wonArr > 0 ? `${money(analysis.wonArr)} new ARR` : 'total contract value'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
              <p className="text-[11px] font-medium text-[var(--text-tertiary)]">Lost</p>
              <p className="mt-1 text-[21px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
                {money(analysis.lostValue)}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {analysis.closedCount - analysis.wonCount} deals
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
              <p className="text-[11px] font-medium text-[var(--text-tertiary)]">Sales cycle</p>
              <p className="mt-1 text-[21px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
                {analysis.medianCycle === null ? '—' : `${analysis.medianCycle}d`}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">median, won deals</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Where deals die */}
            <Panel
              title="Where deals die"
              hint="The stage a deal was in when it closed. This is the one thing you can act on."
              icon={ThumbsDown}
            >
              {analysis.stages.every((r) => r.won + r.lost === 0) ? (
                <Empty>
                  Nothing closed in this window has a recorded prior stage yet. Deals that closed before
                  stage history existed are left out rather than guessed at.
                </Empty>
              ) : (
                <div className="space-y-3">
                  {analysis.stages.map((row) => {
                    const closed = row.won + row.lost;
                    return (
                      <div key={row.stage}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">
                            {stageLabel(row.stage)}
                          </span>
                          <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                            {closed === 0 ? 'nothing closed here' : (
                              <>
                                <span className="font-semibold text-[var(--text-primary)]">{row.winRate}%</span>
                                {' won · '}{row.won}/{closed}
                              </>
                            )}
                          </span>
                        </div>
                        <Bar won={row.won} lost={row.lost} />
                        {row.lostValue > 0 && (
                          <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">
                            {money(row.lostValue)} lost from here
                            {row.wonValue > 0 && ` · ${money(row.wonValue)} won`}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* How long each stage takes */}
            <Panel
              title="How long each stage takes"
              hint="Median days, over deals that have actually left the stage. A deal still sitting in it has not told you yet."
              icon={Clock}
            >
              {OPEN_STAGES.every((s) => analysis.stageDays[s] === undefined) ? (
                <Empty>No deal has completed a stage in this window yet.</Empty>
              ) : (
                <div className="space-y-2.5">
                  {OPEN_STAGES.map((stage) => {
                    const d = analysis.stageDays[stage];
                    const longest = Math.max(...OPEN_STAGES.map((s) => analysis.stageDays[s] ?? 0), 1);
                    return (
                      <div key={stage}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">{stageLabel(stage)}</span>
                          <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                            {d === undefined ? '—' : `${d} days`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                          <div
                            className="h-full rounded-full bg-[var(--indigo)]"
                            style={{ width: `${((d ?? 0) / longest) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* Why we lose */}
            <Panel
              title="Why deals are lost"
              hint="Ranked by how often, with what it cost. Closes with no reason recorded are left out rather than counted as blank."
              icon={ThumbsDown}
            >
              {analysis.lostReasons.length === 0 ? (
                <Empty>No reasons recorded yet. They are asked for whenever a deal is marked lost.</Empty>
              ) : (
                <div className="space-y-1.5">
                  {analysis.lostReasons.map((r) => (
                    <div key={r.reason} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">{r.reason}</span>
                      <span className="flex-shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {r.count}× · {money(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Why we win */}
            <Panel
              title="Why deals are won"
              hint="The other half. Worth reading next to the losses — the same reason often appears in both."
              icon={ThumbsUp}
            >
              {analysis.wonReasons.length === 0 ? (
                <Empty>No reasons recorded yet.</Empty>
              ) : (
                <div className="space-y-1.5">
                  {analysis.wonReasons.map((r) => (
                    <div key={r.reason} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">{r.reason}</span>
                      <span className="flex-shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {r.count}× · {money(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Sources */}
          <Panel
            title="Which sources are worth working"
            hint="Volume is misleading on its own: the channel that produces the most deals is regularly the one that produces the least revenue."
            icon={TrendingUp}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Source</th>
                    <th className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Open</th>
                    <th className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Won</th>
                    <th className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Lost</th>
                    <th className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Win rate</th>
                    <th className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Won value</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.sources.map((row) => (
                    <tr key={row.source} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-2 py-2 text-[12.5px] font-medium text-[var(--text-primary)]">{row.source}</td>
                      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[var(--text-tertiary)]">{row.open}</td>
                      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-emerald-600 dark:text-emerald-400">{row.won}</td>
                      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-rose-500">{row.lost}</td>
                      <td className="px-2 py-2 text-right text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
                        {row.winRate === null ? '—' : `${row.winRate}%`}
                      </td>
                      <td className="px-2 py-2 text-right text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
                        {money(row.wonValue)}
                        {row.wonArr > 0 && (
                          <span className="ml-1 text-[10.5px] font-normal text-[var(--indigo)]">
                            {money(row.wonArr)} ARR
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
