import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus, Sparkle } from 'lucide-react';
import {
  change, changeText, moneyText, mainAmount, rateOf,
  type ResultsReport, type ResultsNumbers, type Money,
} from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   One period's results, read top to bottom:

     the sentence      what the outreach produced, in words
     the path          emails, replies, interested, meetings, deals, won -
                       each with how it moved against the period before
     what did it       the campaigns, by what they produced

   The same view is the in-app page and the page a shared link opens, so
   what a manager or client sees is exactly what the account sees.
   ═══════════════════════════════════════════════════════════════════════ */

const n = (x: number) => x.toLocaleString();

function pct(r: number | null): string | null {
  if (r === null) return null;
  const v = r * 100;
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}%`;
}

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const c = change(now, before);
  const text = changeText(c);
  if (!text) return null;
  const Icon = c.direction === 'up' ? ArrowUpRight : c.direction === 'down' ? ArrowDownRight : c.direction === 'new' ? Sparkle : Minus;
  return (
    <span
      title={`${n(before)} in ${label}`}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro font-semibold',
        c.direction === 'up' || c.direction === 'new' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : c.direction === 'down' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
            : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)]',
      )}
    >
      <Icon className="h-3 w-3" />{text}
    </span>
  );
}

function Step({ label, value, sub, money, now, before, prevLabel, highlight }: {
  label: string; value: number; sub?: string | null; money?: Money[]; now: number; before: number; prevLabel: string; highlight?: boolean;
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border px-3.5 py-3', highlight ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]')}>
      <p className="text-caption font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-heading font-semibold tabular-nums text-[var(--text-primary)]">{n(value)}</p>
      {money && mainAmount(money) > 0 && (
        <p className="text-body font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{moneyText(money)}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Delta now={now} before={before} label={prevLabel} />
        {sub && <span className="text-micro text-[var(--text-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

export function ResultsPath({ current: c, before: b, prevLabel }: { current: ResultsNumbers; before: ResultsNumbers; prevLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6" data-results-path>
      <Step label="Emails sent" value={c.sent} now={c.sent} before={b.sent} prevLabel={prevLabel} />
      <Step label="Replies" value={c.replies} now={c.replies} before={b.replies} prevLabel={prevLabel}
        sub={pct(rateOf(c.replies, c.sent, 50)) ? `${pct(rateOf(c.replies, c.sent, 50))} of sent` : null} />
      <Step label="Interested" value={c.positive} now={c.positive} before={b.positive} prevLabel={prevLabel}
        sub={pct(rateOf(c.positive, c.replies, 5)) ? `${pct(rateOf(c.positive, c.replies, 5))} of replies` : null} />
      <Step label="Meetings" value={c.meetings} now={c.meetings} before={b.meetings} prevLabel={prevLabel} />
      <Step label="New deals" value={c.deals} money={c.pipeline} now={mainAmount(c.pipeline) || c.deals} before={mainAmount(b.pipeline) || b.deals} prevLabel={prevLabel} />
      <Step label="Won" value={c.won_deals} money={c.won} now={mainAmount(c.won) || c.won_deals} before={mainAmount(b.won) || b.won_deals} prevLabel={prevLabel} highlight={mainAmount(c.won) > 0} />
    </div>
  );
}

export function ResultsView({ report, linkCampaigns = true }: { report: ResultsReport; linkCampaigns?: boolean }) {
  const r = report;
  const nothing = !r.current.sent && !r.current.replies && !r.current.meetings && !r.current.deals && !r.current.won_deals;
  return (
    <div className="space-y-4" data-results>
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4">
        <p className="text-caption font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {r.period.label}{r.period.partial ? ' so far' : ''}
        </p>
        <p className="mt-1.5 text-[1.375rem] font-semibold leading-snug text-[var(--text-primary)]" data-results-headline>{r.headline}</p>
        {!nothing && (
          <p className="mt-1 text-caption text-[var(--text-tertiary)]">Compared with {r.previous.label}. Only what came from outreach is counted: replies to campaign emails, and meetings and deals that a campaign started.</p>
        )}
      </div>

      {!nothing && <ResultsPath current={r.current} before={r.before} prevLabel={r.previous.label} />}

      {r.campaigns.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-results-campaigns>
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-strong font-semibold text-[var(--text-primary)]">What did it</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2 pl-4 pr-3">Campaign</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  <th className="px-3 py-2 text-right">Replies</th>
                  <th className="px-3 py-2 text-right">Meetings</th>
                  <th className="px-3 py-2 text-right">New pipeline</th>
                  <th className="py-2 pl-3 pr-4 text-right">Won</th>
                </tr>
              </thead>
              <tbody>
                {r.campaigns.slice(0, 12).map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="max-w-[260px] py-2.5 pl-4 pr-3">
                      {linkCampaigns
                        ? <Link to={`/campaigns/${c.id}`} className="block truncate text-body font-medium text-[var(--text-primary)] hover:text-[var(--indigo)] hover:underline">{c.name}</Link>
                        : <span className="block truncate text-body font-medium text-[var(--text-primary)]">{c.name}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-body tabular-nums text-[var(--text-secondary)]">{n(c.sent)}</td>
                    <td className="px-3 py-2.5 text-right text-body tabular-nums text-[var(--text-secondary)]">{n(c.replies)}</td>
                    <td className="px-3 py-2.5 text-right text-body tabular-nums text-[var(--text-secondary)]">{n(c.meetings)}</td>
                    <td className="px-3 py-2.5 text-right text-body tabular-nums text-[var(--text-secondary)]">{mainAmount(c.pipeline) ? moneyText(c.pipeline) : '-'}</td>
                    <td className={cn('py-2.5 pl-3 pr-4 text-right text-body font-semibold tabular-nums', mainAmount(c.won) ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-muted)]')}>
                      {mainAmount(c.won) ? moneyText(c.won) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
