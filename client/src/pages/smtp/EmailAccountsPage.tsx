import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { cn } from '../../lib/utils';
import {
  Mail, Plus, Trash2, TestTube, CheckCircle2, XCircle, Server, HelpCircle,
  ArrowRight, Settings, Globe, Zap, Search, Flame, ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, SmtpPreset } from '@lemlist/shared';
import { SMTP_PRESETS } from '@lemlist/shared';
import { SmtpAccountModal } from './SmtpAccountModal';

interface QuickConnectProvider {
  preset: SmtpPreset;
  icon: React.ReactNode;
  description: string;
}

const QUICK_PROVIDERS: QuickConnectProvider[] = [
  {
    preset: SMTP_PRESETS.find((p) => p.name === 'Gmail')!,
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
    description: 'Gmail or Google Workspace',
  },
  {
    preset: SMTP_PRESETS.find((p) => p.name === 'Outlook / Microsoft 365')!,
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path d="M24 7.387v10.478c0 .23-.08.424-.238.576a.806.806 0 0 1-.587.234h-8.55V6.576h8.55c.229 0 .424.078.587.234A.772.772 0 0 1 24 7.387z" fill="#0078D4" />
        <path d="M14.625 6.576v12.1L0 16.75V3.45l14.625 3.126z" fill="#0364B8" />
        <path d="M9.875 9.45c-.5-.3-1.075-.45-1.725-.45-.725 0-1.325.2-1.8.6-.475.4-.712.912-.712 1.537 0 .625.237 1.137.712 1.538.475.4 1.075.6 1.8.6.65 0 1.225-.15 1.725-.45v1.4c-.55.25-1.175.375-1.875.375-1.1 0-2-.35-2.7-1.05-.7-.7-1.05-1.55-1.05-2.55 0-.95.363-1.763 1.088-2.438C5.963 7.688 6.838 7.35 7.863 7.35c.737 0 1.387.137 1.95.412L9.875 9.45z" fill="white" />
      </svg>
    ),
    description: 'Outlook, Hotmail, or Microsoft 365',
  },
  {
    preset: SMTP_PRESETS.find((p) => p.name === 'SendGrid')!,
    icon: <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white text-[10px] font-bold">SG</div>,
    description: 'Transactional email with API key',
  },
  {
    preset: SMTP_PRESETS.find((p) => p.name === 'Zoho Mail')!,
    icon: <div className="flex items-center justify-center w-5 h-5 rounded bg-green-600 text-white text-[10px] font-bold">Z</div>,
    description: 'Zoho Mail or Zoho Workplace',
  },
];

function healthColor(score: number): string {
  return score >= 80 ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 50 ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-600 dark:text-rose-400';
}

export function EmailAccountsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<SmtpAccount | null>(null);
  const [initialPreset, setInitialPreset] = useState<SmtpPreset | null>(null);
  const [search, setSearch] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: accounts, isLoading } = useQuery({ queryKey: ['smtp-accounts'], queryFn: smtpApi.list });

  const openAdd = () => { setEditAccount(null); setInitialPreset(null); setModalOpen(true); };
  const openQuick = (preset: SmtpPreset) => { setEditAccount(null); setInitialPreset(preset); setModalOpen(true); };
  const openEdit = (a: SmtpAccount) => { setEditAccount(a); setInitialPreset(null); setModalOpen(true); };

  const deleteMutation = useMutation({
    mutationFn: smtpApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] }); toast.success('Account removed'); },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => smtpApi.test(id),
    onMutate: (id) => setTestingId(id),
    onSuccess: (result) => {
      if (result.success) { toast.success(result.message); queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] }); }
      else toast.error(result.message);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || err.message || 'Connection test failed'),
    onSettled: () => setTestingId(null),
  });

  if (isLoading) {
    return <div className="max-w-5xl space-y-3"><SkeletonList rows={5} /></div>;
  }

  const list = accounts || [];
  const filtered = search.trim()
    ? list.filter((a: SmtpAccount) => `${a.from_name || ''} ${a.label} ${a.email_address}`.toLowerCase().includes(search.toLowerCase()))
    : list;

  const verifiedCount = list.filter((a: SmtpAccount) => a.is_verified).length;
  const warmingCount = list.filter((a: SmtpAccount) => a.warmup_mode).length;
  const sentTodayTotal = list.reduce((sum: number, a: SmtpAccount) => sum + a.sends_today, 0);

  return (
    <div>
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <Mail className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Email accounts"
        description="Connect the mailboxes you send from. Manage senders, warm-up, and deliverability in one place."
        meta={
          list.length > 0 ? (
            <>
              <span className="tabular">{list.length} connected</span>
              <span className="sep-dot" />
              <span className="tabular">{verifiedCount} verified</span>
              <span className="sep-dot" />
              <span className="tabular">{sentTodayTotal.toLocaleString()} sent today</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <Link to="/smtp-accounts/guide" className="icon-btn h-8 px-2.5 text-[12.5px] whitespace-nowrap">
              <HelpCircle className="h-3.5 w-3.5" /> Setup guide
            </Link>
            <Button size="sm" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add account</Button>
          </>
        }
      />

      {list.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard icon={Server} accent="indigo" label="Connected" value={list.length} />
          <StatCard icon={CheckCircle2} accent="emerald" label="Verified" value={verifiedCount} hint={list.length ? `${Math.round((verifiedCount / list.length) * 100)}% verified` : undefined} />
          <StatCard icon={Flame} accent="amber" label="Warming up" value={warmingCount} />
          <StatCard icon={Mail} accent="violet" label="Sent today" value={sentTodayTotal.toLocaleString()} />
        </div>
      )}

      {/* Quick connect */}
      <Card padding="md" className="mb-3">
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-[var(--indigo)]" /> Quick connect</span>
          </CardTitle>
          <CardDescription>Pre-configured settings for popular providers — just add email and password.</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {QUICK_PROVIDERS.map((provider) => (
            <button
              key={provider.preset.name}
              onClick={() => openQuick(provider.preset)}
              className="group surface flex items-center gap-2.5 p-2.5 hover:shadow-[var(--shadow-md)] hover:border-[rgba(91,91,245,0.25)] transition-all text-left"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shrink-0">{provider.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{provider.preset.name}</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">{provider.description}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors shrink-0" />
            </button>
          ))}
        </div>
        <p className="text-[11.5px] text-[var(--text-tertiary)] mt-2.5 flex items-center gap-1">
          <Globe className="h-3 w-3" /> {SMTP_PRESETS.length} providers supported — or type any email to auto-detect.
        </p>
      </Card>

      {/* Accounts table */}
      {list.length === 0 ? (
        <EmptyState icon={Mail} title="No email accounts yet" description="Connect your first mailbox to start sending campaigns." actionLabel="Add account" onAction={openAdd} />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-12 border-b border-[var(--border-subtle)]">
            <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts by name or email…"
              className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            <span className="text-[11.5px] text-[var(--text-tertiary)] tabular">{filtered.length} of {list.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2.5 pl-4 pr-3 font-semibold">Sender</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Warm-up</th>
                  <th className="py-2.5 px-3 font-semibold">Deliverability</th>
                  <th className="py-2.5 px-3 font-semibold">Sent today</th>
                  <th className="py-2.5 pr-4 pl-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account: SmtpAccount) => {
                  const limit = account.warmup_mode ? account.warmup_daily_target : account.daily_send_limit;
                  const displayName = account.from_name || account.label;
                  return (
                    <tr key={account.id} className="group border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                      {/* Sender */}
                      <td className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', account.is_verified ? 'bg-emerald-500' : 'bg-slate-400')} title={account.is_verified ? 'Verified' : 'Unverified'} />
                          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0">
                            <span className="text-[12px] font-semibold text-[var(--indigo)]">{(displayName || '?').charAt(0).toUpperCase()}</span>
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{displayName}</span>
                              {account.label && account.from_name && account.label !== account.from_name && (
                                <span className="hidden sm:inline-flex items-center px-1.5 h-[17px] text-[10px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[4px]">{account.label}</span>
                              )}
                            </div>
                            <p className="text-[12px] text-[var(--text-tertiary)] truncate">{account.email_address}</p>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3">
                        {account.is_verified ? (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-[4px]">
                            <ShieldCheck className="h-2.5 w-2.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[4px]">
                            <XCircle className="h-2.5 w-2.5" /> Unverified
                          </span>
                        )}
                      </td>

                      {/* Warm-up */}
                      <td className="py-2.5 px-3">
                        {account.warmup_mode ? (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[4px]">
                            <Flame className="h-2.5 w-2.5" /> Warming
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-[var(--text-muted)]">Off</span>
                        )}
                      </td>

                      {/* Deliverability */}
                      <td className="py-2.5 px-3">
                        <span className={cn('text-[12.5px] font-semibold tabular', healthColor(account.health_score))}>{account.health_score}%</span>
                      </td>

                      {/* Sent today */}
                      <td className="py-2.5 px-3">
                        <span className="text-[12.5px] text-[var(--text-secondary)] tabular">{account.sends_today}<span className="text-[var(--text-muted)]">/{limit}</span></span>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 pr-4 pl-3">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => testMutation.mutate(account.id)} disabled={testingId === account.id} className="icon-btn h-7 px-2 text-[11.5px]" title="Test connection">
                            <TestTube className="h-3 w-3" /> {testingId === account.id ? 'Testing…' : 'Test'}
                          </button>
                          <button onClick={() => openEdit(account)} className="icon-btn h-7 w-7" title="Edit"><Settings className="h-3 w-3" /></button>
                          <button onClick={() => { if (confirm(`Remove ${account.email_address}?`)) deleteMutation.mutate(account.id); }} className="icon-btn h-7 w-7 hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]" title="Remove"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="py-10 text-center text-[12.5px] text-[var(--text-tertiary)]">No accounts match “{search}”.</div>
          )}
        </Card>
      )}

      <SmtpAccountModal open={modalOpen} onClose={() => setModalOpen(false)} editAccount={editAccount} initialPreset={initialPreset} />
    </div>
  );
}
