import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, TrendingUp, Reply, Info, Download } from 'lucide-react';
import { analyticsApi, type CampaignRevenueRow } from '../../api/analytics.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { valuePerReply } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   What the outreach earned.

   Every tool in this category reports reply rate, because reply rate is the
   last thing it can see before the handoff. A sequence replying at 12% that
   closes nothing is worse than one replying at 4% that closes three deals a
   quarter, and a two-product stack structurally cannot tell you which one
   you have - the replies are in one company's database and the revenue is
   in another's.

   This page is the join. It is the reason for owning both halves.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}

/** A rate as a percentage, or an em dash where there is no evidence yet. */
function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export the campaign revenue table as a CSV file the browser downloads directly — no server round-trip. */
function exportRevenueCsv(rows: CampaignRevenueRow[]) {
  const header = ['Campaign', 'Sent', 'Replied', 'Deals', 'Won', 'Win rate', 'Per reply', 'Closed'];
  const body = rows.map(r => [
    r.name, r.sent, r.replied, r.deals, r.won, pct(r.win_rate),
    r.value_per_reply === null ? '' : r.value_per_reply, r.won_value,
  ].map(csvCell).join(','));
  const csv = [header.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `revenue-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string; tone?: 'money';
}) {
  return (
    <div className="card px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </p>
      <p className={cn(
        'mt-1.5 text-[22px] font-semibold leading-none tabular-nums',
        tone === 'money' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-primary)]',
      )}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

export function RevenuePage() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['analytics', 'revenue'],
    queryFn: analyticsApi.revenue,
  });

  const totals = useMemo(() => {
    const list: CampaignRevenueRow[] = rows || [];
    const won = list.reduce((n, r) => n + r.won_value, 0);
    const strong = list.reduce((n, r) => n + r.strong_won_value, 0);
    const replied = list.reduce((n, r) => n + r.replied, 0);
    return {
      won,
      strong,
      replied,
      pipeline: list.reduce((n, r) => n + r.weighted_open, 0),
      deals: list.reduce((n, r) => n + r.deals, 0),
      perReply: valuePerReply(won, replied),
      /* How much of the headline rests on evidence you would defend. */
      strongShare: won > 0 ? strong / won : null,
    };
  }, [rows]);

  // Campaigns that never produced a deal are still worth seeing — knowing a
  // sequence earned nothing is the point — but they sort below the ones that
  // did, and never above a campaign with real revenue.
  const sorted = useMemo(
    () => [...(rows || [])].sort((a, b) => b.won_value - a.won_value || b.replied - a.replied),
    [rows],
  );

  const nothingAttributed = !isLoading && totals.deals === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </span>
        }
        title="Revenue by campaign"
        description="What your outreach earned, not just what it sent."
        actions={sorted.length > 0 && (
          <Button variant="secondary" onClick={() => exportRevenueCsv(sorted)} title="Export the table below as a CSV file">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        )}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={Banknote} tone="money" label="Closed from outreach"
            value={money(totals.won)}
            sub={totals.strongShare === null
              ? 'Nothing closed yet'
              : `${money(totals.strong)} on strong evidence`}
          />
          <Stat
            icon={TrendingUp} label="Weighted pipeline"
            value={money(totals.pipeline)}
            sub="Open deals, discounted by stage"
          />
          <Stat
            icon={Reply} label="Value per reply"
            value={totals.perReply === null ? '—' : money(totals.perReply)}
            sub={totals.replied > 0
              ? `Across ${totals.replied.toLocaleString()} repl${totals.replied === 1 ? 'y' : 'ies'}`
              : 'No replies yet'}
          />
          <Stat
            icon={Info} label="Deals attributed"
            value={totals.deals.toLocaleString()}
            sub={`${sorted.filter((r) => r.won > 0).length} campaign(s) have closed one`}
          />
        </div>
      )}

      {nothingAttributed ? (
        <div className="panel">
          {/* An empty state that explains the mechanism, because "no data" is
              not actionable and this one has a specific cause. */}
          <EmptyState
            icon={Banknote}
            title="No revenue attributed yet"
            description="A deal is credited to a campaign when it is created from a reply to that campaign — from the unibox, or from a contact who replied. Existing deals were credited where a reply came before the deal."
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2.5 pl-4 pr-3">Campaign</th>
                  <th className="py-2.5 px-3 text-right">Sent</th>
                  <th className="py-2.5 px-3 text-right">Replied</th>
                  <th className="py-2.5 px-3 text-right">Deals</th>
                  <th className="py-2.5 px-3 text-right">Won</th>
                  <th className="py-2.5 px-3 text-right">Win rate</th>
                  <th className="py-2.5 px-3 text-right">Per reply</th>
                  <th className="py-2.5 pl-3 pr-4 text-right">Closed</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td colSpan={8} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      </tr>
                    ))
                  : sorted.map((r) => {
                      const earned = r.won_value > 0;
                      return (
                        <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                          <td className="py-2.5 pl-4 pr-3 max-w-[280px]">
                            <Link
                              to={`/analytics/revenue/${r.id}`}
                              className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--indigo)] hover:underline decoration-[var(--indigo)]/40 underline-offset-2"
                            >
                              {r.name}
                            </Link>
                          </td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-tertiary)]">{r.sent.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-secondary)]">{r.replied.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-secondary)]">{r.deals.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-secondary)]">{r.won.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-tertiary)]">{pct(r.win_rate)}</td>
                          <td className="py-2.5 px-3 text-right text-[12.5px] tabular-nums text-[var(--text-tertiary)]">
                            {r.value_per_reply === null ? '—' : money(r.value_per_reply)}
                          </td>
                          <td className={cn(
                            'py-2.5 pl-3 pr-4 text-right text-[13px] font-semibold tabular-nums',
                            earned ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-muted)]',
                          )}>
                            {earned ? money(r.won_value) : '—'}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!nothingAttributed && !isLoading && totals.strongShare !== null && totals.strongShare < 1 && (
        <p className="px-1 text-[11.5px] text-[var(--text-tertiary)]">
          {money(totals.won - totals.strong)} of the total rests on weaker evidence — deals whose
          contact was in a campaign but never replied to it. Those are shown because they may well
          be real, and named because they may well not be.
        </p>
      )}
    </div>
  );
}
