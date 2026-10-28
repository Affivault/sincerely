import { useState } from 'react';
import { Navigate, NavLink, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminApi } from '../../api/admin.api';
import { useIsOwner } from '../../hooks/useIsOwner';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import {
  ShieldCheck, Crown, Users, Mail, Globe, Megaphone, Infinity as InfinityIcon, Gift, Sparkles,
} from 'lucide-react';
import { UsageProfitPanel } from '../../components/admin/UsageProfitPanel';
import { AdminAccounts } from '../../components/admin/AdminAccounts';
import { AdminAccountDetail } from '../../components/admin/AdminAccountDetail';
import { AdminActivity } from '../../components/admin/AdminActivity';

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/accounts', label: 'Accounts', end: false },
  { to: '/admin/activity', label: 'Activity', end: true },
];

/*
 * The admin backend. It exists for the platform owner alone: the server
 * 404s every admin endpoint for anyone else, and this page answers anyone
 * else exactly as an unknown address does, by sending them home.
 */
export function AdminPage() {
  const { isOwner, loading } = useIsOwner();
  const { pathname } = useLocation();
  const { id } = useParams();

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (!isOwner) return <Navigate to="/" replace />;

  const body = id ? <AdminAccountDetail id={id} />
    : pathname.startsWith('/admin/accounts') ? <AdminAccounts />
    : pathname.startsWith('/admin/activity') ? <AdminActivity />
    : <AdminOverview />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl [background:var(--indigo-grad)] shadow-[0_4px_14px_-4px_rgba(47,63,156,0.5)]">
          <ShieldCheck className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Admin</h1>
          <p className="text-body text-[var(--text-tertiary)]">Accounts, credits, cost and profit across Sincerely.</p>
        </div>
      </div>

      <nav aria-label="Admin" className="flex items-center gap-1 mb-5 border-b border-[var(--border-subtle)]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => cn(
              'relative h-9 px-3 inline-flex items-center text-body font-medium transition-colors',
              isActive
                ? 'text-[var(--text-primary)] after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:rounded-full after:bg-[var(--indigo)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {body}
    </div>
  );
}

function AdminOverview() {
  const qc = useQueryClient();
  const [grantEmail, setGrantEmail] = useState('');
  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats });

  const grantMutation = useMutation({
    mutationFn: (email: string) => adminApi.grantLifetime(email),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      setGrantEmail('');
      toast.success(`${row.email} now has lifetime access.`, { icon: '👑' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to grant lifetime access'),
  });

  const statCards = [
    { label: 'Total users', value: stats?.total_users, icon: Users, accentCls: 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' },
    { label: 'Lifetime members', value: stats?.lifetime_users, icon: Crown, accentCls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    { label: 'Paying customers', value: stats?.paying_users, icon: Sparkles, accentCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    { label: 'Free accounts', value: stats?.free_users, icon: Gift, accentCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  ];
  const platformCards = [
    { label: 'Mailboxes', value: stats?.mailboxes, icon: Mail },
    { label: 'Domains', value: stats?.domains, icon: Globe },
    { label: 'Contacts', value: stats?.contacts, icon: Users },
    { label: 'Campaigns', value: stats?.campaigns, icon: Megaphone },
  ];

  return (
    <div>
      {/* Account stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
            <p className="text-caption font-medium text-[var(--text-tertiary)] flex items-center gap-1.5">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', s.accentCls)}><s.icon className="h-3 w-3" /></span>
              {s.label}
            </p>
            <p className="mt-1.5 text-title font-semibold text-[var(--text-primary)] tabular leading-none">
              {s.value == null ? '—' : s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Platform totals — one quiet strip */}
      <div className="flex items-center gap-4 flex-wrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 px-4 py-2.5 mb-5 text-caption text-[var(--text-tertiary)]">
        {platformCards.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <p.icon className="h-3 w-3" />
            <span className="font-medium text-[var(--text-secondary)] tabular">{p.value == null ? '—' : p.value.toLocaleString()}</span> {p.label.toLowerCase()}
          </span>
        ))}
      </div>

      <UsageProfitPanel />

      {/* Grant lifetime access */}
      <div className="relative rounded-xl border border-[rgba(47,63,156,0.3)] bg-[var(--bg-surface)] overflow-hidden mb-5">
        <span className="absolute inset-x-0 top-0 h-[2.5px] bg-[var(--indigo)]" />
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
              <InfinityIcon className="h-4 w-4 text-[var(--indigo-text)]" />
            </span>
            <div>
              <p className="text-strong font-semibold text-[var(--text-primary)]">Grant lifetime access</p>
              <p className="text-caption text-[var(--text-tertiary)]">Free forever · unlimited inboxes and emails, 1,000 credits a month · every feature · Stripe can never downgrade it.</p>
            </div>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (grantEmail.trim()) grantMutation.mutate(grantEmail.trim()); }}
            className="mt-3 flex items-center gap-2 max-w-xl"
          >
            <input
              type="email"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              aria-label="Email of the account to grant lifetime access"
              placeholder="user@example.com — must already have an account"
              className="flex-1 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]"
              required
            />
            <Button type="submit" disabled={grantMutation.isPending || !grantEmail.trim()}>
              {grantMutation.isPending ? 'Granting…' : <><Crown className="h-3.5 w-3.5" /> Grant lifetime</>}
            </Button>
          </form>
        </div>
      </div>

    </div>
  );
}
