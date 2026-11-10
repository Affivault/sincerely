import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { summarisePipeline, formatMoney, formatDayMonth, isOpen, type Deal } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';

/* ═══════════════════════════════════════════════════════════════════════
   The CRM side of the day, on Home.

   Home said everything about sending and nothing about what the sending
   was for. This is the deals board in three lines: what is open, what was
   won in the last 30 days, and the next deal due to close. It hides itself
   for an account that has never had a deal, rather than showing noughts.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number): string {
  return Math.abs(v) >= 10_000 ? formatMoney(v, undefined, { compact: true }) : formatMoney(v);
}

/** The open deal with the nearest expected close date, today or later. */
function nextToClose(deals: Deal[]): Deal | null {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let best: Deal | null = null;
  let bestAt = Infinity;
  for (const d of deals) {
    if (!isOpen(d.stage) || !d.expected_close_date) continue;
    const at = new Date(d.expected_close_date).getTime();
    if (!Number.isFinite(at) || at < today.getTime()) continue;
    if (at < bestAt) { best = d; bestAt = at; }
  }
  return best;
}

function closeLabel(date: string): string {
  // expected_close_date is a date-only string; read it as that calendar day.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date);
  return formatDayMonth(d);
}

export function PipelineSnapshot() {
  const { data } = useQuery({
    queryKey: ['crm', 'deals'],
    queryFn: () => crmApi.listDeals(),
    staleTime: 60_000,
    meta: { silentError: true },
  });
  const deals = Array.isArray(data) ? data : [];
  if (deals.length === 0) return null;

  const s = summarisePipeline(deals);
  const next = nextToClose(deals);

  return (
    <section className="panel overflow-hidden" data-pipeline-snapshot>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <h2 className="text-strong font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight">Pipeline</h2>
        <Link to="/deals" className="text-body font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex min-h-6 items-center gap-0.5 transition-colors">
          Deals <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
        <div className="px-4 py-3">
          <dt className="text-caption text-[var(--text-tertiary)]">Open</dt>
          <dd className="mt-0.5 text-heading font-semibold tabular text-[var(--text-primary)]">{money(s.open)}</dd>
          <dd className="text-caption text-[var(--text-tertiary)]">{s.openCount} {s.openCount === 1 ? 'deal' : 'deals'}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-caption text-[var(--text-tertiary)]">Won, last 30 days</dt>
          <dd className="mt-0.5 text-heading font-semibold tabular text-[var(--text-primary)]">{money(s.wonRecent)}</dd>
          <dd className="text-caption text-[var(--text-tertiary)]">{s.wonRecentCount} {s.wonRecentCount === 1 ? 'deal' : 'deals'}</dd>
        </div>
      </dl>
      {next ? (
        <Link
          to={`/deals/${next.id}`}
          className="group flex items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-caption text-[var(--text-tertiary)]">Next to close, {closeLabel(next.expected_close_date!)}</span>
            <span className="block text-body font-medium text-[var(--text-primary)] truncate">{next.title}</span>
          </span>
          <span className="text-body font-semibold tabular text-[var(--text-secondary)]">{money(Number(next.value) || 0)}</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--text-tertiary)]" />
        </Link>
      ) : s.overdueCount > 0 ? (
        <Link to="/deals" className="block border-t border-[var(--border-subtle)] px-4 py-3 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          {s.overdueCount} open {s.overdueCount === 1 ? 'deal is' : 'deals are'} past {s.overdueCount === 1 ? 'its' : 'their'} close date
        </Link>
      ) : null}
    </section>
  );
}
