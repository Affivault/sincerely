import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ChevronRight, XCircle } from 'lucide-react';
import { formatCredits, type AdminAccountRow } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Spinner } from '../ui/Spinner';
import { Avatar } from '../shared/Avatar';
import { SearchInput } from '../shared/SearchInput';
import { useDebounce } from '../../hooks/useDebounce';
import { cn } from '../../lib/utils';
import { PlanBadge, moneyTone, monthLabel, relTime, thisMonth, usd } from './adminFormat';

type Filter = 'all' | 'paying' | 'trial' | 'free' | 'lifetime' | 'suspended' | 'losing' | 'near_cap';
type Sort = 'newest' | 'last_seen' | 'credits' | 'cost' | 'revenue' | 'profit' | 'lifetime_profit';

const FILTERS: Array<{ id: Filter; label: string; test: (a: AdminAccountRow) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'paying', label: 'Paying', test: (a) => a.status === 'active' && ['starter', 'growth', 'scale'].includes(a.plan) },
  { id: 'trial', label: 'On trial', test: (a) => a.status === 'trialing' && a.plan !== 'lifetime' },
  { id: 'free', label: 'Free', test: (a) => a.effective_plan === 'free' },
  { id: 'lifetime', label: 'Lifetime', test: (a) => a.plan === 'lifetime' },
  { id: 'near_cap', label: 'Near credit cap', test: (a) => a.credit_allowance > 0 && a.credits_used >= a.credit_allowance * 0.8 },
  { id: 'losing', label: 'Losing money', test: (a) => a.losing },
  { id: 'suspended', label: 'Suspended', test: (a) => a.suspended },
];

const SORTS: Array<{ id: Sort; label: string; key: (a: AdminAccountRow) => number }> = [
  { id: 'newest', label: 'Newest', key: (a) => new Date(a.created_at).getTime() },
  { id: 'last_seen', label: 'Last seen', key: (a) => (a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0) },
  { id: 'credits', label: 'Credits used', key: (a) => a.credits_used },
  { id: 'cost', label: 'Cost to us', key: (a) => a.cost_usd },
  { id: 'revenue', label: 'Paid this month', key: (a) => a.revenue_usd },
  { id: 'profit', label: 'Profit this month', key: (a) => a.profit_usd },
  { id: 'lifetime_profit', label: 'Lifetime profit', key: (a) => a.lifetime_profit_usd },
];

function CreditMeter({ used, allowance }: { used: number; allowance: number }) {
  const pct = allowance > 0 ? Math.min(100, (used / allowance) * 100) : used > 0 ? 100 : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-[var(--indigo)]';
  return (
    <div className="min-w-[110px]">
      <p className="text-body tabular text-[var(--text-primary)]">
        {formatCredits(used)} <span className="text-[var(--text-tertiary)]">/ {formatCredits(allowance)}</span>
      </p>
      <div className="mt-1 h-1 rounded-full bg-[var(--bg-muted)] overflow-hidden">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/*
 * Every account on the platform: who they are, what plan they are on, how
 * much of their credit allowance they have used, and what they cost us
 * against what they pay. Click through for the account in full.
 */
export function AdminAccounts() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const q = useDebounce(search, 150).trim().toLowerCase();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'accounts', month],
    queryFn: () => adminApi.accounts(month),
  });

  const all = data?.accounts || [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.test).length])), [all]);
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const s = SORTS.find((x) => x.id === sort)!;
    return all
      .filter((a) => f.test(a) && (!q || a.email.toLowerCase().includes(q) || a.id.startsWith(q)))
      .sort((a, b) => s.key(b) - s.key(a));
  }, [all, filter, sort, q]);

  const totals = useMemo(() => rows.reduce(
    (t, a) => ({ credits: t.credits + a.credits_used, cost: t.cost + a.cost_usd, revenue: t.revenue + a.revenue_usd, profit: t.profit + a.profit_usd }),
    { credits: 0, cost: 0, revenue: 0, profit: 0 },
  ), [rows]);

  const months = [thisMonth(), thisMonth(-1), thisMonth(-2), thisMonth(-3), thisMonth(-4), thisMonth(-5)];

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-subtle)] flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by email or id…" className="w-full sm:w-72" />
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
          <ArrowDown className="h-3 w-3" />
          <select
            aria-label="Sort accounts by"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)]"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <select
          aria-label="Month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)]"
        >
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-subtle)] overflow-x-auto" role="tablist" aria-label="Filter accounts">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-caption font-medium transition-colors',
              filter === f.id
                ? 'bg-[var(--text-primary)] text-[var(--bg-app)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
            )}
          >
            {f.label}
            {data && <span className={cn('tabular', filter === f.id ? 'opacity-70' : 'text-[var(--text-tertiary)]')}>{counts[f.id] ?? 0}</span>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="md" /></div>
      ) : isError || !data ? (
        <p className="p-4 text-body text-[var(--text-tertiary)] flex items-center gap-2">
          <XCircle className="h-4 w-4" /> {(error as any)?.response?.data?.error || 'Accounts could not be loaded.'}
        </p>
      ) : (
        <>
          {!data.controls_ready && (
            <p className="px-4 py-2 text-caption text-amber-700 dark:text-amber-400 bg-amber-500/5 border-b border-[var(--border-subtle)] flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Run database migration 101 to turn on suspension, private notes and the activity log.
            </p>
          )}
          <div className="flex items-center gap-4 flex-wrap px-4 py-2 text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]/40">
            <span><span className="font-medium text-[var(--text-secondary)] tabular">{rows.length.toLocaleString()}</span> account{rows.length === 1 ? '' : 's'}</span>
            <span><span className="font-medium text-[var(--text-secondary)] tabular">{formatCredits(totals.credits)}</span> credits used</span>
            <span><span className="font-medium text-[var(--text-secondary)] tabular">{usd(totals.cost)}</span> cost</span>
            <span><span className="font-medium text-[var(--text-secondary)] tabular">{usd(totals.revenue)}</span> paid</span>
            <span><span className={cn('font-medium tabular', moneyTone(totals.profit))}>{usd(totals.profit)}</span> profit in {monthLabel(data.month)}</span>
          </div>

          {rows.length === 0 ? (
            <div className="py-14 text-center text-body text-[var(--text-tertiary)]">No accounts match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-caption font-medium text-[var(--text-tertiary)]">
                    <th className="py-2.5 pl-4 pr-3">Account</th>
                    <th className="py-2.5 px-3">Plan</th>
                    <th className="py-2.5 px-3">Credits this month</th>
                    <th className="py-2.5 px-3 text-right">Cost</th>
                    <th className="py-2.5 px-3 text-right">Paid</th>
                    <th className="py-2.5 px-3 text-right">Profit</th>
                    <th className="py-2.5 px-3 text-right">Lifetime profit</th>
                    <th className="py-2.5 px-3">Last seen</th>
                    <th className="py-2.5 pr-3 w-6" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => navigate(`/admin/accounts/${a.id}`)}
                      className={cn(
                        'group border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors',
                        a.suspended && 'opacity-60',
                        a.losing && !a.suspended && 'bg-amber-500/5',
                      )}
                    >
                      <td className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar email={a.email} size="lg" />
                          <div className="min-w-0">
                            <Link
                              to={`/admin/accounts/${a.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="block text-strong font-medium text-[var(--text-primary)] truncate max-w-[260px] hover:underline focus-visible:underline"
                            >
                              {a.email}
                            </Link>
                            <p className="text-micro text-[var(--text-tertiary)]">
                              Joined {relTime(a.created_at)}{!a.email_confirmed && ' · unconfirmed'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3"><PlanBadge plan={a.plan} status={a.status} suspended={a.suspended} /></td>
                      <td className="py-2.5 px-3"><CreditMeter used={a.credits_used} allowance={a.credit_allowance} /></td>
                      <td className="py-2.5 px-3 text-right text-body tabular text-[var(--text-secondary)]">{usd(a.cost_usd)}</td>
                      <td className="py-2.5 px-3 text-right text-body tabular text-[var(--text-secondary)]">{usd(a.revenue_usd)}</td>
                      <td className={cn('py-2.5 px-3 text-right text-body tabular font-medium', moneyTone(a.profit_usd))}>{usd(a.profit_usd)}</td>
                      <td className={cn('py-2.5 px-3 text-right text-body tabular', moneyTone(a.lifetime_profit_usd))}>{usd(a.lifetime_profit_usd)}</td>
                      <td className="py-2.5 px-3 text-body text-[var(--text-tertiary)] tabular whitespace-nowrap">{relTime(a.last_sign_in_at)}</td>
                      <td className="py-2.5 pr-3"><ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
