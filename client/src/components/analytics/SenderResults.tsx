import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Download, Globe, Inbox } from 'lucide-react';
import type { SenderResultRow, SenderResultsReport } from '@lemlist/shared';
import { analyticsApi } from '../../api/analytics.api';
import { AsyncPanel } from '../ui/AsyncPanel';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Input } from '../ui/Input';
import { keepPrevious } from '../../lib/listQuery';
import { downloadCsv } from '../../lib/csv';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Results by the mailbox that sent them, and by its domain.

   A campaign's reply rate is the average of every mailbox it rotates
   through, so one mailbox landing in spam drags the whole number down and
   nothing on the campaign page says which. Grouped by sender, it does: a
   mailbox with half the open rate of its siblings is the one to rest,
   re-warm or check the DNS of.

   Same definitions as the rest of analytics. Opens and replies are people,
   credited to the mailbox of the latest email they were sent in the range.
   ═══════════════════════════════════════════════════════════════════════ */

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type View = 'mailbox' | 'domain';

export function senderCsv(report: SenderResultsReport, view: View) {
  const rows = view === 'mailbox' ? report.mailboxes : report.domains;
  downloadCsv(
    `results-by-${view}-${report.from.slice(0, 10)}-to-${isoDay(new Date(Date.parse(report.to) - DAY))}.csv`,
    [view === 'mailbox' ? 'Mailbox' : 'Domain', ...(view === 'mailbox' ? ['Address'] : []),
      'Sent', 'People reached', 'Opened', 'Open rate (%)', 'Clicked', 'Click rate (%)', 'Replied', 'Reply rate (%)',
      'Bounced', 'Bounce rate (%)', 'Spam reports', 'Spam rate (%)'],
    rows.map((r) => [
      r.label, ...(view === 'mailbox' ? [r.email ?? ''] : []),
      r.sent, r.reached, r.opened, r.open_rate, r.clicked, r.click_rate, r.replied, r.reply_rate,
      r.bounced, r.bounce_rate, r.complained, r.complaint_rate,
    ]),
  );
}

export function SenderResults() {
  const today = new Date();
  const [rangeFrom, setRangeFrom] = useState(isoDay(new Date(today.getTime() - 29 * DAY)));
  const [rangeTo, setRangeTo] = useState(isoDay(today));
  const [view, setView] = useState<View>('mailbox');

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) && /^\d{4}-\d{2}-\d{2}$/.test(rangeTo) && rangeFrom <= rangeTo;
  const query = useQuery({
    queryKey: ['analytics', 'by-sender', rangeFrom, rangeTo],
    queryFn: () => analyticsApi.bySender(rangeFrom, rangeTo),
    enabled: valid,
    ...keepPrevious,
  });

  const preset = (days: number) => {
    setRangeTo(isoDay(today));
    setRangeFrom(isoDay(new Date(today.getTime() - (days - 1) * DAY)));
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5">
        <div>
          <h2 className="text-strong font-semibold text-[var(--text-primary)]">Results by sender</h2>
          <p className="mt-0.5 text-caption text-[var(--text-secondary)]">
            Each email counted under the mailbox that sent it. Rates are of the people it reached in the range.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Chip active={view === 'mailbox'} onClick={() => setView('mailbox')}><AtSign className="h-3 w-3" /> By mailbox</Chip>
          <Chip active={view === 'domain'} onClick={() => setView('domain')}><Globe className="h-3 w-3" /> By domain</Chip>
          <Input aria-label="From" type="date" value={rangeFrom} max={rangeTo} onChange={(e) => setRangeFrom(e.target.value)} className="!w-36" />
          <Input aria-label="To" type="date" value={rangeTo} min={rangeFrom} onChange={(e) => setRangeTo(e.target.value)} className="!w-36" />
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => preset(d)} className="h-8 rounded-md px-2 text-caption font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              {d}d
            </button>
          ))}
          {query.data && (
            <Button variant="secondary" size="sm" onClick={() => senderCsv(query.data!, view)}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      {!valid ? (
        <p className="px-5 py-8 text-center text-body text-[var(--text-tertiary)]">Choose a start date on or before the end date.</p>
      ) : (
        <AsyncPanel
          query={query}
          skeleton="list"
          skeletonRows={4}
          className="p-5"
          isEmpty={(r: SenderResultsReport) => r.mailboxes.length === 0}
          empty={{ icon: Inbox, title: 'Nothing sent in this range', description: 'Pick a wider range, or come back once a campaign has sent.' }}
        >
          {(r) => <div className="p-5"><SenderTable rows={view === 'mailbox' ? r.mailboxes : r.domains} view={view} truncated={r.truncated} /></div>}
        </AsyncPanel>
      )}
    </div>
  );
}

function SenderTable({ rows, view, truncated }: { rows: SenderResultRow[]; view: View; truncated: boolean }) {
  // Averages across rows that reached anyone, so a mailbox can be read against its siblings.
  const live = rows.filter((r) => r.reached > 0);
  const avg = (k: 'open_rate' | 'reply_rate' | 'bounce_rate') => (live.length ? live.reduce((n, r) => n + r[k], 0) / live.length : 0);
  const avgOpen = avg('open_rate');
  const avgReply = avg('reply_rate');

  const pctCell = (v: number, n: number, tone?: string) => (
    <td className="px-3 py-2.5 text-right tabular">
      <span className={cn('font-semibold', tone || 'text-[var(--text-primary)]')}>{v}%</span>
      <span className="block text-caption text-[var(--text-tertiary)]">{n.toLocaleString()}</span>
    </td>
  );

  return (
    <>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-micro font-medium text-[var(--text-tertiary)]">
              <th className="px-5 py-2 text-left font-medium">{view === 'mailbox' ? 'Mailbox' : 'Domain'}</th>
              <th className="px-3 py-2 text-right font-medium">Sent</th>
              <th className="px-3 py-2 text-right font-medium">Reached</th>
              <th className="px-3 py-2 text-right font-medium">Opened</th>
              <th className="px-3 py-2 text-right font-medium">Clicked</th>
              <th className="px-3 py-2 text-right font-medium">Replied</th>
              <th className="px-3 py-2 text-right font-medium">Bounced</th>
              <th className="px-3 py-2 text-right font-medium">Spam</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Well below its siblings, on enough people to mean something.
              const lagging = (rate: number, mean: number) => r.reached >= 50 && live.length >= 2 && rate < mean * 0.5;
              return (
                <tr key={r.key} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="max-w-[260px] px-5 py-2.5">
                    <span className="block truncate font-medium text-[var(--text-primary)]">{r.label}</span>
                    {view === 'mailbox' && r.email && r.email !== r.label && (
                      <span className="block truncate text-caption text-[var(--text-tertiary)]">{r.email}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular font-semibold text-[var(--text-primary)]">{r.sent.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular text-[var(--text-secondary)]">{r.reached.toLocaleString()}</td>
                  {pctCell(r.open_rate, r.opened, lagging(r.open_rate, avgOpen) ? 'text-amber-700 dark:text-amber-400' : undefined)}
                  {pctCell(r.click_rate, r.clicked)}
                  {pctCell(r.reply_rate, r.replied, lagging(r.reply_rate, avgReply) ? 'text-amber-700 dark:text-amber-400' : undefined)}
                  {pctCell(r.bounce_rate, r.bounced, r.bounce_rate >= 5 ? 'text-rose-700 dark:text-rose-400' : undefined)}
                  {pctCell(r.complaint_rate, r.complained, r.complained > 0 ? 'text-rose-700 dark:text-rose-400' : undefined)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-caption text-[var(--text-tertiary)]">
        Amber is well under the average of the others; red is a bounce rate of 5% or more, or any spam report.
        {rows.some((r) => r.key === 'unrecorded') && ' "Not recorded" is mail sent before the sending mailbox was saved on each email.'}
        {truncated && ' This range is very large, so the figures stop at the first 200,000 rows of each kind.'}
      </p>
    </>
  );
}
