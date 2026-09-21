import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { domainApi } from '../../api/domain.api';
import { Spinner } from '../../components/ui/Spinner';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
import { SettingsShell } from '../../components/shared/SettingsShell';
import { Card } from '../../components/shared/Card';
import { StatCard } from '../../components/shared/StatCard';
import { cn } from '../../lib/utils';
import {
  Globe,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Shield,
  Mail,
  HelpCircle,
  Server,
  Sparkles,
  ClipboardCopy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SendingDomain, DomainVerifyResponse, DnsRecordInstruction } from '@lemlist/shared';

export function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-body font-medium rounded ${
      ok
        ? 'bg-green-500/10 text-green-500'
        : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
    }`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

/** Copy button with its own feedback state, so each field reports independently. */
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      title={title}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const RECORD_STATUS_META = {
  verified: {
    border: 'border-emerald-500/25',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    text: 'Configured',
  },
  warning: {
    border: 'border-amber-500/30',
    icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    text: 'Needs attention',
  },
  missing: {
    border: 'border-[var(--border-subtle)]',
    icon: <XCircle className="h-4 w-4 text-rose-400" />,
    chip: 'bg-rose-500/10 text-rose-500',
    text: 'Not found',
  },
} as const;

function RecordField({ label, value, copyable = true }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="space-y-1 min-w-0">
      <span className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 min-w-0 text-caption font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] break-all leading-relaxed">
          {value}
        </code>
        {copyable && <CopyButton text={value} title={`Copy ${label.toLowerCase()}`} />}
      </div>
    </div>
  );
}

function DnsRecordCard({ record }: { record: DnsRecordInstruction }) {
  const meta = RECORD_STATUS_META[record.status];
  const showValue = record.copyable !== false && record.value;

  return (
    <div className={cn('rounded-xl border bg-[var(--bg-surface)] p-3.5 space-y-2.5', meta.border)}>
      <div className="flex items-center gap-2 flex-wrap">
        {meta.icon}
        <span className="text-strong font-semibold text-[var(--text-primary)]">
          {record.label || record.type}
        </span>
        <span className="text-micro font-semibold font-mono px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]">
          {record.type}
        </span>
        <span className={cn('text-micro px-1.5 py-0.5 rounded font-medium', meta.chip)}>{meta.text}</span>
        <span className="flex-1" />
      </div>

      <p className="text-body text-[var(--text-secondary)]">{record.purpose}</p>

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <RecordField label="Host / Name" value={record.host} />
        {showValue ? <RecordField label="Value / Content" value={record.value} /> : null}
      </div>

      {record.current && record.current !== record.value && record.status !== 'verified' && (
        <div className="text-caption text-[var(--text-tertiary)]">
          <span className="font-medium text-[var(--text-secondary)]">Currently published:</span>{' '}
          <code className="font-mono break-all">{record.current}</code>
        </div>
      )}

      {record.note && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg px-2.5 py-2 text-caption leading-relaxed',
          record.status === 'warning' ? 'bg-amber-500/5 text-amber-700 dark:text-amber-400' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
        )}>
          <HelpCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{record.note}</span>
        </div>
      )}
    </div>
  );
}

const CHECKS: { key: keyof Pick<SendingDomain, 'txt_verified' | 'spf_ok' | 'dkim_ok' | 'dmarc_ok'>; label: string }[] = [
  { key: 'txt_verified', label: 'Ownership' },
  { key: 'spf_ok', label: 'SPF' },
  { key: 'dkim_ok', label: 'DKIM' },
  { key: 'dmarc_ok', label: 'DMARC' },
];

export function DomainDetailPanel({
  domain,
}: {
  domain: SendingDomain;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const wasVerified = useRef(domain.is_verified);

  const { data: recordsData, isLoading: loadingRecords } = useQuery({
    queryKey: ['domain-records', domain.id],
    queryFn: () => domainApi.getRecords(domain.id),
  });

  const verifyMutation = useMutation({
    mutationFn: () => domainApi.verify(domain.id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['domain-records', domain.id] });
      if (result.domain.is_verified) {
        wasVerified.current = true;
        toast.success(`${domain.domain} verified successfully!`);
      } else {
        toast('DNS checked — some records still aren’t visible yet. Changes can take a few minutes to propagate.', { icon: '🕐' });
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Verification failed');
    },
  });

  // Quietly re-check every 30s while the panel is open and the domain isn't
  // verified — DNS propagation resolves itself without the user hammering
  // the Verify button. Celebrate once on the transition to verified.
  useEffect(() => {
    if (domain.is_verified) return;
    const interval = setInterval(() => {
      domainApi.verify(domain.id)
        .then((result) => {
          queryClient.invalidateQueries({ queryKey: ['domains'] });
          queryClient.invalidateQueries({ queryKey: ['domain-records', domain.id] });
          if (result.domain.is_verified && !wasVerified.current) {
            wasVerified.current = true;
            toast.success(`${domain.domain} verified successfully!`);
          }
        })
        .catch(() => { /* silent — this is a background convenience check */ });
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain.id, domain.is_verified]);

  const passing = CHECKS.filter((c) => domain[c.key]).length;
  const records = recordsData?.records || [];
  const mx = recordsData?.dns?.mx;
  const dkim = recordsData?.dns?.dkim;

  const [selector, setSelector] = useState(domain.dkim_selector || '');
  const saveSelector = useMutation({
    mutationFn: () => domainApi.setDkimSelector(domain.id, selector.trim() || null),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['domain-records', domain.id] });
      // Show what was actually stored. A name that did not resolve is not
      // stored, and leaving their text in the box is what lets them fix a
      // typo rather than retype the whole thing.
      if (result.domain.dkim_selector) setSelector(result.domain.dkim_selector);
      if (result.dns.dkim.found) toast.success(result.dns.dkim.note);
      else toast.error(result.dns.dkim.note);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not check that selector'),
  });

  const copyAll = async () => {
    const lines = records
      .filter((r) => r.copyable !== false && r.value)
      .map((r) => `${r.type}\t${r.host}\t${r.value}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('All records copied — paste them into your DNS manager');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  /*
   * The DKIM selector box.
   *
   * It exists because DNS has no way to list the selectors a domain has -
   * a key lives at <selector>._domainkey and you can only look up a name
   * you already know. So the check guesses, and for Amazon SES, HubSpot,
   * Postmark and anything else with per-account names, guessing cannot
   * work even in principle. Before this there was no way for somebody who
   * KNEW the answer to tell us, and the screen simply insisted their
   * working DKIM did not exist.
   */
  /*
   * The verdict. Three genuinely different situations wear three different
   * colours, because "we could not find it" and "you have not got one" are
   * not the same news and must not look the same.
   */
  const subtree = dkim?.subtree;
  const verdict = domain.dkim_ok
    ? { tone: 'ok', title: 'DKIM is working' }
    : subtree === 'present'
      ? { tone: 'warn', title: 'Your DKIM is there — we just need its name' }
      : subtree === 'absent'
        ? { tone: 'bad', title: `No DKIM is published on ${domain.domain}` }
        : { tone: 'warn', title: 'We could not find your DKIM' };

  const TONE = {
    ok: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400',
    warn: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400',
    bad: 'border-rose-500/30 bg-rose-500/[0.06] text-rose-700 dark:text-rose-400',
  } as const;

  const dkimHelp = (
    <div
      className={cn('rounded-lg border p-3', TONE[verdict.tone as keyof typeof TONE])}
      data-dkim-help
      data-dkim-subtree={subtree || 'none'}
    >
      <p className="text-body font-semibold" data-dkim-verdict>{verdict.title}</p>
      <p className="mt-1 text-caption leading-relaxed text-[var(--text-secondary)]" data-dkim-note>
        {dkim?.note
          || 'DNS gives no way to list DKIM selectors, so we guess the common ones.'}
      </p>

      {/*
        * When the keys are proven to exist, the only missing thing is the
        * name - so ask for exactly that and skip the explaining. When the
        * subtree is empty there is nothing to name, so say what to do
        * instead of offering a box that cannot succeed.
        */}
      {!domain.dkim_ok && subtree !== 'absent' && (
        <p className="mt-1.5 text-caption leading-relaxed text-[var(--text-tertiary)]">
          Providers like Amazon SES, HubSpot and Postmark use selectors nobody
          could guess. Find yours in your provider&rsquo;s DNS settings &mdash;
          it is the part before <code>._domainkey</code> &mdash; and enter it here.
        </p>
      )}

      {subtree !== 'absent' && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveSelector.mutate(); }}
            placeholder="e.g. selector1, google, hs1-4021"
            className="input-field h-8 flex-1 text-body"
            data-dkim-selector
          />
          <button
            onClick={() => saveSelector.mutate()}
            disabled={saveSelector.isPending}
            className="btn-secondary h-8"
            data-dkim-check
          >
            {saveSelector.isPending ? 'Checking…' : 'Check it'}
          </button>
        </div>
      )}

      {domain.dkim_selector && (
        <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">
          Using <code>{domain.dkim_selector}._domainkey.{domain.domain}</code>
          {domain.dkim_selector_source === 'manual' ? ' (you set this)' : ' (we found this)'}
        </p>
      )}

      {/* The evidence, for anyone who wants to check our working. */}
      <details className="mt-2 group">
        <summary className="cursor-pointer text-caption text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] select-none">
          What we checked
        </summary>
        <div className="mt-1.5 space-y-1 text-caption text-[var(--text-tertiary)]">
          <p>
            Looked up <code>_domainkey.{domain.domain}</code> to see whether any
            keys exist at all, then{' '}
            {dkim?.checked_selectors
              ? `tried ${dkim.checked_selectors} known selector names`
              : 'tried the known selector names'}.
          </p>
          <p>
            {subtree === 'present'
              ? 'That name exists in your DNS, which means keys are published under it. DNS cannot list them, so we need the selector from your provider.'
              : subtree === 'absent'
                ? 'That name does not exist in your DNS, so there are no keys published under it.'
                : 'Your DNS answers as though every name exists, so that check could not tell us anything either way.'}
          </p>
        </div>
      </details>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header: domain + progress + verify */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-heading font-semibold text-[var(--text-primary)] truncate">{domain.domain}</h3>
            {domain.is_verified && (
              <span className="inline-flex items-center gap-1 px-1.5 h-[19px] text-micro font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-[4px]">
                <Sparkles className="h-2.5 w-2.5" /> Ready to send
              </span>
            )}
          </div>
          {/* Segmented progress */}
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex items-center gap-1">
              {CHECKS.map((c) => (
                <span
                  key={c.key}
                  title={`${c.label}: ${domain[c.key] ? 'passing' : 'not configured'}`}
                  className={cn('h-1.5 w-9 rounded-full transition-colors', domain[c.key] ? 'bg-emerald-500' : 'bg-[var(--border-default)]')}
                />
              ))}
            </div>
            <span className="text-caption font-medium text-[var(--text-tertiary)] tabular">{passing} of {CHECKS.length} checks passing</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {CHECKS.map((c) => <StatusBadge key={c.key} ok={!!domain[c.key]} label={c.label} />)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {records.length > 0 && (
            <Button variant="secondary" size="sm" onClick={copyAll} title="Copy every record as tab-separated lines">
              <ClipboardCopy className="h-3.5 w-3.5" /> Copy all
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${verifyMutation.isPending ? 'animate-spin' : ''}`} />
            {verifyMutation.isPending ? 'Checking…' : 'Verify DNS'}
          </Button>
        </div>
      </div>

      {/* Provider + MX context */}
      <div className="flex items-center gap-2 flex-wrap">
        {domain.detected_provider && (
          <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]">
            <Mail className="h-3 w-3 shrink-0" />
            Provider: <span className="font-medium text-[var(--text-primary)]">{domain.detected_provider}</span>
          </span>
        )}
        {mx && (
          <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-caption text-[var(--text-secondary)]" title={mx.records.map((r) => `${r.priority} ${r.exchange}`).join('\n')}>
            <Server className="h-3 w-3 shrink-0" />
            {mx.found
              ? <>MX: <span className="font-medium text-[var(--text-primary)] font-mono">{mx.records[0]?.exchange}</span>{mx.records.length > 1 ? ` +${mx.records.length - 1}` : ''}</>
              : <>No MX records — replies and bounces to this domain can't be received</>}
          </span>
        )}
      </div>

      {/* Setup steps — only while unverified */}
      {!domain.is_verified && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <HelpCircle className="h-4 w-4 text-[var(--indigo)] mt-0.5 shrink-0" />
            <div className="text-body text-[var(--text-secondary)] min-w-0">
              <p className="font-medium text-[var(--text-primary)] mb-1.5">How to finish setup</p>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Open the DNS manager at your registrar (Cloudflare, Namecheap, GoDaddy…)</li>
                <li>Add each record below — copy the host and value exactly as shown</li>
                <li>We re-check automatically every 30 seconds while this panel is open; propagation usually takes 5–15 minutes (up to 48h)</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* DNS Records */}
      {loadingRecords ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : records.length > 0 ? (
        <div className="space-y-2.5">
          <h4 className="text-body font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-[var(--indigo)]" />
            DNS records
          </h4>
          {records.map((record) => (
            <DnsRecordCard key={record.id || record.host + record.type} record={record} />
          ))}
        </div>
      ) : null}

      {/* DKIM selector — the one check that cannot be finished by guessing */}
      {!loadingRecords && dkimHelp}

      {/* Last checked */}
      {domain.last_checked_at && (
        <p className="text-caption text-[var(--text-tertiary)]">
          Last checked {new Date(domain.last_checked_at).toLocaleString()}
          {!domain.is_verified && ' · re-checking automatically'}
        </p>
      )}
    </div>
  );
}

export function DomainsPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<DomainVerifyResponse | null>(null);

  const { data: domains, isLoading, isError } = useQuery({
    queryKey: ['domains'],
    queryFn: domainApi.list,
    meta: { silentError: true }, // has its own inline error state below
  });

  const createMutation = useMutation({
    mutationFn: (domain: string) => domainApi.create(domain),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      setAddResult(result);
      toast.success(`Domain ${result.domain.domain} added`);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to add domain');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: domainApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      toast.success('Domain removed');
      setExpandedId(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to remove domain');
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;
    createMutation.mutate(newDomain.trim());
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setNewDomain('');
    setAddResult(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-3">
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <SettingsShell>
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your domains"
          description="Something went wrong fetching your sending domains — this isn't necessarily an empty account. Try again."
          actionLabel="Retry"
          onAction={() => queryClient.invalidateQueries({ queryKey: ['domains'] })}
        />
      </SettingsShell>
    );
  }

  const verifiedDomains = (domains || []).filter((d: SendingDomain) => d.is_verified).length;
  const totalDomains = (domains || []).length;
  const verifiedPct = totalDomains > 0 ? Math.round((verifiedDomains / totalDomains) * 100) : 0;

  return (
    <SettingsShell>
    <div>
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <Globe className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Sending domains"
        description="Verify SPF, DKIM and DMARC records to improve deliverability and protect your brand."
        meta={
          totalDomains > 0 ? (
            <>
              <span className="tabular">{totalDomains} domain{totalDomains === 1 ? '' : 's'}</span>
              <span className="sep-dot" />
              <span className="tabular">{verifiedDomains} verified · {verifiedPct}%</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <Link to="/smtp-accounts/guide" className="icon-btn h-8 px-2.5 text-body">
              <HelpCircle className="h-3.5 w-3.5" /> Setup guide
            </Link>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="h-3.5 w-3.5" /> Add domain
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      {totalDomains > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard icon={Globe} accent="indigo" label="Total domains" value={totalDomains} />
          <StatCard icon={CheckCircle2} accent="emerald" label="Verified" value={verifiedDomains} hint={`${verifiedPct}% verified`} />
          <StatCard icon={AlertTriangle} accent="amber" label="Needs attention" value={totalDomains - verifiedDomains} />
        </div>
      )}

      {/* Info banner */}
      <Card variant="premium" padding="md" className="mb-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0">
            <Shield className="h-4 w-4 text-[var(--indigo)]" />
          </span>
          <div className="min-w-0">
            <p className="text-strong font-medium text-[var(--text-primary)]">Why verify your domain?</p>
            <p className="text-body text-[var(--text-secondary)] mt-1">
              SPF, DKIM and DMARC tell email providers that Sincerely is authorised to send from your domain — dramatically improving inbox placement.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-caption text-[var(--text-tertiary)]">
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Better inbox placement</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Prevent spoofing</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Build sender reputation</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Domain list or empty state */}
      {(!domains || domains.length === 0) ? (
        <EmptyState
          icon={Globe}
          title="No domains added"
          description="Add your sending domain to verify DNS records and improve deliverability."
          actionLabel="Add Domain"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <div className="space-y-2">
          {domains.map((domain: SendingDomain) => (
            <div key={domain.id} className="card overflow-hidden relative">
              <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', domain.is_verified ? 'bg-emerald-500' : 'bg-amber-500')} />
              {/* Domain row */}
              <button
                onClick={() => setExpandedId(expandedId === domain.id ? null : domain.id)}
                className="w-full flex items-center justify-between p-3.5 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0',
                    domain.is_verified
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]'
                  )}>
                    {domain.is_verified ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Globe className="h-4 w-4 text-[var(--indigo)]" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-heading font-semibold text-[var(--text-primary)] truncate tracking-[-0.005em]">{domain.domain}</h3>
                      {domain.is_verified ? (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-micro font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-[4px]">
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-micro font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-[4px]">
                          Pending
                        </span>
                      )}
                      {domain.detected_provider && (
                        <span className="text-micro text-[var(--text-tertiary)]">via {domain.detected_provider}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatusBadge ok={domain.txt_verified} label="TXT" />
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
                        () => deleteMutation.mutate(domain.id),
                      );
                    }}
                    className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {expandedId === domain.id ? (
                    <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === domain.id && (
                <div className="border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-elevated)]/40">
                  <DomainDetailPanel domain={domain} onClose={() => setExpandedId(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add domain modal */}
      <Modal
        isOpen={showAddModal}
        onClose={closeAddModal}
        title={addResult ? `Set Up ${addResult.domain.domain}` : 'Add Sending Domain'}
        size="lg"
      >
        {!addResult ? (
          <form onSubmit={handleAdd} className="space-y-4">
            <p className="text-strong text-[var(--text-secondary)]">
              Enter the domain you want to send emails from. We'll generate the DNS records you need to add.
            </p>
            <Input
              label="Domain"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              required
            />
            <p className="text-body text-[var(--text-tertiary)]">
              Enter the root domain (e.g., <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded">example.com</code>),
              not a subdomain or full email address.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={closeAddModal}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add Domain'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-strong font-medium text-[var(--text-primary)]">Domain added successfully</p>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">
                    Now add these DNS records to your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.)
                    and click <strong>Verify</strong> when done.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {addResult.records.map((record, idx) => (
                <DnsRecordCard key={record.id || idx} record={record} />
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={closeAddModal}>
                Done — I'll verify later
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  closeAddModal();
                  setExpandedId(addResult.domain.id);
                }}
              >
                View Domain Details
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </SettingsShell>
  );
}
