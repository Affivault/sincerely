import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, CreditCard, ExternalLink, PieChart, Receipt } from 'lucide-react';
import { formatDateTime } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';
import { AdminHeader } from './AdminShell';
import { Banner, Card, Tile } from './adminUi';
import { monthLabel, moneyTone, planName, thisMonth, usd } from './adminFormat';

const KIND_LABELS: Record<string, string> = {
  subscription: 'Subscription',
  invoice: 'Subscription',
  credits: 'Credit pack',
  credit_pack: 'Credit pack',
  refund: 'Refund',
};

/*
 * Money in: the month's payments from Stripe, refunds and net, the plan mix,
 * estimated MRR and who is behind on paying. Each row opens its account.
 */
export function AdminBilling() {
  const [offset, setOffset] = useState(0);
  const month = thisMonth(offset);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'billing', month], queryFn: () => adminApi.billing(month) });

  const picker = (
    <div className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous month" className="h-8 w-8 inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ChevronLeft className="h-4 w-4" /></button>
      <span className="px-2 text-body font-medium text-[var(--text-primary)] tabular min-w-[96px] text-center">{monthLabel(month)}</span>
      <button onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} aria-label="Next month" className="h-8 w-8 inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );

  return (
    <>
      <AdminHeader title="Billing" sub="Payments from Stripe, refunds, plan mix and who is behind." actions={picker} />
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : isError || !data ? (
        <p className="text-body text-[var(--text-tertiary)]">{(error as any)?.response?.data?.error || 'Billing could not be loaded.'}</p>
      ) : (
        <div className="space-y-4">
          {!data.revenue_synced && <Banner tone="warn" icon={AlertTriangle}>Stripe could not be reached just now, so this month’s payments may be behind. Refresh to try again.</Banner>}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Est. MRR" value={usd(data.est_mrr_usd)} sub="Active paid plans at list price" />
            <Tile label={`Paid in ${monthLabel(month)}`} value={usd(data.totals.gross_usd)} sub={`${data.totals.count} payment${data.totals.count === 1 ? '' : 's'}`} />
            <Tile label="Refunded" value={usd(data.totals.refunds_usd)} tone={data.totals.refunds_usd > 0 ? 'text-red-600 dark:text-red-400' : undefined} />
            <Tile label="Net" value={usd(data.totals.net_usd)} tone={moneyTone(data.totals.net_usd)} sub={data.totals.fees_usd ? `${usd(data.totals.fees_usd)} Stripe fees` : undefined} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
            <Card title="Payments" icon={Receipt} aside={<span className="text-caption text-[var(--text-tertiary)]">Newest first</span>}>
              {data.payments.length === 0 ? (
                <p className="text-body text-[var(--text-tertiary)]">No payments in {monthLabel(month)}.</p>
              ) : (
                <div className="relative overflow-x-auto -mx-4 -my-4">
                  <table className="w-full min-w-[560px] text-left text-body">
                    <thead>
                      <tr className="text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                        <th className="py-2 px-4 font-medium">Account</th>
                        <th className="py-2 px-2 font-medium">What</th>
                        <th className="py-2 px-2 font-medium text-right">Amount</th>
                        <th className="py-2 px-2 font-medium">When</th>
                        <th className="py-2 px-4 font-medium sr-only">Stripe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)]">
                          <td className="py-2 px-4 max-w-[240px] truncate">
                            {p.user_id
                              ? <Link to={`/admin/accounts?a=${p.user_id}&tab=billing`} className="text-[var(--text-primary)] hover:underline">{p.email || p.user_id.slice(0, 8)}</Link>
                              : <span className="text-[var(--text-tertiary)]">Unknown customer</span>}
                          </td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{KIND_LABELS[p.kind] || p.kind}</td>
                          <td className={cn('py-2 px-2 text-right tabular font-medium', p.amount_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-primary)]')}>{usd(p.amount_usd)}</td>
                          <td className="py-2 px-2 text-caption text-[var(--text-tertiary)] tabular whitespace-nowrap">{formatDateTime(p.paid_at)}</td>
                          <td className="py-2 px-4 text-right">
                            <a href={stripeUrl(p.stripe_ref)} target="_blank" rel="noreferrer" aria-label="Open in Stripe" className="inline-flex text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Payment failed" icon={CreditCard} tone={data.past_due.length ? 'danger' : undefined}>
                {data.past_due.length === 0 ? (
                  <p className="text-body text-[var(--text-tertiary)]">Nobody is behind.</p>
                ) : (
                  <ul className="-my-1">
                    {data.past_due.map((a) => (
                      <li key={a.id}>
                        <Link to={`/admin/accounts?a=${a.id}&tab=billing`} className="flex items-center gap-2 py-1.5 text-body hover:underline">
                          <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">{a.email}</span>
                          <span className="text-caption text-[var(--text-tertiary)]">{planName(a.plan)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Plan mix" icon={PieChart}>
                <PlanMix mix={data.plan_mix} />
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PlanMix({ mix }: { mix: Array<{ plan: string; status: string; count: number }> }) {
  const total = mix.reduce((s, m) => s + m.count, 0);
  if (!total) return <p className="text-body text-[var(--text-tertiary)]">No accounts yet.</p>;
  const rows = [...mix].sort((a, b) => b.count - a.count);
  return (
    <ul className="space-y-2">
      {rows.map((m) => (
        <li key={`${m.plan}:${m.status}`}>
          <div className="flex items-center gap-2 text-body">
            <span className="flex-1 text-[var(--text-primary)]">{planName(m.plan)}{m.status && !['active', 'free'].includes(m.status) && <span className="text-[var(--text-tertiary)]"> · {m.status.replace(/_/g, ' ')}</span>}</span>
            <span className="tabular text-[var(--text-secondary)]">{m.count.toLocaleString()}</span>
          </div>
          <span className="mt-1 block h-1 rounded-full bg-[var(--bg-muted)] overflow-hidden">
            <span className="block h-full bg-[var(--indigo)]" style={{ width: `${(m.count / total) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function stripeUrl(ref: string) {
  if (ref.startsWith('in_')) return `https://dashboard.stripe.com/invoices/${ref}`;
  if (ref.startsWith('cs_')) return `https://dashboard.stripe.com/checkout/sessions/${ref}`;
  if (ref.startsWith('pi_')) return `https://dashboard.stripe.com/payments/${ref}`;
  return `https://dashboard.stripe.com/search?query=${encodeURIComponent(ref)}`;
}
