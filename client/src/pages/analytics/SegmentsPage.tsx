import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Target, Info, Banknote, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { AsyncPanel } from '../../components/ui/AsyncPanel';
import { segmentsApi } from '../../api/segments.api';
import { cn } from '../../lib/utils';
import {
  DIMENSION_LABELS, MIN_CLOSED_FOR_RATE, LIFT_THRESHOLD,
  type SegmentDimension, type SegmentRow, type SegmentReport,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What the people who buy have in common.

   The revenue report answers "which campaign earned money". This answers
   the question that decides the next list, and it is the one thing a
   two-product stack cannot do: the replies live in one company's
   database and the revenue in another's.

   It is also the easiest screen in this product to make actively
   harmful. Slice forty deals eight ways and something will always look
   three times better - that is arithmetic, not a finding - and a page
   that renders it as "fintech closes at 6x" has told somebody to rebuild
   their list around noise. They will, because it is exactly the kind of
   insight people want to be true.

   So this screen leads with the verdict from shared/segment-revenue,
   which refuses to name a standout until both the segment and the
   baseline have enough closed deals behind them, ranks on the LOWER
   bound of a win rate rather than the rate, and says how many segments
   were compared - because "best of twelve" and "best of two" are
   different claims and only the reader can weigh that.
   ═══════════════════════════════════════════════════════════════════════ */

const DIMENSIONS = Object.keys(DIMENSION_LABELS) as SegmentDimension[];

function money(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `£${Math.round(n / 1000)}k`;
  return `£${Math.round(n)}`;
}

function Row({ row, dimension }: { row: SegmentRow; dimension: SegmentDimension }) {
  const strong = row.lift != null && row.lift >= LIFT_THRESHOLD;
  const weak = row.lift != null && row.lift < 1 / LIFT_THRESHOLD;

  return (
    <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-strong font-semibold text-[var(--text-primary)]">{row.value}</span>

          {/*
            * The multiple, only where shared was willing to compute one -
            * which needs this segment AND the account baseline to have
            * cleared the closed-deal floor.
            */}
          {row.lift != null && (
            <span className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold',
              strong ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : weak ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
            )} data-segment-lift>
              {strong && <TrendingUp className="h-3 w-3" />}
              {row.lift}× your average
            </span>
          )}
        </div>

        {/*
          * Why there is no rate, where there is not. A blank cell reads as
          * zero; a sentence reads as "not yet".
          */}
        {row.note && (
          <p className="mt-0.5 text-caption leading-snug text-[var(--text-tertiary)]" data-segment-note>
            {row.note}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-5 text-right">
        <div className="w-16">
          <div className="text-strong font-semibold tabular text-[var(--text-primary)]">{row.reached.toLocaleString()}</div>
          <div className="text-micro text-[var(--text-tertiary)]">reached</div>
        </div>

        <div className="hidden w-16 sm:block">
          <div className={cn('text-strong tabular', row.replyRate != null ? 'font-semibold text-[var(--text-primary)]' : 'text-caption text-[var(--text-tertiary)]')}>
            {row.replyRate != null ? `${(row.replyRate * 100).toFixed(1)}%` : `${row.replied}/${row.reached}`}
          </div>
          <div className="text-micro text-[var(--text-tertiary)]">replied</div>
        </div>

        <div className="w-16">
          {/*
            * Counts, not a win rate, below the floor. Won-of-closed over
            * three deals is a coin flip with a percent sign.
            */}
          <div className={cn('text-strong tabular', row.winRate != null ? 'font-semibold text-[var(--text-primary)]' : 'text-caption text-[var(--text-tertiary)]')}>
            {row.winRate != null ? `${Math.round(row.winRate * 100)}%` : `${row.won}/${row.closed || 0}`}
          </div>
          <div className="text-micro text-[var(--text-tertiary)]">won</div>
        </div>

        <div className="w-20">
          {/* Always true: money divided by people, no inference in it. */}
          <div className="text-strong font-semibold tabular text-[var(--text-primary)]">{money(row.wonValue)}</div>
          <div className="text-micro text-[var(--text-tertiary)]">{money(row.valuePerContact)}/contact</div>
        </div>
      </div>
    </div>
  );
}

function Verdict({ report }: { report: SegmentReport }) {
  const actionable = report.compared > 0 && report.rows.some((r) => (r.lift ?? 0) >= LIFT_THRESHOLD);
  return (
    <div className={cn(
      'rounded-xl border px-4 py-3.5',
      actionable ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60',
    )}>
      <p className="text-strong font-semibold leading-snug text-[var(--text-primary)]" data-segment-verdict>
        {report.verdict}
      </p>
      <p className="mt-1 text-caption leading-relaxed text-[var(--text-secondary)]">
        Across {report.baseline.reached.toLocaleString()} contacts reached,{' '}
        {report.baseline.closed} closed deal{report.baseline.closed === 1 ? '' : 's'}
        {report.baseline.winRate != null && <> and a {Math.round(report.baseline.winRate * 100)}% average win rate</>}
        {report.unknown > 0 && <> · {report.unknown.toLocaleString()} contacts have nothing recorded for this</>}.
      </p>
    </div>
  );
}

export function SegmentsPage() {
  const [dimension, setDimension] = useState<SegmentDimension>('industry');

  const reportQuery = useQuery({
    queryKey: ['segments', dimension],
    queryFn: () => segmentsApi.report(dimension),
    staleTime: 5 * 60_000,
  });
  const report = reportQuery.data;

  return (
    <div className="stagger space-y-5 pb-8">
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(91,91,245,0.18)] bg-[var(--indigo-subtle)]">
            <Target className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="What actually closes"
        description="Not who replies — who buys. Everyone you reached, grouped by what they have in common, against what each group actually earned."
        actions={
          <Link to="/analytics/revenue" className="btn-secondary">
            <Banknote className="h-3.5 w-3.5" /> Revenue by campaign
          </Link>
        }
      />

      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-1 scrollbar-none">
        {DIMENSIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDimension(d)}
            className={cn(
              'h-8 shrink-0 rounded-lg px-3 text-body font-medium transition-colors',
              dimension === d
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {DIMENSION_LABELS[d]}
          </button>
        ))}
      </div>

      <AsyncPanel
        query={reportQuery}
        skeleton="list"
        skeletonRows={5}
        isEmpty={(r) => r.rows.length === 0}
        empty={{
          icon: Users,
          title: 'Nothing recorded to group by',
          description: (report?.unknown ?? 0) > 0
            ? `None of the ${(report?.unknown ?? 0).toLocaleString()} contacts you reached has a ${DIMENSION_LABELS[dimension].toLowerCase()} recorded. Fill it in on the companies you care about, or import it, and this fills in by itself.`
            : 'Reach some contacts and close some deals, and this will tell you what the buyers had in common.',
        }}
      >
        {(report) => (
        <>
          <Verdict report={report} />

          {(
            <section className="panel overflow-hidden">
              <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-strong font-semibold text-[var(--text-primary)]">By {DIMENSION_LABELS[dimension].toLowerCase()}</h3>
                  <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
                    Ranked by how confidently each group beats your average — not by raw win rate, which puts small lucky groups on top.
                  </p>
                </div>
              </div>
              <div>
                {report.rows.map((row) => <Row key={row.value} row={row} dimension={dimension} />)}
              </div>
            </section>
          )}

          {/*
            * The multiple-comparisons problem, said out loud.
            *
            * This is the failure mode of every "insights" screen ever
            * built: with eight groups and a handful of wins, the top row
            * is whichever one got lucky. Stating it is the difference
            * between a tool that informs a decision and one that
            * manufactures confidence.
            */}
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <p className="text-caption leading-relaxed text-[var(--text-secondary)]" data-segment-caveat>
              Compare enough groups and one of them looks good by chance — that is arithmetic, not a
              finding. A group is only given a win rate once it has closed {MIN_CLOSED_FOR_RATE} deals,
              the multiple is computed against the cautious end of that rate rather than the flattering
              end, and the verdict says how many groups it was picked from. Until those numbers are
              there you get counts, which are true, instead of percentages, which would not be.
            </p>
          </div>

          {report.compared === 0 && report.rows.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-caption leading-relaxed text-[var(--text-secondary)]">
                Nothing here has closed enough to compare yet. The revenue-per-contact column is still
                worth reading — it needs no inference, it is money divided by people — but treat the
                ordering as a guess until the deals arrive.
              </p>
            </div>
          )}
        </>
        )}
      </AsyncPanel>
    </div>
  );
}
