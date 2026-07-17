import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { domainApi } from '../../api/domain.api';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card } from '../../components/shared/Card';
import { cn } from '../../lib/utils';
import {
  Mail, Plus, Trash2, TestTube, CheckCircle2, XCircle, HelpCircle,
  ArrowRight, Settings, Globe, Search, Flame, ShieldCheck, ShieldAlert,
  ChevronDown, ChevronRight, AlertTriangle, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, SmtpPreset, SendingDomain } from '@lemlist/shared';
import { SMTP_PRESETS, warmupAllowance } from '@lemlist/shared';
import { SmtpAccountModal } from './SmtpAccountModal';
import { WarmupPanel } from './WarmupPanel';
import { StatusBadge, DomainDetailPanel } from '../domains/DomainsPage';

/* ─── Quick-connect providers ─────────────────────── */
interface QuickConnectProvider { preset: SmtpPreset; icon: React.ReactNode; description: string; }

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

const domainOf = (email: string) => (email.split('@')[1] || '').toLowerCase();
function matchDomain(domains: SendingDomain[], email: string): SendingDomain | null {
  const d = domainOf(email);
  if (!d) return null;
  return domains.find((sd) => d === sd.domain.toLowerCase() || d.endsWith('.' + sd.domain.toLowerCase())) || null;
}

/* ─── "How it works" — info only when asked ─────────── */
function ExplainerModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} title="How inbox delivery works" description="SPF, DKIM & DMARC in plain English — a 2-minute read." size="lg">
      <div className="space-y-4 text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
        <p>Every time you send, the receiving server (Gmail, Outlook…) asks one question: <span className="font-medium text-[var(--text-primary)]">“is this sender really who they claim to be?”</span> Three DNS records answer it. Without them, cold email lands in spam — or is rejected outright.</p>
        <div className="grid sm:grid-cols-3 gap-2.5">
          {[
            { k: 'SPF', c: 'Who is allowed to send', d: 'A list of the servers permitted to send mail for your domain. Stops strangers forging your address.' },
            { k: 'DKIM', c: 'A tamper-proof signature', d: 'Your mail is cryptographically signed. The receiver checks the signature to confirm nothing was altered in transit.' },
            { k: 'DMARC', c: 'What to do if a check fails', d: 'Ties SPF + DKIM to your visible “From” address and tells receivers how strict to be. Required by Gmail/Yahoo for bulk senders.' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">{x.k}</p>
              <p className="text-[11px] font-medium text-[var(--indigo)] mb-1">{x.c}</p>
              <p className="text-[11.5px] text-[var(--text-tertiary)]">{x.d}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
          <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-1.5">Where each thing goes</p>
          <ul className="space-y-1 text-[11.5px]">
            <li><span className="font-medium text-[var(--text-primary)]">DNS records (SPF/DKIM/DMARC)</span> → published on your <span className="font-medium">domain</span>, at your registrar/DNS host (Cloudflare, Namecheap, GoDaddy…). Your mail provider gives you the exact values.</li>
            <li><span className="font-medium text-[var(--text-primary)]">Mailbox credentials (SMTP/IMAP)</span> → entered here in Sincerely, so we can send and read replies.</li>
          </ul>
          <p className="text-[11.5px] text-[var(--text-tertiary)] mt-2">Best practice: authenticate the domain <span className="font-medium text-[var(--text-primary)]">first</span>, then connect its mailboxes, then warm them up before sending real volume.</p>
        </div>
        <p className="text-[11.5px] text-[var(--text-tertiary)]">
          Need a full walkthrough? <Link to="/smtp-accounts/guide" className="text-[var(--indigo)] hover:underline" onClick={onClose}>Read the setup guide</Link>.
        </p>
      </div>
    </Modal>
  );
}

/* ─── Setup progress — shown only while incomplete ──── */
function SetupProgress({
  steps, onStep,
}: {
  steps: { label: string; done: boolean; hint: string }[];
  onStep: (index: number) => void;
}) {
  const firstOpen = steps.findIndex((s) => !s.done);
  return (
    <Card padding="none" className="mb-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-stretch divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)]">
        {steps.map((step, i) => {
          const active = i === firstOpen;
          return (
            <button
              key={step.label}
              onClick={() => onStep(i)}
              className={cn(
                'flex-1 flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]',
                active && 'bg-[var(--indigo-subtle)]/40'
              )}
            >
              {step.done ? (
                <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500 flex-shrink-0" />
              ) : (
                <span className={cn(
                  'flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0',
                  active ? 'bg-[var(--indigo)] text-white' : 'border border-[var(--border-default)] text-[var(--text-muted)]'
                )}>{i + 1}</span>
              )}
              <span className="min-w-0">
                <span className={cn('block text-[12.5px] font-medium', step.done ? 'text-[var(--text-tertiary)] line-through decoration-[var(--text-muted)]' : 'text-[var(--text-primary)]')}>{step.label}</span>
                {!step.done && <span className="block text-[11px] text-[var(--text-tertiary)] truncate">{step.hint}</span>}
              </span>
              {active && <ArrowRight className="h-3.5 w-3.5 text-[var(--indigo)] ml-auto flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────── */
type Tab = 'mailboxes' | 'domains' | 'warmup';

export function EmailAccountsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('mailboxes');
  const [modalOpen, setModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<SmtpAccount | null>(null);
  const [initialPreset, setInitialPreset] = useState<SmtpPreset | null>(null);
  const [search, setSearch] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [showExplainer, setShowExplainer] = useState(false);

  const { data: accounts, isLoading, isError: accountsError } = useQuery({ queryKey: ['smtp-accounts'], queryFn: smtpApi.list, meta: { silentError: true } });
  const { data: domainsData, isLoading: loadingDomains, isError: domainsError } = useQuery({ queryKey: ['domains'], queryFn: domainApi.list, meta: { silentError: true } });
  const domains = domainsData || [];
  const list = accounts || [];

  // Fresh accounts start on the Domains tab — authenticating the domain is
  // step one of the deliverability flow. Decided once, when data first lands.
  const pickedInitialTab = useRef(false);
  useEffect(() => {
    if (pickedInitialTab.current || isLoading || loadingDomains) return;
    pickedInitialTab.current = true;
    if (list.length === 0 && domains.length === 0) setTab('domains');
  }, [isLoading, loadingDomains, list.length, domains.length]);

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

  const addDomainMutation = useMutation({
    mutationFn: (domain: string) => domainApi.create(domain),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setAddDomainOpen(false);
      setNewDomain('');
      setTab('domains');
      setExpandedDomain(result.domain.id);
      toast.success(`${result.domain.domain} added — add the DNS records to finish`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to add domain'),
  });

  const deleteDomainMutation = useMutation({
    mutationFn: domainApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['domains'] }); toast.success('Domain removed'); setExpandedDomain(null); },
  });

  if (isLoading || loadingDomains) return <div className="max-w-5xl space-y-3"><SkeletonList rows={5} /></div>;

  const filtered = search.trim()
    ? list.filter((a: SmtpAccount) => `${a.from_name || ''} ${a.label} ${a.email_address}`.toLowerCase().includes(search.toLowerCase()))
    : list;

  const verifiedCount = list.filter((a: SmtpAccount) => a.is_verified).length;
  const sentTodayTotal = list.reduce((sum: number, a: SmtpAccount) => sum + a.sends_today, 0);
  const authedDomains = domains.filter((d) => d.is_verified).length;
  const warmingCount = list.filter((a: SmtpAccount) => a.warmup_mode).length;
  const unauthedMailboxes = list.filter((a: SmtpAccount) => { const d = matchDomain(domains, a.email_address); return !d || !d.is_verified; }).length;

  const setupSteps = [
    { label: 'Authenticate a domain', done: authedDomains > 0, hint: 'Prove SPF, DKIM & DMARC' },
    { label: 'Connect a mailbox', done: list.length > 0, hint: 'The address you send from' },
    { label: 'Start warm-up', done: warmingCount > 0, hint: 'Build sender reputation' },
  ];
  const setupComplete = setupSteps.every((s) => s.done);
  const stepTab: Tab[] = ['domains', 'mailboxes', 'warmup'];

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number; alert?: boolean }[] = [
    { id: 'mailboxes', label: 'Mailboxes', icon: Mail, count: list.length },
    { id: 'domains', label: 'Domains', icon: Globe, count: domains.length, alert: domains.length > 0 && authedDomains < domains.length },
    { id: 'warmup', label: 'Warm-up', icon: Flame, count: warmingCount },
  ];

  const goToDomain = (id: string) => { setTab('domains'); setExpandedDomain(id); };

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
        title="Email delivery"
        description="Domains, mailboxes and warm-up — everything that decides whether you land in the inbox."
        meta={
          list.length > 0 || domains.length > 0 ? (
            <>
              <span className="tabular">{list.length} mailbox{list.length === 1 ? '' : 'es'} · {verifiedCount} verified</span>
              <span className="sep-dot" />
              <span className="tabular">{authedDomains}/{domains.length} domain{domains.length === 1 ? '' : 's'} authenticated</span>
              <span className="sep-dot" />
              <span className="tabular">{sentTodayTotal.toLocaleString()} sent today</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <button onClick={() => setShowExplainer(true)} className="icon-btn h-8 px-2.5 text-[12.5px] whitespace-nowrap">
              <HelpCircle className="h-3.5 w-3.5" /> How it works
            </button>
            {tab === 'domains'
              ? <Button size="sm" onClick={() => setAddDomainOpen(true)}><Plus className="h-3.5 w-3.5" /> Add domain</Button>
              : <Button size="sm" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add mailbox</Button>}
          </>
        }
      />

      {/* Fetch failures render the same "connect your first mailbox"/"add a domain" empty
          states as a genuinely empty account below — surface the real cause instead. */}
      {(accountsError || domainsError) && (
        <div className="w-full mb-4 flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-[12.5px] text-[var(--text-secondary)] flex-1">
            Couldn't load your {accountsError && domainsError ? 'mailboxes or domains' : accountsError ? 'mailboxes' : 'domains'} — this isn't necessarily empty, something went wrong fetching it.
          </span>
          <button
            onClick={() => { if (accountsError) queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] }); if (domainsError) queryClient.invalidateQueries({ queryKey: ['domains'] }); }}
            className="text-[12px] font-semibold text-[var(--indigo)] hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Guided setup — disappears once all three steps are done */}
      {!setupComplete && (
        <SetupProgress steps={setupSteps} onStep={(i) => setTab(stepTab[i])} />
      )}

      {/* At-risk warning — the one thing worth surfacing unprompted */}
      {setupComplete && unauthedMailboxes > 0 && (
        <button
          onClick={() => setTab('domains')}
          className="w-full mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-left hover:bg-amber-500/10 transition-colors"
        >
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="text-[12.5px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{unauthedMailboxes} mailbox{unauthedMailboxes === 1 ? '' : 'es'}</span> sending from an unauthenticated domain — fix the DNS to protect deliverability.
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 ml-auto flex-shrink-0" />
        </button>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] mb-4">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium transition-colors',
                active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn('flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular', active ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>{t.count}</span>
              )}
              {t.alert && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
              <span className={cn('absolute left-2 right-2 -bottom-px h-[2px] rounded-t-full transition-opacity', active ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0')} />
            </button>
          );
        })}
      </div>

      {/* ── Mailboxes tab ── */}
      {tab === 'mailboxes' && (
        list.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
            <div className="text-center mb-5">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] mb-3"><Mail className="h-5 w-5 text-[var(--indigo)]" /></span>
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">Connect your first mailbox</p>
              <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1">Pick your provider — settings are pre-filled, you just add email and password.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
              {QUICK_PROVIDERS.map((provider) => (
                <button key={provider.preset.name} onClick={() => openQuick(provider.preset)} className="group surface flex items-center gap-2.5 p-3 hover:shadow-[var(--shadow-md)] hover:border-[rgba(91,91,245,0.25)] transition-all text-left">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shrink-0">{provider.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{provider.preset.name}</p>
                    <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">{provider.description}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors shrink-0" />
                </button>
              ))}
            </div>
            <p className="text-center text-[11.5px] text-[var(--text-tertiary)] mt-4">
              Different provider?{' '}
              <button onClick={openAdd} className="text-[var(--indigo)] hover:underline font-medium">Connect any mailbox</button>
              {' '}— {SMTP_PRESETS.length} providers auto-detected.
            </p>
          </div>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center gap-2 px-3 h-12 border-b border-[var(--border-subtle)]">
              <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mailboxes by name or email…" className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
              <span className="text-[11.5px] text-[var(--text-tertiary)] tabular">{filtered.length} of {list.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="py-2.5 pl-4 pr-3">Sender</th>
                    <th className="py-2.5 px-3">Domain auth</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Warm-up</th>
                    <th className="py-2.5 px-3">Deliverability</th>
                    <th className="py-2.5 px-3">Sent today</th>
                    <th className="py-2.5 pr-4 pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((account: SmtpAccount) => {
                    // During an active ramp the real enforced cap is the ramped allowance for
                    // today, not the eventual target — matches the Warm-up tab's own number.
                    const limit = warmupAllowance(account);
                    const displayName = account.from_name || account.label;
                    const dom = matchDomain(domains, account.email_address);
                    return (
                      <tr key={account.id} className="group border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
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
                        <td className="py-2.5 px-3">
                          {dom?.is_verified ? (
                            <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-[4px]"><ShieldCheck className="h-2.5 w-2.5" /> Authenticated</span>
                          ) : dom ? (
                            <button onClick={() => goToDomain(dom.id)} className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[4px] hover:brightness-95" title="Finish DNS setup"><AlertTriangle className="h-2.5 w-2.5" /> Setup DNS</button>
                          ) : (
                            <button onClick={() => { setNewDomain(domainOf(account.email_address)); setAddDomainOpen(true); }} className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[4px] hover:brightness-95" title="Add this domain to authenticate it"><Plus className="h-2.5 w-2.5" /> Add domain</button>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {account.is_verified
                            ? <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-[4px]"><CheckCircle2 className="h-2.5 w-2.5" /> Verified</span>
                            : <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[4px]"><XCircle className="h-2.5 w-2.5" /> Unverified</span>}
                        </td>
                        <td className="py-2.5 px-3">
                          {account.warmup_mode
                            ? <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-[10.5px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[4px]"><Flame className="h-2.5 w-2.5" /> Warming</span>
                            : <button onClick={() => setTab('warmup')} className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Off</button>}
                        </td>
                        <td className="py-2.5 px-3"><span className={cn('text-[12.5px] font-semibold tabular', healthColor(account.health_score))}>{account.health_score}%</span></td>
                        <td className="py-2.5 px-3"><span className="text-[12.5px] text-[var(--text-secondary)] tabular">{account.sends_today}<span className="text-[var(--text-muted)]">/{limit}</span></span></td>
                        <td className="py-2.5 pr-4 pl-3">
                          <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => testMutation.mutate(account.id)} disabled={testingId === account.id} className="icon-btn h-7 px-2 text-[11.5px]" title="Test connection"><TestTube className="h-3 w-3" /> {testingId === account.id ? 'Testing…' : 'Test'}</button>
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
            {filtered.length === 0 && <div className="py-10 text-center text-[12.5px] text-[var(--text-tertiary)]">No mailboxes match “{search}”.</div>}
          </Card>
        )
      )}

      {/* ── Domains tab ── */}
      {tab === 'domains' && (
        domains.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] mb-3"><Globe className="h-5 w-5 text-[var(--indigo)]" /></span>
            <p className="text-[15px] font-semibold text-[var(--text-primary)]">Authenticate your sending domain</p>
            <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
              We generate the exact SPF, DKIM and DMARC records to paste into your DNS — the single biggest factor in reaching the inbox.
            </p>
            <Button className="mt-4" onClick={() => setAddDomainOpen(true)}><Plus className="h-3.5 w-3.5" /> Add domain</Button>
            <p className="text-[11.5px] text-[var(--text-tertiary)] mt-3">
              Not sure why this matters? <button onClick={() => setShowExplainer(true)} className="text-[var(--indigo)] hover:underline">2-minute explainer</button>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {domains.map((domain) => {
              const mailboxCount = list.filter((a: SmtpAccount) => matchDomain(domains, a.email_address)?.id === domain.id).length;
              const expanded = expandedDomain === domain.id;
              return (
                <Card key={domain.id} padding="none" className="overflow-hidden relative">
                  <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', domain.is_verified ? 'bg-emerald-500' : 'bg-amber-500')} />
                  <button onClick={() => setExpandedDomain(expanded ? null : domain.id)} className="w-full flex items-center justify-between p-3.5 hover:bg-[var(--bg-hover)] transition-colors text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn('flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0', domain.is_verified ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20')}>
                        {domain.is_verified ? <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{domain.domain}</h3>
                          {domain.is_verified
                            ? <span className="inline-flex items-center px-1.5 h-[18px] text-[10.5px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-[4px]">Authenticated</span>
                            : <span className="inline-flex items-center px-1.5 h-[18px] text-[10.5px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-[4px]">Needs DNS setup</span>}
                          {mailboxCount > 0 && <span className="text-[10.5px] text-[var(--text-tertiary)]">{mailboxCount} mailbox{mailboxCount === 1 ? '' : 'es'}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge ok={domain.txt_verified} label="Ownership" />
                          <StatusBadge ok={domain.spf_ok} label="SPF" />
                          <StatusBadge ok={domain.dkim_ok} label="DKIM" />
                          <StatusBadge ok={domain.dmarc_ok} label="DMARC" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${domain.domain}?`)) deleteDomainMutation.mutate(domain.id); }} className="icon-btn h-7 w-7 hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"><Trash2 className="h-3 w-3" /></button>
                      {expanded ? <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-elevated)]/40">
                      <DomainDetailPanel domain={domain} onClose={() => setExpandedDomain(null)} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ── Warm-up tab ── */}
      {tab === 'warmup' && (
        list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-14 text-center">
            <Flame className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-[var(--text-primary)]">Connect a mailbox first</p>
            <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 mb-4">Warm-up builds sending reputation on your connected mailboxes.</p>
            <Button onClick={() => setTab('mailboxes')}><Mail className="h-3.5 w-3.5" /> Go to mailboxes</Button>
          </div>
        ) : (
          <WarmupPanel onAddMailbox={openAdd} />
        )
      )}

      <SmtpAccountModal open={modalOpen} onClose={() => setModalOpen(false)} editAccount={editAccount} initialPreset={initialPreset} />

      {/* Add domain modal */}
      <Modal isOpen={addDomainOpen} onClose={() => { setAddDomainOpen(false); setNewDomain(''); }} title="Add a sending domain" size="md">
        <form onSubmit={(e) => { e.preventDefault(); if (newDomain.trim()) addDomainMutation.mutate(newDomain.trim()); }} className="space-y-4">
          <p className="text-[12.5px] text-[var(--text-secondary)]">Enter the root domain you send from. We'll generate the exact SPF, DKIM and DMARC records to add to your DNS — then check them automatically.</p>
          <Input label="Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))} placeholder="yourcompany.com" required autoFocus hint="Root domain, not a subdomain or email address" />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" type="button" onClick={() => { setAddDomainOpen(false); setNewDomain(''); }}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={addDomainMutation.isPending}>
              {addDomainMutation.isPending ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Adding…</> : 'Generate DNS records'}
            </Button>
          </div>
        </form>
      </Modal>

      {showExplainer && <ExplainerModal onClose={() => setShowExplainer(false)} />}
    </div>
  );
}
