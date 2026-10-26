import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns3, Download, Search, X } from 'lucide-react';
import { COMPARE_MAX, COMPARE_MIN, type CampaignComparisonRow } from '@lemlist/shared';
import { analyticsApi, type CampaignListItem } from '../../api/analytics.api';
import { AsyncPanel } from '../ui/AsyncPanel';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { EmptyState } from '../shared/EmptyState';
import { keepPrevious } from '../../lib/listQuery';
import { downloadCsv, csvDate } from '../../lib/csv';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Two to four campaigns, side by side.

   "Which of these worked better" was answered by opening each campaign in
   turn and remembering the numbers, which is how a 4.1% reply rate on 30
   people beats a 3.8% one on 900 in somebody's head. Here they sit in
   columns, every figure on the definitions the rest of analytics uses
   (people, not events; rates over the people reached), with the counts
   under each rate so the size of the sample is never out of sight.

   The best figure in each row is marked - lowest for bounces and
   unsubscribes - but only between campaigns that reached anyone.
   ═══════════════════════════════════════════════════════════════════════ */

type Metric = {
  label: string;
  count: (r: CampaignComparisonRow) => number;
  rate?: (r: CampaignComparisonRow) => number;
  /** Which way is better, for marking the leader; none for plain volume. */
  better?: 'high' | 'low';
  note?: string;
};

const METRICS: Metric[] = [
  { label: 'Emails sent', count: (r) => r.sent },
  { label: 'People reached', count: (r) => r.reached, note: 'The denominator of every rate below.' },
  { label: 'Opened', count: (r) => r.opened, rate: (r) => r.open_rate, better: 'high', note: 'People, human opens only.' },
  { label: 'Clicked', count: (r) => r.clicked, rate: (r) => r.click_rate, better: 'high' },
  { label: 'Replied', count: (r) => r.replied, rate: (r) => r.reply_rate, better: 'high', note: 'People, however many times they wrote.' },
  { label: 'Positive replies', count: (r) => r.positive, rate: (r) => r.positive_rate, better: 'high', note: 'Interested or asking to meet.' },
  { label: 'Meetings', count: (r) => r.meetings, rate: (r) => r.meeting_rate, better: 'high' },
  { label: 'Bounced', count: (r) => r.bounced, rate: (r) => r.bounce_rate, better: 'low', note: 'Over everyone a send was attempted to.' },
  { label: 'Unsubscribed', count: (r) => r.unsubscribed, rate: (r) => r.unsubscribe_rate, better: 'low' },
];

const fmt = (n: number) => n.toLocaleString();

export function comparisonCsv(rows: CampaignComparisonRow[]) {
  downloadCsv(
    `campaign-comparison-${csvDate()}.csv`,
    ['Metric', ...rows.map((r) => r.name)],
    METRICS.flatMap((m) => {
      const lines: (string | number)[][] = [[m.label, ...rows.map(m.count)]];
      if (m.rate) lines.push([`${m.label} rate (%)`, ...rows.map(m.rate)]);
      return lines;
    }),
  );
}

export function CampaignCompare({ campaigns }: { campaigns: CampaignListItem[] }) {
  // The two busiest to start with, so the view says something before any picking.
  const [picked, setPicked] = useState<string[]>(() =>
    [...campaigns].sort((a, b) => b.sent - a.sent).slice(0, COMPARE_MIN).map((c) => c.id));
  const [search, setSearch] = useState('');

  const ready = picked.length >= COMPARE_MIN;
  const query = useQuery({
    queryKey: ['analytics', 'compare', picked.join(',')],
    queryFn: () => analyticsApi.compare(picked),
    enabled: ready,
    ...keepPrevious,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? campaigns.filter((c) => c.name.toLowerCase().includes(q)) : campaigns;
  }, [campaigns, search]);

  const toggle = (id: string) => setPicked((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= COMPARE_MAX ? prev : [...prev, id]
  ));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
          <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a campaign…"
            aria-label="Find a campaign to compare"
            className="min-w-0 flex-1 bg-transparent text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>
        <p className="px-3 pt-2 text-caption text-[var(--text-tertiary)]">
          Pick {COMPARE_MIN} to {COMPARE_MAX}. {picked.length} chosen.
        </p>
        <ul className="max-h-[420px] overflow-y-auto py-1">
          {shown.map((c) => {
            const on = picked.includes(c.id);
            const full = !on && picked.length >= COMPARE_MAX;
            return (
              <li key={c.id} className="flex items-center gap-2.5 px-3 py-1.5">
                <Checkbox checked={on} onChange={() => toggle(c.id)} disabled={full} aria-label={`Compare ${c.name}`} />
                <span className={cn('min-w-0 flex-1 truncate text-body', full ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]')}>{c.name}</span>
                <span className="flex-shrink-0 text-caption tabular text-[var(--text-tertiary)]">{fmt(c.sent)}</span>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-4 text-center text-body text-[var(--text-tertiary)]">No campaign matches.</li>}
        </ul>
      </div>

      <div className="panel min-w-0 overflow-hidden">
        {!ready ? (
          <EmptyState icon={Columns3} title="Pick at least two campaigns" description="Their sends, replies, meetings and bounces line up here, on the same definitions as everywhere else." />
        ) : (
          <AsyncPanel query={query} skeleton="panel">
            {(rows) => (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5">
                  <div>
                    <h2 className="text-strong font-semibold text-[var(--text-primary)]">Side by side</h2>
                    <p className="mt-0.5 text-caption text-[var(--text-secondary)]">All time. Rates are of the people each campaign reached.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => comparisonCsv(rows)}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-body">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)]">
                        <th className="px-4 py-2.5 text-left text-micro font-medium text-[var(--text-tertiary)]"><span className="sr-only">Metric</span></th>
                        {rows.map((r) => (
                          <th key={r.id} className="min-w-[140px] px-3 py-2.5 text-right align-bottom">
                            <span className="flex items-center justify-end gap-1">
                              <span className="truncate text-body font-semibold text-[var(--text-primary)]">{r.name}</span>
                              <button type="button" onClick={() => toggle(r.id)} className="icon-btn h-5 w-5" aria-label={`Remove ${r.name}`} title="Remove">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m) => {
                        const eligible = rows.filter((r) => r.reached > 0);
                        const scores = eligible.map((r) => (m.rate ? m.rate(r) : m.count(r)));
                        const best = m.better && eligible.length >= 2
                          ? (m.better === 'high' ? Math.max(...scores) : Math.min(...scores))
                          : null;
                        const tied = best !== null && scores.every((s) => s === best);
                        return (
                          <tr key={m.label} className="border-b border-[var(--border-subtle)] last:border-0">
                            <th scope="row" className="px-4 py-2.5 text-left font-medium text-[var(--text-secondary)]">
                              {m.label}
                              {m.note && <span className="block text-caption font-normal text-[var(--text-tertiary)]">{m.note}</span>}
                            </th>
                            {rows.map((r) => {
                              const v = m.rate ? m.rate(r) : m.count(r);
                              const lead = best !== null && !tied && r.reached > 0 && v === best;
                              return (
                                <td key={r.id} className="px-3 py-2.5 text-right tabular">
                                  {m.rate ? (
                                    <>
                                      <span className={cn('font-semibold', lead ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-primary)]')}>{v}%</span>
                                      <span className="block text-caption text-[var(--text-tertiary)]">{fmt(m.count(r))}</span>
                                    </>
                                  ) : (
                                    <span className="font-semibold text-[var(--text-primary)]">{fmt(v)}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </AsyncPanel>
        )}
      </div>
    </div>
  );
}
