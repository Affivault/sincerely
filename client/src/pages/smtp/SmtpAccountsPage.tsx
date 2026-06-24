import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { StatCard } from '../../components/shared/StatCard';
import { formatDate, cn } from '../../lib/utils';
import {
  Mail,
  Plus,
  Trash2,
  TestTube,
  CheckCircle2,
  XCircle,
  Server,
  HelpCircle,
  ArrowRight,
  Settings,
  ExternalLink,
  Globe,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset } from '@lemlist/shared';
import { SMTP_PRESETS, detectPresetFromEmail } from '@lemlist/shared';

const emptyForm: CreateSmtpAccountInput = {
  label: '',
  email_address: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_pass: '',
  daily_send_limit: 200,
};

interface QuickConnectProvider {
  preset: SmtpPreset;
  icon: React.ReactNode;
  description: string;
}

const QUICK_PROVIDERS: QuickConnectProvider[] = [
  {
    preset: SMTP_PRESETS.find(p => p.name === 'Gmail')!,
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
    preset: SMTP_PRESETS.find(p => p.name === 'Outlook / Microsoft 365')!,
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
    preset: SMTP_PRESETS.find(p => p.name === 'SendGrid')!,
    icon: (
      <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white text-xs font-bold">SG</div>
    ),
    description: 'Transactional email with API key',
  },
  {
    preset: SMTP_PRESETS.find(p => p.name === 'Zoho Mail')!,
    icon: (
      <div className="flex items-center justify-center w-5 h-5 rounded bg-green-600 text-white text-xs font-bold">Z</div>
    ),
    description: 'Zoho Mail or Zoho Workplace',
  },
];

function presetToForm(preset: SmtpPreset): CreateSmtpAccountInput {
  return {
    label: preset.name,
    email_address: '',
    smtp_host: preset.smtp_host,
    smtp_port: preset.smtp_port,
    smtp_secure: preset.smtp_secure,
    smtp_user: '',
    smtp_pass: '',
    imap_host: preset.imap_host || undefined,
    imap_port: preset.imap_port || undefined,
    imap_secure: preset.imap_secure || undefined,
    daily_send_limit: preset.recommended_daily_limit || 200,
  };
}

export function SmtpAccountsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [activePreset, setActivePreset] = useState<SmtpPreset | null>(null);
  const [form, setForm] = useState<CreateSmtpAccountInput>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);

  const handleQuickConnect = (provider: QuickConnectProvider) => {
    setForm(presetToForm(provider.preset));
    setActivePreset(provider.preset);
    setAutoDetected(false);
    setEditId(null);
    setShowModal(true);
  };

  const handleAddCustom = () => {
    setForm({ ...emptyForm });
    setActivePreset(null);
    setAutoDetected(false);
    setEditId(null);
    setShowModal(true);
  };

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['smtp-accounts'],
    queryFn: smtpApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateSmtpAccountInput) =>
      editId ? smtpApi.update(editId, input) : smtpApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      toast.success(editId ? 'Account updated' : 'Account created');
      closeModal();
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error
        || err.message
        || 'Failed to save';
      toast.error(msg);
      console.error('SMTP save error:', err.response?.status, err.response?.data, err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: smtpApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      toast.success('Account deleted');
    },
  });

  const testMutation = useMutation({
    mutationFn: smtpApi.test,
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      } else {
        toast.error(result.message);
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error
        || err.response?.data?.message
        || err.message
        || 'Connection test failed';
      toast.error(msg);
    },
  });

  const closeModal = () => {
    setShowModal(false);
    setActivePreset(null);
    setAutoDetected(false);
    setEditId(null);
    setForm({ ...emptyForm });
  };

  const openEdit = (account: SmtpAccount) => {
    setEditId(account.id);
    setActivePreset(null);
    setAutoDetected(false);
    setForm({
      label: account.label,
      email_address: account.email_address,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_secure: account.smtp_secure,
      smtp_user: account.smtp_user,
      smtp_pass: '',
      imap_host: account.imap_host || undefined,
      imap_port: account.imap_port || undefined,
      imap_secure: account.imap_secure || undefined,
      daily_send_limit: account.daily_send_limit,
    });
    setShowModal(true);
  };

  const applyPreset = (presetName: string) => {
    const preset = SMTP_PRESETS.find((p) => p.name === presetName);
    if (preset) {
      setActivePreset(preset);
      setForm((prev) => ({
        ...prev,
        smtp_host: preset.smtp_host,
        smtp_port: preset.smtp_port,
        smtp_secure: preset.smtp_secure,
        imap_host: preset.imap_host || undefined,
        imap_port: preset.imap_port || undefined,
        imap_secure: preset.imap_secure || undefined,
        daily_send_limit: preset.recommended_daily_limit || prev.daily_send_limit,
      }));
    } else {
      setActivePreset(null);
    }
  };

  /** Auto-detect provider from email as user types */
  const handleEmailChange = useCallback((email: string) => {
    setForm((prev) => ({ ...prev, email_address: email, smtp_user: email }));

    // Only auto-detect if user hasn't already selected a preset manually
    if (!activePreset || autoDetected) {
      const detected = detectPresetFromEmail(email);
      if (detected) {
        setActivePreset(detected);
        setAutoDetected(true);
        setForm((prev) => ({
          ...prev,
          email_address: email,
          smtp_user: email,
          label: prev.label || detected.name,
          smtp_host: detected.smtp_host,
          smtp_port: detected.smtp_port,
          smtp_secure: detected.smtp_secure,
          imap_host: detected.imap_host || undefined,
          imap_port: detected.imap_port || undefined,
          imap_secure: detected.imap_secure || undefined,
          daily_send_limit: detected.recommended_daily_limit || prev.daily_send_limit,
        }));
      } else if (autoDetected) {
        // Clear auto-detection if email changed away from a known domain
        setActivePreset(null);
        setAutoDetected(false);
      }
    }
  }, [activePreset, autoDetected]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitForm = {
      ...form,
      smtp_user: form.smtp_user || form.email_address,
    };
    createMutation.mutate(submitForm);
  };

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-3">
        <SkeletonList rows={4} />
      </div>
    );
  }

  const isQuickMode = activePreset && !editId;
  const passwordLabel = activePreset?.password_hint || 'Password';
  const passwordPlaceholder = activePreset?.password_hint || (editId ? 'Leave blank to keep current' : 'Enter password or app key');

  const verifiedCount = (accounts || []).filter((a: SmtpAccount) => a.is_verified).length;
  const sentTodayTotal = (accounts || []).reduce((sum: number, a: SmtpAccount) => sum + a.sends_today, 0);

  return (
    <div>
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <Server className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Sending accounts"
        description="Connect SMTP / IMAP credentials so MeetDrive can send and read replies on your behalf."
        meta={
          accounts && accounts.length > 0 ? (
            <>
              <span className="tabular">{accounts.length} connected</span>
              <span className="sep-dot" />
              <span className="tabular">{verifiedCount} verified</span>
              <span className="sep-dot" />
              <span className="tabular">{sentTodayTotal.toLocaleString()} sent today</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <Link to="/smtp-accounts/guide" className="icon-btn h-8 px-2.5 text-[12.5px]">
              <HelpCircle className="h-3.5 w-3.5" /> Setup guide
            </Link>
            <Button size="sm" onClick={handleAddCustom}>
              <Plus className="h-3.5 w-3.5" /> Add account
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      {accounts && accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard icon={Server} accent="indigo"   label="Total accounts" value={accounts.length} />
          <StatCard icon={CheckCircle2} accent="emerald" label="Verified"     value={verifiedCount} hint={accounts.length > 0 ? `${Math.round((verifiedCount / accounts.length) * 100)}% verified` : undefined} />
          <StatCard icon={Mail} accent="violet"     label="Sent today"    value={sentTodayTotal.toLocaleString()} />
        </div>
      )}

      {/* Quick Connect */}
      <Card padding="md" className="mb-3">
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-[var(--indigo)]" />
              Quick connect
            </span>
          </CardTitle>
          <CardDescription>Pre-configured settings for popular providers. Just enter email and password.</CardDescription>
        </CardHeader>

        <div className="grid grid-cols-2 gap-2">
          {QUICK_PROVIDERS.map((provider) => (
            <button
              key={provider.preset.name}
              onClick={() => handleQuickConnect(provider)}
              className="group surface flex items-center gap-2.5 p-2.5 hover:shadow-[var(--shadow-md)] hover:border-[rgba(91,91,245,0.25)] transition-all text-left"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shrink-0">
                {provider.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{provider.preset.name}</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">{provider.description}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors shrink-0" />
            </button>
          ))}
        </div>

        <p className="text-[11.5px] text-[var(--text-tertiary)] mt-2.5 flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {SMTP_PRESETS.length} providers supported — or type any email to auto-detect.
        </p>
      </Card>

      {/* Domain verification prompt */}
      <Card padding="md" className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-emerald-500/8 flex-shrink-0">
              <Globe className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--text-primary)]">Sending from your own domain?</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                Set up SPF, DKIM &amp; DMARC records to improve deliverability and stay out of spam folders.
              </p>
            </div>
          </div>
          <Link to="/domains" className="icon-btn h-8 px-3 text-[12.5px] flex-shrink-0">
            Verify domain <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>

      {/* Empty State or List */}
      {(!accounts || accounts.length === 0) ? (
        <EmptyState
          icon={Mail}
          title="No SMTP accounts"
          description="Connect your email provider to start sending campaigns."
          actionLabel="Add Account"
          onAction={handleAddCustom}
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((account: SmtpAccount) => {
            const limit = account.warmup_mode ? account.warmup_daily_target : account.daily_send_limit;
            const pct = limit > 0 ? Math.round((account.sends_today / limit) * 100) : 0;
            const healthColor = account.health_score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : account.health_score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
            return (
              <div
                key={account.id}
                className="group card card-hover p-4 relative overflow-hidden"
              >
                <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', account.is_verified ? 'bg-emerald-500' : 'bg-slate-400')} />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0">
                      <Mail className="h-4 w-4 text-[var(--indigo)]" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate tracking-[-0.005em]">{account.label}</h3>
                        {account.is_verified ? (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-[4px]">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10.5px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[4px]">
                            <XCircle className="h-2.5 w-2.5" /> Unverified
                          </span>
                        )}
                        {account.warmup_mode && (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10.5px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[4px]">
                            Warming up
                          </span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-[var(--text-secondary)] truncate">{account.email_address}</p>
                      <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)] mt-1 tabular">
                        <span>{account.smtp_host}:{account.smtp_port}</span>
                        <span className="sep-dot" />
                        <span>{account.sends_today}/{limit} today</span>
                        <span className="sep-dot" />
                        <span className={healthColor}>Health {account.health_score}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => testMutation.mutate(account.id)}
                      disabled={testMutation.isPending}
                      className="icon-btn h-7 px-2 text-[11.5px]"
                      title="Test connection"
                    >
                      <TestTube className="h-3 w-3" /> Test
                    </button>
                    <button
                      onClick={() => openEdit(account)}
                      className="icon-btn h-7 px-2 text-[11.5px]"
                      title="Edit"
                    >
                      <Settings className="h-3 w-3" /> Edit
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this SMTP account?')) deleteMutation.mutate(account.id); }}
                      className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Usage Bar */}
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)] mb-1">
                    <span>{account.warmup_mode ? 'Warmup progress' : 'Daily usage'}</span>
                    <span className="tabular">{pct}%</span>
                  </div>
                  <div className="h-1 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all duration-500',
                        account.warmup_mode ? 'bg-amber-500' : 'bg-[var(--indigo)]'
                      )}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editId ? 'Edit SMTP Account' : isQuickMode ? `Connect ${activePreset.name}` : 'Add SMTP Account'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider guide banner for quick-connect mode */}
          {isQuickMode && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {QUICK_PROVIDERS.find(p => p.preset.name === activePreset.name)?.icon || (
                    <Server className="h-5 w-5 text-secondary" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{activePreset.name} Setup</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    SMTP settings are pre-filled. You just need to enter your email and password.
                  </p>
                  {activePreset.password_hint && (
                    <div className="mt-2 text-xs text-[var(--text-tertiary)] flex items-center gap-1">
                      <HelpCircle className="h-3 w-3 shrink-0" />
                      Password: {activePreset.password_hint}
                    </div>
                  )}
                  {activePreset.requires_domain_setup && (
                    <div className="mt-2 text-xs text-amber-500 flex items-center gap-1">
                      <Globe className="h-3 w-3 shrink-0" />
                      This provider requires DNS records on your domain.{' '}
                      <Link to="/smtp-accounts/guide" className="underline underline-offset-2">
                        See guide
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Auto-detected banner */}
          {autoDetected && activePreset && !editId && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              Auto-detected: <span className="font-medium text-[var(--text-primary)]">{activePreset.name}</span> &mdash; settings pre-filled
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Label"
              value={form.label}
              onChange={(e) => updateField('label', e.target.value)}
              placeholder="e.g., Work Email"
              required
            />
            <Input
              label="Email Address"
              type="email"
              value={form.email_address}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder={activePreset?.username_hint || 'you@example.com'}
              required
            />
          </div>

          {/* Show password prominently in quick-connect mode */}
          {isQuickMode && (
            <Input
              label={passwordLabel}
              type="password"
              value={form.smtp_pass}
              onChange={(e) => updateField('smtp_pass', e.target.value)}
              placeholder={passwordPlaceholder}
              required
            />
          )}

          {/* Provider preset selector - only in custom/edit mode */}
          {!isQuickMode && (
            <Select
              label="Provider Preset"
              options={[
                { value: '', label: 'Custom Configuration' },
                ...SMTP_PRESETS.map((p) => ({ value: p.name, label: p.name })),
              ]}
              value={activePreset?.name || ''}
              onChange={(e) => applyPreset(e.target.value)}
            />
          )}

          {/* SMTP Settings - collapsed in quick mode, expanded otherwise */}
          {isQuickMode ? (
            <details className="border-t border-subtle pt-3">
              <summary className="text-sm font-medium text-secondary cursor-pointer hover:text-primary transition-colors">
                Advanced SMTP settings (pre-filled for {activePreset.name})
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="SMTP Host"
                    value={form.smtp_host}
                    onChange={(e) => updateField('smtp_host', e.target.value)}
                    placeholder="smtp.example.com"
                    required
                  />
                  <Input
                    label="Port"
                    type="number"
                    value={String(form.smtp_port)}
                    onChange={(e) => updateField('smtp_port', parseInt(e.target.value))}
                    required
                  />
                  <Input
                    label="Username"
                    value={form.smtp_user}
                    onChange={(e) => updateField('smtp_user', e.target.value)}
                    placeholder={activePreset.username_hint || 'Email or username'}
                    required
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="IMAP Host"
                    value={form.imap_host || ''}
                    onChange={(e) => updateField('imap_host', e.target.value)}
                    placeholder="imap.example.com"
                  />
                  <Input
                    label="IMAP Port"
                    type="number"
                    value={String(form.imap_port || '')}
                    onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)}
                    placeholder="993"
                  />
                  <Input
                    label="Daily Send Limit"
                    type="number"
                    value={String(form.daily_send_limit || 200)}
                    onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </details>
          ) : (
            <>
              <div className="border-t border-subtle pt-4">
                <h4 className="text-sm font-medium text-primary mb-3">SMTP Settings</h4>
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="Host"
                    value={form.smtp_host}
                    onChange={(e) => updateField('smtp_host', e.target.value)}
                    placeholder="smtp.example.com"
                    required
                  />
                  <Input
                    label="Port"
                    type="number"
                    value={String(form.smtp_port)}
                    onChange={(e) => updateField('smtp_port', parseInt(e.target.value))}
                    required
                  />
                  <Input
                    label="Username"
                    value={form.smtp_user}
                    onChange={(e) => updateField('smtp_user', e.target.value)}
                    placeholder={activePreset?.username_hint || 'Email or username'}
                    required
                  />
                </div>
                <div className="mt-4">
                  <Input
                    label={passwordLabel}
                    type="password"
                    value={form.smtp_pass}
                    onChange={(e) => updateField('smtp_pass', e.target.value)}
                    placeholder={passwordPlaceholder}
                    required={!editId}
                  />
                </div>
              </div>

              <div className="border-t border-subtle pt-4">
                <h4 className="text-sm font-medium text-primary mb-3">IMAP Settings (optional)</h4>
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="IMAP Host"
                    value={form.imap_host || ''}
                    onChange={(e) => updateField('imap_host', e.target.value)}
                    placeholder="imap.example.com"
                  />
                  <Input
                    label="IMAP Port"
                    type="number"
                    value={String(form.imap_port || '')}
                    onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)}
                    placeholder="993"
                  />
                  <Input
                    label="Daily Send Limit"
                    type="number"
                    value={String(form.daily_send_limit || 200)}
                    onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-subtle">
            <Link
              to="/smtp-accounts/guide"
              className="text-xs text-tertiary hover:text-secondary transition-colors flex items-center gap-1"
            >
              <HelpCircle className="h-3 w-3" />
              Need help? View setup guide
            </Link>
            <div className="flex gap-3">
              <Button variant="secondary" type="button" onClick={closeModal}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Connecting...' : editId ? 'Update Account' : `Connect ${activePreset?.name || 'Account'}`}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
