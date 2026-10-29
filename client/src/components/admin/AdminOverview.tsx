import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowUpRight, Crown, Globe, Mail, Megaphone, Users } from 'lucide-react';
import { formatCredits } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Avatar } from '../shared/Avatar';
import { cn } from '../../lib/utils';
import { UsageProfitPanel } from './UsageProfitPanel';
import { AdminHeader } from './AdminShell';
import { PlanBadge, thisMonth, usd } from './adminFormat';

const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString());

function Kpi({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad'; to?: string }) {
  const body = (
    <>
      <p className="text-caption font-medium text-[var(--text-tertiary)] flex items-center gap-1">
        {label}
        {to && <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
      </p>
      <p className={cn(
        'mt-2 text-display leading-none font-semibold tabular tracking-[-0.02em]',
        tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-primary)]',
      )}>{value}</p>
      {hint && <p className="mt-1.5 text-micro text-[var(--text-tertiary)]">{hint}</p>}
    </>
  );
  const cls = 'group block rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5 transition-colors';
  return to ? <Link to={to} className={cn(cls, 'hover:border-[var(--border-strong)]')}>{body}</Link> : <div className={cls}>{body}</div>;
}

/*
 * The first screen: the business at a glance, what needs a look now, and
 * the month's cost against revenue.
 */
export function AdminOverview() {
  const qc = useQueryClient();
  const [grantEmail, setGrantEmail] = useState('');
  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats });
  const { data: accounts } = useQuery({ queryKey: ['admin', 'accounts', thisMonth()], queryFn: () => adminApi.accounts(thisMonth()) });

  const grantMutation = useMutation({
    mutationFn: (email: string) => adminApi.grantLifetime(email),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      setGrantEmail('');
      toast.success(`${row.email} now has lifetime access.`, { icon: '👑' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to grant lifetime access'),
  });

  // What wants a look, worst first.
  const all = accounts?.accounts || [];
  const attention = [
    ...all.filter((a) => a.status === 'past_due').map((a) => ({ a, why: 'Payment failed', tone: 'bad' as const })),
    ...all.filter((a) => a.losing && !a.suspended).map((a) => ({ a, why: `Costs ${usd(a.cost_usd)}, paid ${usd(a.revenue_usd)}`, tone: 'warn' as const })),
    ...all.filter((a) => a.credit_allowance > 0 && a.credits_used >= a.credit_allowance && !a.suspended).map((a) => ({ a, why: `Out of credits (${formatCredits(a.credits_used)} used)`, tone: 'warn' as const })),
  ].filter((x, i, arr) => arr.findIndex((y) => y.a.id === x.a.id) === i).slice(0, 8);

  return (
    <div>
      <AdminHeader title="Overview" sub="The business at a glance, and what needs a look." />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Kpi label="Est. MRR" value={stats ? `$${Math.round(stats.est_mrr_usd).toLocaleString()}` : '—'} hint="Active paid plans at list price" to="/admin/billing" />
        <Kpi label="Paying" value={n(stats?.paying_users)} hint={stats ? `${n(stats.lifetime_users)} lifetime` : undefined} to="/admin/accounts?f=paying" />
        <Kpi label="On trial" value={n(stats?.trialing_users)} to="/admin/accounts?f=trial" />
        <Kpi label="Payment failed" value={n(stats?.past_due_users)} tone={stats?.past_due_users ? 'bad' : undefined} to="/admin/billing" />
        <Kpi label="Active this week" value={n(stats?.active_7d)} hint={stats ? `of ${n(stats.total_users)} accounts` : undefined} />
        <Kpi label="Sign-ups, 30 days" value={n(stats?.signups_30d)} to="/admin/accounts?s=newest" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="min-w-0">
          <UsageProfitPanel />
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <header className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border-subtle)]">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <h2 className="text-strong font-semibold text-[var(--text-primary)] flex-1">Needs a look</h2>
              <span className="text-caption text-[var(--text-tertiary)] tabular">{attention.length || ''}</span>
            </header>
            {!accounts ? (
              <p className="px-4 py-3 text-body text-[var(--text-tertiary)]">Checking every account…</p>
            ) : attention.length === 0 ? (
              <p className="px-4 py-3 text-body text-[var(--text-tertiary)]">All clear: no failed payments, nobody costing more than they pay, nobody out of credits.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {attention.map(({ a, why, tone }) => (
                  <li key={a.id}>
                    <Link to={`/admin/accounts?a=${a.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)]">
                      <Avatar email={a.email} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-[var(--text-primary)]">{a.email}</span>
                        <span className={cn('block text-micro', tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>{why}</span>
                      </span>
                      <PlanBadge plan={a.plan} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <p className="text-strong font-semibold text-[var(--text-primary)] flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-[var(--indigo-text)]" /> Grant lifetime access</p>
            <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">Free forever: unlimited inboxes and emails, 1,000 credits a month. Any Stripe subscription they have is cancelled.</p>
            <form
              onSubmit={(e) => { e.preventDefault(); if (grantEmail.trim()) grantMutation.mutate(grantEmail.trim()); }}
              className="mt-3 flex items-center gap-2"
            >
              <input
                type="email"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                aria-label="Email of the account to grant lifetime access"
                placeholder="user@example.com"
                className="flex-1 min-w-0 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)]"
                required
              />
              <Button type="submit" size="sm" disabled={grantMutation.isPending || !grantEmail.trim()}>
                {grantMutation.isPending ? 'Granting…' : 'Grant'}
              </Button>
            </form>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <p className="text-strong font-semibold text-[var(--text-primary)] mb-2.5">On the platform</p>
            <dl className="grid grid-cols-2 gap-y-2.5 text-body">
              {([['Mailboxes', stats?.mailboxes, Mail], ['Domains', stats?.domains, Globe], ['Contacts', stats?.contacts, Users], ['Campaigns', stats?.campaigns, Megaphone]] as const).map(([k, v, Icon]) => (
                <div key={k}>
                  <dt className="text-caption text-[var(--text-tertiary)] flex items-center gap-1"><Icon className="h-3 w-3" /> {k}</dt>
                  <dd className="tabular font-medium text-[var(--text-primary)]">{n(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
