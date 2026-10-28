import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { adminApi } from '../../api/admin.api';
import { CREDIT_ACTION_LABELS, formatCredits } from '@lemlist/shared';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function thisMonth(offset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
}

/*
 * What each account cost us in Icypeas credits this month against what it
 * paid through Stripe. Accounts that cost more than they pay are flagged,
 * and our own Icypeas balance sits on top so a top-up is never a surprise.
 */
export function UsageProfitPanel() {
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'usage', month],
    queryFn: () => adminApi.usage(month),
  });
  const months = [thisMonth(), thisMonth(-1), thisMonth(-2)];
  const balance = data?.provider_balance;

  const tiles = data ? [
    { label: 'Revenue', value: usd(data.totals.revenue_usd) },
    { label: 'Icypeas cost', value: usd(data.totals.cost_usd), sub: `${formatCredits(data.totals.provider_credits)} Icypeas credits` },
    { label: 'Est. Stripe fees', value: usd(data.totals.fees_usd) },
    { label: 'Gross profit', value: usd(data.totals.profit_usd), tone: data.totals.profit_usd < 0 ? 'bad' : 'good' },
    { label: 'Icypeas balance', value: balance?.credits == null ? '—' : `${formatCredits(balance.credits)} credits`, sub: balance?.note || undefined, tone: balance?.low ? 'bad' : undefined },
  ] : [];
  const losing = data?.users.filter((u) => u.losing) || [];

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] mb-5">
      <div className="flex items-center gap-3 px-4 h-12 border-b border-[var(--border-subtle)]">
        <TrendingUp className="h-4 w-4 text-[var(--indigo-text)]" />
        <p className="text-strong font-semibold text-[var(--text-primary)]">Usage and profit</p>
        <span className="flex-1" />
        <select
          aria-label="Month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)]"
        >
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="md" /></div>
      ) : isError || !data ? (
        <p className="p-4 text-body text-[var(--text-tertiary)]">{(error as any)?.response?.data?.error || 'Usage could not be loaded.'}</p>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2.5">
                <p className="text-caption font-medium text-[var(--text-tertiary)]">{t.label}</p>
                <p className={cn('mt-1 text-heading font-semibold tabular', t.tone === 'bad' ? 'text-red-600 dark:text-red-400' : t.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-primary)]')}>{t.value}</p>
                {t.sub && <p className="text-micro text-[var(--text-tertiary)] mt-0.5">{t.sub}</p>}
              </div>
            ))}
          </div>

          {balance?.low && (
            <p className="flex items-center gap-2 text-body text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" /> The Icypeas balance is low. Top it up before customers' searches and email finds start failing.
            </p>
          )}
          {!data.revenue_synced && (
            <p className="text-caption text-[var(--text-tertiary)]">Stripe could not be reached, so revenue shows only payments already recorded.</p>
          )}
          {losing.length > 0 && (
            <p className="flex items-center gap-2 text-body text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> {losing.length} account{losing.length === 1 ? ' costs' : 's cost'} more than {losing.length === 1 ? 'it pays' : 'they pay'} this month.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-body">
              <thead>
                <tr className="text-caption text-[var(--text-tertiary)]">
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium text-right">Paid calls</th>
                  <th className="py-2 pr-4 font-medium text-right">Icypeas credits</th>
                  <th className="py-2 pr-4 font-medium text-right">Cost</th>
                  <th className="py-2 font-medium text-right">Credits charged</th>
                </tr>
              </thead>
              <tbody>
                {data.by_action.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-[var(--text-tertiary)]">No paid calls this month.</td></tr>
                )}
                {data.by_action.map((a) => (
                  <tr key={a.action} className="border-t border-[var(--border-subtle)]">
                    <td className="py-2 pr-4 text-[var(--text-primary)]">{CREDIT_ACTION_LABELS[a.action] || a.action}</td>
                    <td className="py-2 pr-4 text-right tabular">{a.calls.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right tabular">{formatCredits(a.provider_credits)}</td>
                    <td className="py-2 pr-4 text-right tabular">{usd(a.cost_usd)}</td>
                    <td className="py-2 text-right tabular">{formatCredits(a.credits_charged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-body">
              <thead>
                <tr className="text-caption text-[var(--text-tertiary)]">
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">Plan</th>
                  <th className="py-2 pr-4 font-medium text-right">Credits used</th>
                  <th className="py-2 pr-4 font-medium text-right">Icypeas cost</th>
                  <th className="py-2 pr-4 font-medium text-right">Paid</th>
                  <th className="py-2 font-medium text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.users.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-[var(--text-tertiary)]">No usage or payments this month.</td></tr>
                )}
                {data.users.map((u) => (
                  <tr key={u.user_id} className={cn('border-t border-[var(--border-subtle)]', u.losing && 'bg-amber-500/5')}>
                    <td className="py-2 pr-4 text-[var(--text-primary)] truncate max-w-[260px]"><Link to={`/admin/accounts/${u.user_id}`} className="hover:underline">{u.email}</Link></td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)] capitalize">{u.plan}{u.status === 'trialing' ? ' (trial)' : ''}</td>
                    <td className="py-2 pr-4 text-right tabular">{formatCredits(u.credits_charged)}</td>
                    <td className="py-2 pr-4 text-right tabular">{usd(u.cost_usd)}</td>
                    <td className="py-2 pr-4 text-right tabular">{usd(u.revenue_usd)}</td>
                    <td className={cn('py-2 text-right tabular font-medium', u.profit_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-primary)]')}>{usd(u.profit_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-[var(--text-tertiary)]">
            Cost uses ${data.usd_per_provider_credit} per Icypeas credit (ICYPEAS_USD_PER_CREDIT). Stripe fees are estimated at 2.9% + $0.30 a payment.
            {data.unattributed_cost_usd > 0 && ` ${usd(data.unattributed_cost_usd)} of cost was not tied to an account.`}
          </p>
        </div>
      )}
    </div>
  );
}
