import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { domainApi } from '../../api/domain.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
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
  ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SendingDomain, DomainVerifyResponse, DnsRecordInstruction } from '@lemlist/shared';

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded ${
      ok
        ? 'bg-green-500/10 text-green-500'
        : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
    }`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function CopyableRecord({ record }: { record: DnsRecordInstruction }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor =
    record.status === 'verified' ? 'border-green-500/30 bg-green-500/5' :
    record.status === 'warning' ? 'border-amber-500/30 bg-amber-500/5' :
    'border-red-500/30 bg-red-500/5';

  const statusIcon =
    record.status === 'verified' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
    record.status === 'warning' ? <AlertTriangle className="h-4 w-4 text-amber-500" /> :
    <XCircle className="h-4 w-4 text-red-400" />;

  return (
    <div className={`rounded-lg border ${statusColor} p-4 space-y-2`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {record.type} Record
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
            record.status === 'verified' ? 'bg-green-500/10 text-green-500' :
            record.status === 'warning' ? 'bg-amber-500/10 text-amber-500' :
            'bg-red-500/10 text-red-400'
          }`}>
            {record.status === 'verified' ? 'Configured' : record.status === 'warning' ? 'Needs attention' : 'Not found'}
          </span>
        </div>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">{record.purpose}</p>

      {/* Host */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Host / Name</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-3 py-2 rounded border border-[var(--border-subtle)] break-all">
            {record.host}
          </code>
          <button
            onClick={() => handleCopy(record.host)}
            className="shrink-0 p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Copy host"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Value */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Value / Content</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-3 py-2 rounded border border-[var(--border-subtle)] break-all">
            {record.value}
          </code>
          <button
            onClick={() => handleCopy(record.value)}
            className="shrink-0 p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Copy value"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DomainDetailPanel({
  domain,
  onClose,
}: {
  domain: SendingDomain;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

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
        toast.success(`${domain.domain} verified successfully!`);
      } else {
        toast('DNS records checked. Some records are still missing.', { icon: '!' });
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Verification failed');
    },
  });

  return (
    <div className="space-y-5">
      {/* Domain header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{domain.domain}</h3>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge ok={domain.txt_verified} label="Ownership" />
            <StatusBadge ok={domain.spf_ok} label="SPF" />
            <StatusBadge ok={domain.dkim_ok} label="DKIM" />
            <StatusBadge ok={domain.dmarc_ok} label="DMARC" />
          </div>
        </div>
        <Button
          variant="primary"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${verifyMutation.isPending ? 'animate-spin' : ''}`} />
          {verifyMutation.isPending ? 'Checking...' : 'Verify DNS'}
        </Button>
      </div>

      {/* Provider detection */}
      {domain.detected_provider && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          Email provider detected: <span className="font-medium text-[var(--text-primary)]">{domain.detected_provider}</span>
        </div>
      )}

      {/* Instructions */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-2">
        <div className="flex items-start gap-2">
          <HelpCircle className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
          <div className="text-sm text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">How to set up your domain</p>
            <ol className="mt-2 space-y-1 list-decimal list-inside text-xs">
              <li>Copy each DNS record below and add it to your domain's DNS settings</li>
              <li>DNS changes can take up to 48 hours to propagate (usually 5-15 minutes)</li>
              <li>Click <strong>Verify DNS</strong> to check if your records are detected</li>
              <li>Once the ownership TXT record is verified, your domain is ready to use</li>
            </ol>
          </div>
        </div>
      </div>

      {/* DNS Records */}
      {loadingRecords ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : recordsData ? (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--indigo)]" />
            DNS Records to Configure
          </h4>
          {recordsData.records.map((record, idx) => (
            <CopyableRecord key={idx} record={record} />
          ))}
        </div>
      ) : null}

      {/* Last checked */}
      {domain.last_checked_at && (
        <p className="text-xs text-[var(--text-tertiary)]">
          Last checked: {new Date(domain.last_checked_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export function DomainsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<DomainVerifyResponse | null>(null);

  const { data: domains, isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: domainApi.list,
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
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const verifiedDomains = (domains || []).filter((d: SendingDomain) => d.is_verified).length;
  const totalDomains = (domains || []).length;
  const verifiedPct = totalDomains > 0 ? Math.round((verifiedDomains / totalDomains) * 100) : 0;

  return (
    <div>
      <PageHeader
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
            <Link to="/smtp-accounts/guide" className="icon-btn h-8 px-2.5 text-[12.5px]">
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
            <p className="text-[13px] font-medium text-[var(--text-primary)]">Why verify your domain?</p>
            <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
              SPF, DKIM and DMARC tell email providers that SkySend is authorised to send from your domain — dramatically improving inbox placement.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-[11.5px] text-[var(--text-tertiary)]">
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
                      <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate tracking-[-0.005em]">{domain.domain}</h3>
                      {domain.is_verified ? (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10.5px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-[4px]">
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10.5px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-[4px]">
                          Pending
                        </span>
                      )}
                      {domain.detected_provider && (
                        <span className="text-[10.5px] text-[var(--text-tertiary)]">via {domain.detected_provider}</span>
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
                      if (confirm(`Remove ${domain.domain}?`)) deleteMutation.mutate(domain.id);
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
            <p className="text-sm text-[var(--text-secondary)]">
              Enter the domain you want to send emails from. We'll generate the DNS records you need to add.
            </p>
            <Input
              label="Domain"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              required
            />
            <p className="text-xs text-[var(--text-tertiary)]">
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
                  <p className="text-sm font-medium text-[var(--text-primary)]">Domain added successfully</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Now add these DNS records to your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.)
                    and click <strong>Verify</strong> when done.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {addResult.records.map((record, idx) => (
                <CopyableRecord key={idx} record={record} />
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
  );
}
