import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { billingApi } from '../../api/billing.api';
import { CREDIT_ACTION_LABELS, TRIAL_CREDIT_CAP, creditsLabel, formatCredits, formatDate, formatDayMonth } from '@lemlist/shared';
import { cn } from '../../lib/utils';

const HISTORY_REASONS: Record<string, string> = {
  no_email_found: 'no email found',
  provider_error: 'provider error',
  no_results: 'no results',
  nothing_found: 'nothing found',
  enrich_failed: 'enrich failed',
  concurrent_reveal: 'duplicate',
};

/*
 * Credits on the billing page: what is left, what each action costs, what
 * this month's credits went on, and every charge. Credits are hard-capped:
 * there is nothing to buy, so the way to more is a bigger plan.
 */
export function CreditsPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['billing', 'credits'], queryFn: billingApi.credits });

  // Arriving from "Usage and prices" on the Prospector lands on this panel.
  useEffect(() => {
    if (data && window.location.hash === '#credits') document.getElementById('credits')?.scrollIntoView({ block: 'start' });
  }, [data]);

  const c = data?.credits;
  const limited = !!c && c.allowance >= 0;
  const pct = limited && c!.allowance > 0 ? Math.max(0, Math.min(100, (c!.plan_remaining / c!.allowance) * 100)) : 0;
  // Low on what can still be spent, bonus credits included.
  const low = limited && c!.remaining <= c!.allowance * 0.2;

  return (
    <div id="credits" className="panel p-5 mb-4 scroll-mt-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-body font-medium text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Coins className="h-4 w-4" style={{ color: 'var(--indigo)' }} strokeWidth={1.75} /> Credits this month
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-hero font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.03em]">
              {c ? (limited ? formatCredits(c.remaining) : 'Unlimited') : '—'}
            </span>
            {limited && <span className="text-strong text-[var(--text-tertiary)]">left of {formatCredits(c!.allowance)}</span>}
          </div>
          {c && (
            <p className="mt-2 text-caption text-[var(--text-tertiary)]">
              {formatCredits(c.used)} used. Resets {formatDayMonth(new Date(c.resets_at))}.
              {c.purchased > 0 && ` Includes ${formatCredits(c.purchased)} bonus credits, which never expire and are used after your plan's.`}
            </p>
          )}
        </div>
        {limited && (
          <div className="w-full sm:w-56 mt-1">
            <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: low ? '#B88124' : 'var(--indigo)' }} />
            </div>
          </div>
        )}
      </div>

      {low && (
        <p className="mt-3 text-body text-amber-700 dark:text-amber-400">
          Running low. When credits run out, searches, email finds, deep checks and enrichments stop until {c ? formatDayMonth(new Date(c.resets_at)) : 'the reset'}. Upgrade below for more.
        </p>
      )}
      {data?.trial_capped && (
        <p className="mt-3 text-body text-[var(--text-secondary)]">
          Your trial includes {TRIAL_CREDIT_CAP} credits. The plan's full monthly credits start with your first payment.
        </p>
      )}
      {isError && <p className="mt-3 text-body text-[var(--text-tertiary)]">Credit usage could not be loaded.</p>}
      {isLoading && <p className="mt-3 text-body text-[var(--text-tertiary)]">Loading credits…</p>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
          <div>
            <h3 className="text-strong font-semibold text-[var(--text-primary)] mb-2">What credits cost</h3>
            <table className="w-full text-body">
              <tbody>
                {data.prices.map((p) => (
                  <tr key={p.action} className="border-t border-[var(--border-subtle)] align-top">
                    <td className="py-2 pr-3">
                      <span className="text-[var(--text-primary)]">{p.label}</span>
                      <span className="block text-caption text-[var(--text-tertiary)]">{p.note}</span>
                    </td>
                    <td className="py-2 text-right tabular font-medium text-[var(--text-primary)] whitespace-nowrap">{creditsLabel(p.price)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--border-subtle)]">
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">Company directory search, match counts, free email checks</td>
                  <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">Free</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-strong font-semibold text-[var(--text-primary)] mb-2">Where they went</h3>
            {data.by_action.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">Nothing spent yet this month.</p>
            ) : (
              <table className="w-full text-body">
                <tbody>
                  {data.by_action.map((a) => (
                    <tr key={a.action} className="border-t border-[var(--border-subtle)]">
                      <td className="py-2 pr-3 text-[var(--text-primary)]">{CREDIT_ACTION_LABELS[a.action] || a.action}</td>
                      <td className="py-2 pr-3 text-right tabular text-[var(--text-tertiary)]">{a.count.toLocaleString()}×</td>
                      <td className="py-2 text-right tabular font-medium text-[var(--text-primary)] whitespace-nowrap">{creditsLabel(a.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {data.history.length > 0 && (
              <details className="mt-4">
                <summary className="text-body font-medium text-[var(--indigo-text)] cursor-pointer">Every charge this month</summary>
                <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                  {data.history.map((h) => {
                    const label = CREDIT_ACTION_LABELS[h.action || ''] || h.action || h.reason || 'Credits';
                    const why = h.kind === 'refund' ? `refund${h.reason && HISTORY_REASONS[h.reason] ? `, ${HISTORY_REASONS[h.reason]}` : ''}` : null;
                    return (
                      <li key={h.id} className="py-1.5 flex items-center gap-3 text-caption">
                        <span className="text-[var(--text-tertiary)] tabular w-24 flex-shrink-0">{formatDate(new Date(h.created_at))}</span>
                        <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">{label}{why && <span className="text-[var(--text-tertiary)]"> ({why})</span>}</span>
                        <span className={cn('tabular font-medium', h.delta < 0 ? 'text-[var(--text-primary)]' : 'text-emerald-600 dark:text-emerald-400')}>
                          {h.delta > 0 ? '+' : ''}{formatCredits(h.delta)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
