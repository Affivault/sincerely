import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { inboxApi } from '../../api/inbox.api';
import { domainApi } from '../../api/domain.api';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card } from '../../components/shared/Card';
import { cn } from '../../lib/utils';
import {
  Mail, Plus, Trash2, CheckCircle2, HelpCircle, ArrowRight, Globe, Search, Flame,
  ShieldCheck, ShieldAlert, ChevronDown, ChevronRight, AlertTriangle, RefreshCw, Gauge,
  Lock, Plug, Server,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, SmtpPreset, SendingDomain, InboxSyncProgress } from '@lemlist/shared';
import { SMTP_PRESETS } from '@lemlist/shared';
import { SmtpAccountModal } from './SmtpAccountModal';
import { WarmupPanel } from './WarmupPanel';
import { StatusBadge, DomainDetailPanel } from '../domains/DomainsPage';
import { TrackingDomainPanel } from '../../components/domains/TrackingDomainPanel';
import { ReadinessPanel } from '../../components/delivery/ReadinessPanel';
import { MailboxList } from '../../components/delivery/MailboxList';
import { MailboxDrawer } from '../../components/mailbox/MailboxDrawer';
import { ProviderLogo } from '../../components/mailbox/ProviderLogo';
import { EmptyState } from '../../components/shared/EmptyState';

/* ═══════════════════════════════════════════════════════════════════════
   Email accounts.

   One page for everything that decides whether mail lands: the mailboxes
   it is sent from, the domains that vouch for them, the warm-up that earns
   their reputation, and the readiness check over all three.

   Mailboxes lead, because that is what somebody arriving here came to do.
   The other three are the steps that follow, in the order they follow -
   which is also the order of the setup guide shown until they are done.

   Everything is linkable: ?mailbox=<id> opens a mailbox's panel,
   ?connect=1 the connect wizard, ?tab=domains&domain=<id> a domain,
   &add=<domain> the add-domain dialog pre-filled. The wizard's last step
   and other pages lean on these rather than saying "go to the Domains tab".
   ═══════════════════════════════════════════════════════════════════════ */

/* The three providers most people connect, as the first thing offered. */
const HERO_PROVIDERS: { name: string; title: string; blurb: string }[] = [
  { name: 'Gmail', title: 'Google', blurb: 'Gmail or Google Workspace' },
  { name: 'Outlook / Microsoft 365', title: 'Microsoft', blurb: 'Outlook, Hotmail or Microsoft 365' },
  { name: '', title: 'Any other provider', blurb: 'Zoho, Titan, your own server - found from the address' },
];

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
      <div className="space-y-4 text-body text-[var(--text-secondary)] leading-relaxed">
        <p>Every time you send, the receiving server (Gmail, Outlook…) asks one question: <span className="font-medium text-[var(--text-primary)]">“is this sender really who they claim to be?”</span> Three DNS records answer it. Without them, cold email lands in spam — or is rejected outright.</p>
        <div className="grid sm:grid-cols-3 gap-2.5">
          {[
            { k: 'SPF', c: 'Who is allowed to send', d: 'A list of the servers permitted to send mail for your domain. Stops strangers forging your address.' },
            { k: 'DKIM', c: 'A tamper-proof signature', d: 'Your mail is cryptographically signed. The receiver checks the signature to confirm nothing was altered in transit.' },
            { k: 'DMARC', c: 'What to do if a check fails', d: 'Ties SPF + DKIM to your visible “From” address and tells receivers how strict to be. Required by Gmail/Yahoo for bulk senders.' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
              <p className="text-body font-semibold text-[var(--text-primary)]">{x.k}</p>
              <p className="text-caption font-medium text-[var(--indigo)] mb-1">{x.c}</p>
              <p className="text-caption text-[var(--text-tertiary)]">{x.d}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
          <p className="text-body font-semibold text-[var(--text-primary)] mb-1.5">Where each thing goes</p>
          <ul className="space-y-1 text-caption">
            <li><span className="font-medium text-[var(--text-primary)]">Mailbox sign-in (SMTP/IMAP)</span> → entered here in Sincerely, so we can send and read replies. Passwords are stored encrypted.</li>
            <li><span className="font-medium text-[var(--text-primary)]">DNS records (SPF/DKIM/DMARC)</span> → published on your <span className="font-medium">domain</span>, at your registrar/DNS host (Cloudflare, Namecheap, GoDaddy…). We generate the exact values.</li>
          </ul>
          <p className="text-caption text-[var(--text-tertiary)] mt-2">The order that works: connect the mailbox, authenticate its domain, then warm it up before sending real volume.</p>
        </div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Need a full walkthrough? <Link to="/smtp-accounts/guide" className="text-[var(--indigo)] hover:underline" onClick={onClose}>Read the setup guide</Link>.
        </p>
      </div>
    </Modal>
  );
}

/* ─── Getting ready to send — shown only until done ──── */
function SetupGuide({
  steps,
}: {
  steps: { label: string; done: boolean; hint: string; cta: string; run: () => void }[];
}) {
  const next = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card padding="none" className="mb-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <p className="text-body font-semibold text-[var(--text-primary)]">Get ready to send</p>
          <p className="text-caption text-[var(--text-tertiary)]">{doneCount} of {steps.length} done - about ten minutes in all.</p>
        </div>
        <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <span className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="grid divide-y divide-[var(--border-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {steps.map((step, i) => {
          const active = i === next;
          return (
            <li key={step.label} className={cn('flex flex-col gap-2 px-4 py-3.5', active && 'bg-[var(--indigo-subtle)]/35')}>
              <div className="flex items-center gap-2.5">
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" />
                ) : (
                  <span className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-micro font-bold',
                    active ? 'bg-[var(--indigo)] text-white' : 'border border-[var(--border-default)] text-[var(--text-muted)]',
                  )}>{i + 1}</span>
                )}
                <span className={cn('text-body font-medium', step.done ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]')}>{step.label}</span>
              </div>
              <p className="pl-[30px] text-caption leading-snug text-[var(--text-tertiary)]">{step.hint}</p>
              {active && (
                <div className="pl-[30px]">
                  <Button size="sm" onClick={step.run}>{step.cta} <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────── */
type Tab = 'mailboxes' | 'domains' | 'warmup' | 'readiness';
const VALID_TABS: Tab[] = ['mailboxes', 'domains', 'warmup', 'readiness'];

export function EmailAccountsPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // Lets other pages (e.g. the Toolkit's Warm-up card) link straight to a
  // specific tab instead of always landing on Mailboxes.
  const requestedTab = searchParams.get('tab');
  const tab: Tab = (VALID_TABS as string[]).includes(requestedTab || '') ? (requestedTab as Tab) : 'mailboxes';
  const setTab = (t: Tab) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (t === 'mailboxes') next.delete('tab'); else next.set('tab', t);
    next.delete('domain');
    next.delete('add');
    return next;
  });
  const openMailboxId = searchParams.get('mailbox');
  const setOpenMailbox = (id: string | null) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('mailbox', id); else next.delete('mailbox');
    return next;
  });

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
  /*
   * Sync progress is what makes a row honest. Without it the list can only
   * report stored flags - which is exactly how three mailboxes showed
   * "Verified" while none of them could read a reply.
   */
  const { data: progressData } = useQuery({
    queryKey: ['inbox-sync-progress'],
    queryFn: inboxApi.syncProgress,
    refetchInterval: (query) => {
      const rows = query.state.data as InboxSyncProgress[] | undefined;
      return rows?.some((a) => !a.history_complete && !a.blocked) ? 5000 : 60000;
    },
    meta: { silentError: true },
  });
  const syncProgress = progressData || [];
  const domains = domainsData || [];
  const list = accounts || [];

  /* Links in: ?connect=1, ?domain=<id>, ?add=<domain>. Handled once, then cleared. */
  useEffect(() => {
    const connect = searchParams.get('connect');
    const domainId = searchParams.get('domain');
    const add = searchParams.get('add');
    if (!connect && !domainId && !add) return;
    if (connect) {
      const preset = SMTP_PRESETS.find((p) => p.name === connect) || null;
      setEditAccount(null); setInitialPreset(preset); setModalOpen(true);
    }
    if (domainId) setExpandedDomain(domainId);
    if (add) { setNewDomain(add); setAddDomainOpen(true); }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('connect'); next.delete('domain'); next.delete('add');
      if (domainId || add) next.set('tab', 'domains');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const openAdd = () => { setEditAccount(null); setInitialPreset(null); setModalOpen(true); };
  const openQuick = (preset: SmtpPreset | null) => { setEditAccount(null); setInitialPreset(preset); setModalOpen(true); };
  const openEdit = (a: SmtpAccount) => { setEditAccount(a); setInitialPreset(null); setModalOpen(true); };

  const deleteMutation = useMutation({
    mutationFn: smtpApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      setOpenMailbox(null);
      toast.success('Mailbox disconnected');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to remove account'),
  });

  /* Correcting a server address or login the app itself got wrong. */
  const repairMutation = useMutation({
    mutationFn: smtpApi.repairHosts,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      if (result.repaired > 0) {
        const one = result.results.find((r) => r.repaired);
        toast.success(result.repaired === 1 && one ? one.note : `${result.repaired} mailboxes corrected`);
      } else {
        // The reason matters more than the fact. Show what the server said.
        toast(result.results.find((r) => r.note)?.note || 'Nothing to correct.', { icon: 'ℹ️' });
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not check the mail servers'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => smtpApi.test(id),
    onMutate: (id) => setTestingId(id),
    onSuccess: (result) => {
      if (result.success) { toast.success(result.message); queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] }); }
      else toast.error(result.message);
    },
    /*
     * axios reports a timeout and a dropped connection identically, as
     * "Network Error" — which told people their internet was broken when
     * the mail server was simply slow to answer. Name the real situation.
     */
    onError: (err: any) => toast.error(
      err.response?.data?.error
      || (err?.code === 'ECONNABORTED' || /timeout|network error/i.test(err?.message || '')
        ? 'The check took too long to answer. The mail server may be slow — try again in a moment.'
        : err.message || 'Connection test failed'),
    ),
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
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to remove domain'),
  });

  const openMailbox = useMemo(() => list.find((a: SmtpAccount) => a.id === openMailboxId) || null, [list, openMailboxId]);

  if (isLoading || loadingDomains) return <div className="max-w-5xl space-y-3"><SkeletonList rows={5} /></div>;

  const filtered = search.trim()
    ? list.filter((a: SmtpAccount) => `${a.from_name || ''} ${a.label} ${a.email_address}`.toLowerCase().includes(search.toLowerCase()))
    : list;

  const verifiedCount = list.filter((a: SmtpAccount) => a.is_verified).length;
  const sentTodayTotal = list.reduce((sum: number, a: SmtpAccount) => sum + a.sends_today, 0);
  const authedDomains = domains.filter((d) => d.is_verified).length;
  const warmingCount = list.filter((a: SmtpAccount) => a.warmup_mode).length;
  const unauthedMailboxes = list.filter((a: SmtpAccount) => { const d = matchDomain(domains, a.email_address); return !d || !d.is_verified; }).length;

  const authenticateFor = (a: SmtpAccount) => {
    setOpenMailbox(null);
    const dom = matchDomain(domains, a.email_address);
    if (dom) { setTab('domains'); setExpandedDomain(dom.id); return; }
    setNewDomain(domainOf(a.email_address));
    setAddDomainOpen(true);
  };

  const firstUnauthed = list.find((a: SmtpAccount) => !matchDomain(domains, a.email_address)?.is_verified);
  const setupSteps = [
    { label: 'Connect a mailbox', done: list.length > 0, hint: 'The address your campaigns send from. We find its servers and test it for you.', cta: 'Connect mailbox', run: openAdd },
    {
      label: 'Authenticate its domain', done: authedDomains > 0,
      hint: 'Three DNS records (SPF, DKIM, DMARC) that decide whether you reach the inbox.',
      cta: 'Set up the domain',
      run: () => (firstUnauthed ? authenticateFor(firstUnauthed) : setAddDomainOpen(true)),
    },
    { label: 'Warm it up', done: warmingCount > 0, hint: 'A slow, automatic ramp that builds the address a sending reputation.', cta: 'Start warm-up', run: () => setTab('warmup') },
  ];
  const setupComplete = setupSteps.every((s) => s.done);

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number; alert?: boolean }[] = [
    { id: 'mailboxes', label: 'Mailboxes', icon: Mail, count: list.length },
    { id: 'domains', label: 'Domains', icon: Globe, count: domains.length, alert: domains.length > 0 && authedDomains < domains.length },
    { id: 'warmup', label: 'Warm-up', icon: Flame, count: warmingCount },
    { id: 'readiness', label: 'Readiness check', icon: Gauge },
  ];

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
        description="The mailboxes you send from, the domains that vouch for them, and the warm-up that earns their reputation."
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
            <button onClick={() => setShowExplainer(true)} className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-body text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <HelpCircle className="h-3.5 w-3.5" /> How it works
            </button>
            {tab === 'domains'
              ? <Button size="sm" onClick={() => setAddDomainOpen(true)}><Plus className="h-3.5 w-3.5" /> Add domain</Button>
              : <Button size="sm" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Connect mailbox</Button>}
          </>
        }
      />

      {/* Fetch failures render the same "connect your first mailbox"/"add a domain" empty
          states as a genuinely empty account below — surface the real cause instead. */}
      {(accountsError || domainsError) && (
        <div className="w-full mb-4 flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-body text-[var(--text-secondary)] flex-1">
            Couldn't load your {accountsError && domainsError ? 'mailboxes or domains' : accountsError ? 'mailboxes' : 'domains'} — this isn't necessarily empty, something went wrong fetching it.
          </span>
          <button
            onClick={() => { if (accountsError) queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] }); if (domainsError) queryClient.invalidateQueries({ queryKey: ['domains'] }); }}
            className="text-body font-semibold text-[var(--indigo)] hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* The walk from nothing to ready — disappears once all three are done.
          Hidden on an empty mailbox tab, where the empty state is step one. */}
      {!setupComplete && !(tab === 'mailboxes' && list.length === 0) && <SetupGuide steps={setupSteps} />}

      {/* At-risk warning — the one thing worth surfacing unprompted */}
      {setupComplete && unauthedMailboxes > 0 && (
        <button
          onClick={() => setTab('domains')}
          className="w-full mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-left hover:bg-amber-500/10 transition-colors"
        >
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="text-body text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{unauthedMailboxes} mailbox{unauthedMailboxes === 1 ? '' : 'es'}</span> sending from an unauthenticated domain — fix the DNS to protect deliverability.
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 ml-auto flex-shrink-0" />
        </button>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] mb-4">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex flex-shrink-0 items-center gap-1.5 h-9 px-3 text-strong font-medium transition-colors',
                active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn('flex h-[17px] min-w-[17px] items-center justify-center rounded-md px-1 text-micro font-semibold tabular', active ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>{t.count}</span>
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
          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="px-6 pb-6 pt-8 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--indigo-subtle)]"><Plug className="h-5 w-5 text-[var(--indigo)]" /></span>
              <h2 className="mt-3 text-title font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Connect the mailbox you send from</h2>
              <p className="mx-auto mt-1 max-w-md text-body text-[var(--text-tertiary)]">
                Pick your provider, add the password, and Sincerely tests sending and receiving before anything is saved. Two minutes, start to finish.
              </p>
              <div className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-3">
                {HERO_PROVIDERS.map((p) => (
                  <button
                    key={p.title}
                    onClick={() => openQuick(p.name ? SMTP_PRESETS.find((x) => x.name === p.name) || null : null)}
                    className="group flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-5 text-center transition-all hover:-translate-y-0.5 hover:border-[rgba(91,91,245,0.3)] hover:shadow-[var(--shadow-md)]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                      {p.name ? <ProviderLogo name={p.name} className="h-6 w-6" /> : <Server className="h-5 w-5 text-[var(--indigo)]" />}
                    </span>
                    <span className="text-strong font-semibold text-[var(--text-primary)]">{p.title}</span>
                    <span className="text-caption leading-snug text-[var(--text-tertiary)]">{p.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-6 py-3 text-caption text-[var(--text-tertiary)]">
              <span className="inline-flex items-center gap-1.5"><Lock className="h-3 w-3" /> Passwords stored encrypted</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3" /> Tested before it is saved</span>
              <span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3" /> {SMTP_PRESETS.length} providers recognised</span>
            </div>
          </div>
        ) : (
          <>
            {/*
              * Search appears once it earns its place. A filter box above
              * three rows is chrome; above twenty it is the fastest way in.
              */}
            {list.length > 8 && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 h-9">
                <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mailboxes…" className="flex-1 bg-transparent text-strong text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
                {search && <span className="text-caption text-[var(--text-tertiary)] tabular">{filtered.length} of {list.length}</span>}
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10 text-center text-body text-[var(--text-tertiary)]">
                No mailboxes match “{search}”.
              </div>
            ) : (
              <MailboxList
                accounts={filtered}
                progress={syncProgress}
                domainVerified={(email) => !!matchDomain(domains, email)?.is_verified}
                domainKnown={(email) => !!matchDomain(domains, email)}
                onOpen={(a) => setOpenMailbox(a.id)}
                onEdit={openEdit}
                onTest={(a) => testMutation.mutate(a.id)}
                onRepair={() => repairMutation.mutate()}
                onAuthenticateDomain={authenticateFor}
                testingId={testingId}
                repairing={repairMutation.isPending}
              />
            )}
            <button
              onClick={openAdd}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-default)] py-3 text-body font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--indigo)]/40 hover:bg-[var(--indigo-subtle)]/30 hover:text-[var(--indigo)]"
            >
              <Plus className="h-4 w-4" /> Connect another mailbox
            </button>
          </>
        )
      )}

      {/* ── Domains tab ── */}
      {tab === 'domains' && (
        <div className="mb-4">
          {/* Sits with the sending domains because it is the same job — which
              domains vouch for this email — even though this one is about the
              links inside rather than the address it came from. */}
          <TrackingDomainPanel />
        </div>
      )}

      {tab === 'domains' && (
        domains.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] mb-3"><Globe className="h-5 w-5 text-[var(--indigo)]" /></span>
            <p className="text-heading font-semibold text-[var(--text-primary)]">Authenticate your sending domain</p>
            <p className="text-body text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
              We generate the exact SPF, DKIM and DMARC records to paste into your DNS — the single biggest factor in reaching the inbox.
            </p>
            <Button className="mt-4" onClick={() => { if (firstUnauthed) setNewDomain(domainOf(firstUnauthed.email_address)); setAddDomainOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add domain</Button>
            <p className="text-caption text-[var(--text-tertiary)] mt-3">
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
                          <h3 className="text-heading font-semibold text-[var(--text-primary)] truncate">{domain.domain}</h3>
                          {domain.is_verified
                            ? <span className="inline-flex items-center px-1.5 h-[18px] text-micro font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded">Authenticated</span>
                            : <span className="inline-flex items-center px-1.5 h-[18px] text-micro font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded">Needs DNS setup</span>}
                          {mailboxCount > 0 && <span className="text-micro text-[var(--text-tertiary)]">{mailboxCount} mailbox{mailboxCount === 1 ? '' : 'es'}</span>}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirm(
                            { title: `Remove ${domain.domain}?`, body: 'Sincerely stops tracking its DNS records. The records themselves stay at your registrar.', tone: 'danger', confirmLabel: 'Remove' },
                            () => deleteDomainMutation.mutate(domain.id),
                          );
                        }}
                        className="icon-btn h-7 w-7 hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                        title={`Remove ${domain.domain}`}
                      ><Trash2 className="h-3 w-3" /></button>
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
          <EmptyState
            icon={Flame}
            title="Connect a mailbox first"
            description="Warm-up builds sending reputation on your connected mailboxes."
            actionLabel="Connect mailbox"
            onAction={openAdd}
          />
        ) : (
          <WarmupPanel onAddMailbox={openAdd} />
        )
      )}

      {/* ── Readiness tab ── */}
      {tab === 'readiness' && <ReadinessPanel />}

      <MailboxDrawer
        account={modalOpen ? null : openMailbox}
        progress={openMailbox ? syncProgress.find((p) => p.smtp_account_id === openMailbox.id) : undefined}
        domain={openMailbox ? matchDomain(domains, openMailbox.email_address) : null}
        onClose={() => setOpenMailbox(null)}
        onEdit={openEdit}
        onRemove={(a) => confirm(
          { title: `Disconnect ${a.email_address}?`, body: 'Campaigns sending from this mailbox will stop until you connect it again.', tone: 'danger', confirmLabel: 'Disconnect' },
          () => deleteMutation.mutate(a.id),
        )}
        onRepair={() => repairMutation.mutate()}
        onAuthenticateDomain={authenticateFor}
        repairing={repairMutation.isPending}
      />

      <SmtpAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editAccount={editAccount}
        initialPreset={initialPreset}
      />

      {/* Add domain modal */}
      <Modal isOpen={addDomainOpen} onClose={() => { setAddDomainOpen(false); setNewDomain(''); }} title="Authenticate a sending domain" size="md">
        <form onSubmit={(e) => { e.preventDefault(); if (newDomain.trim()) addDomainMutation.mutate(newDomain.trim()); }} className="space-y-4">
          <p className="text-body text-[var(--text-secondary)]">Enter the domain you send from. We generate the exact SPF, DKIM and DMARC records to add at your DNS host, then check them for you automatically.</p>
          <Input label="Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^.*@/, ''))} placeholder="yourcompany.com" required autoFocus hint="The part after the @ in your address" />
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
