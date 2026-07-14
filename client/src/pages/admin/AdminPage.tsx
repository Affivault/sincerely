import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminApi } from '../../api/admin.api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Avatar } from '../../components/shared/Avatar';
import { SearchInput } from '../../components/shared/SearchInput';
import { cn } from '../../lib/utils';
import {
  ShieldCheck, Crown, Users, Mail, Globe, Megaphone, Infinity as InfinityIcon,
  Gift, CheckCircle2, XCircle, Undo2, Sparkles,
} from 'lucide-react';
import { ADMIN_EMAILS, PLANS, type AdminUserRow, type PlanId } from '@lemlist/shared';

const PLAN_BADGE: Record<string, string> = {
  lifetime: 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border border-[rgba(91,91,245,0.3)]',
  growth: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  starter: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  scale: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  trial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  free: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
};

function relTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d < 1) { const h = Math.floor(diff / 3600000); return h < 1 ? 'Just now' : `${h}h ago`; }
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AdminPage() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<AdminUserRow | null>(null);

  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats, enabled: isAdmin });
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => adminApi.users(search || undefined),
    enabled: isAdmin,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
  };

  const grantMutation = useMutation({
    mutationFn: (email: string) => adminApi.grantLifetime(email),
    onSuccess: (row) => {
      refresh();
      setGrantEmail('');
      toast.success(`${row.email} now has lifetime access — every limit removed.`, { icon: '👑' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to grant lifetime access'),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => adminApi.revokeLifetime(userId),
    onSuccess: () => {
      refresh();
      setConfirmRevoke(null);
      toast.success('Lifetime access revoked — account is back on Free.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to revoke'),
  });

  // The server 404s non-admins regardless — this is just a clean client exit.
  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const users = usersData?.users || [];
  const lifetimeMembers = users.filter((u) => u.plan === 'lifetime');

  const statCards = [
    { label: 'Total users', value: stats?.total_users, icon: Users, accentCls: 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' },
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl [background:var(--indigo-grad)] shadow-[0_4px_14px_-4px_rgba(91,91,245,0.5)]">
            <ShieldCheck className="h-5 w-5 text-white" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] flex items-center gap-2">
              Admin
              <span className="inline-flex items-center gap-1 px-1.5 h-[19px] rounded-[5px] text-[10.5px] font-semibold bg-[var(--indigo-subtle)] text-[var(--indigo)]">
                <Crown className="h-2.5 w-2.5" /> Owner
              </span>
            </h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">Signed in as {user?.email} — this page is visible to you alone.</p>
          </div>
        </div>
      </div>

      {/* Account stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
            <p className="text-[11px] font-medium text-[var(--text-tertiary)] flex items-center gap-1.5">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', s.accentCls)}><s.icon className="h-3 w-3" /></span>
              {s.label}
            </p>
            <p className="mt-1.5 text-[20px] font-semibold text-[var(--text-primary)] tabular leading-none">
              {s.value == null ? '—' : s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Platform totals — one quiet strip */}
      <div className="flex items-center gap-4 flex-wrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 px-4 py-2.5 mb-5 text-[11.5px] text-[var(--text-tertiary)]">
        {platformCards.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <p.icon className="h-3 w-3" />
            <span className="font-medium text-[var(--text-secondary)] tabular">{p.value == null ? '—' : p.value.toLocaleString()}</span> {p.label.toLowerCase()}
          </span>
        ))}
      </div>

      {/* Grant lifetime access */}
      <div className="relative rounded-xl border border-[rgba(91,91,245,0.3)] bg-[var(--bg-surface)] overflow-hidden mb-5">
        <span className="absolute inset-x-0 top-0 h-[2.5px] [background:linear-gradient(90deg,#5B5BF5,#8B5CF6,#5B5BF5)]" />
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
              <InfinityIcon className="h-4 w-4 text-[var(--indigo)]" />
            </span>
            <div>
              <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">Grant lifetime access</p>
              <p className="text-[11.5px] text-[var(--text-tertiary)]">Free forever · unlimited inboxes, emails & prospect credits · every feature · Stripe can never downgrade it.</p>
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
              placeholder="user@example.com — must already have an account"
              className="flex-1 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow]"
              required
            />
            <Button type="submit" disabled={grantMutation.isPending || !grantEmail.trim()}>
              {grantMutation.isPending ? 'Granting…' : <><Crown className="h-3.5 w-3.5" /> Grant lifetime</>}
            </Button>
          </form>
          {lifetimeMembers.length > 0 && !search && (
            <p className="mt-2.5 text-[11.5px] text-[var(--text-tertiary)]">
              <Crown className="h-3 w-3 inline mr-1 text-[var(--indigo)]" />
              {lifetimeMembers.length} lifetime member{lifetimeMembers.length === 1 ? '' : 's'}: {lifetimeMembers.slice(0, 5).map((m) => m.email).join(', ')}{lifetimeMembers.length > 5 ? '…' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Users table */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="flex items-center gap-3 px-3 h-12 border-b border-[var(--border-subtle)]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search users by email…" className="w-72" />
          <span className="flex-1" />
          <span className="text-[11.5px] text-[var(--text-tertiary)] tabular">
            {users.length}{usersData && usersData.total > users.length ? ` of ${usersData.total}` : ''} user{users.length === 1 ? '' : 's'}
          </span>
        </div>

        {loadingUsers ? (
          <div className="flex justify-center py-16"><Spinner size="md" /></div>
        ) : users.length === 0 ? (
          <div className="py-14 text-center text-[12.5px] text-[var(--text-tertiary)]">No users match “{search}”.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2.5 pl-4 pr-3">User</th>
                  <th className="py-2.5 px-3">Plan</th>
                  <th className="py-2.5 px-3">Confirmed</th>
                  <th className="py-2.5 px-3">Joined</th>
                  <th className="py-2.5 px-3">Last seen</th>
                  <th className="py-2.5 pr-4 pl-3 text-right">Lifetime access</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const planName = (PLANS[u.plan as PlanId]?.name) || u.plan;
                  const isLifetime = u.plan === 'lifetime';
                  const isSelf = u.email.toLowerCase() === user?.email?.toLowerCase();
                  return (
                    <tr key={u.id} className="group border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar email={u.email} size="lg" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                              {u.email}
                              {isSelf && <span className="ml-1.5 text-[10px] font-semibold text-[var(--indigo)]">(you)</span>}
                            </p>
                            <p className="text-[10.5px] text-[var(--text-muted)] font-mono truncate">{u.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={cn('inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium rounded-[4px]', PLAN_BADGE[u.plan] || PLAN_BADGE.free)}>
                          {isLifetime && <Crown className="h-2.5 w-2.5" />}
                          {planName}
                        </span>
                        {u.status !== 'active' && u.status !== 'free' && u.status !== 'trialing' && (
                          <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">{u.status}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.email_confirmed
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                      </td>
                      <td className="py-2.5 px-3 text-[12px] text-[var(--text-secondary)] tabular whitespace-nowrap">{relTime(u.created_at)}</td>
                      <td className="py-2.5 px-3 text-[12px] text-[var(--text-tertiary)] tabular whitespace-nowrap">{relTime(u.last_sign_in_at)}</td>
                      <td className="py-2.5 pr-4 pl-3">
                        <div className="flex justify-end">
                          {isLifetime ? (
                            confirmRevoke?.id === u.id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-[11px] text-[var(--text-tertiary)]">Drop to Free?</span>
                                <Button size="sm" variant="danger" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(u.id)}>
                                  {revokeMutation.isPending ? 'Revoking…' : 'Confirm'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmRevoke(u)}
                                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                              >
                                <Undo2 className="h-3 w-3" /> Revoke
                              </button>
                            )
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={grantMutation.isPending}
                              onClick={() => grantMutation.mutate(u.email)}
                            >
                              <Crown className="h-3 w-3" /> Grant lifetime
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Access is enforced server-side: only {ADMIN_EMAILS.join(', ')} can call these endpoints — everyone else receives a 404.
      </p>
    </div>
  );
}
