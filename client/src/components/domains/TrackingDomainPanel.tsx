import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackingDomainApi, type TrackingDomainCheck } from '../../api/tracking-domain.api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { Check, Copy, Link2, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Your own domain on the links inside your emails.

   Spam filters judge the domains that appear inside a message, not only
   the one it was sent from. Sharing one link host across every account
   makes deliverability a shared fate: one customer getting it reported
   degrades everyone, and nobody affected can see why.
   ═══════════════════════════════════════════════════════════════════════ */

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
        {label}
      </p>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
            () => toast.error('Could not copy'),
          );
        }}
        className="w-full flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1.5 text-left hover:border-[var(--border-strong)] transition-colors"
        title="Copy"
      >
        <code className="flex-1 min-w-0 truncate text-caption text-[var(--text-primary)]">{value}</code>
        {copied
          ? <Check className="h-3 w-3 flex-shrink-0 text-emerald-500" />
          : <Copy className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" />}
      </button>
    </div>
  );
}

export function TrackingDomainPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const [checks, setChecks] = useState<TrackingDomainCheck[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tracking-domain'],
    queryFn: trackingDomainApi.get,
  });

  const save = useMutation({
    mutationFn: () => trackingDomainApi.set(draft.trim()),
    onSuccess: () => {
      setChecks(null);
      setDraft('');
      qc.invalidateQueries({ queryKey: ['tracking-domain'] });
      toast.success('Saved — add the CNAME, then verify');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that domain'),
  });

  const verify = useMutation({
    mutationFn: trackingDomainApi.verify,
    onSuccess: (result) => {
      setChecks(result.checks);
      qc.invalidateQueries({ queryKey: ['tracking-domain'] });
      if (result.verified) toast.success('Your links now use your own domain');
      else toast.error('Not ready yet — see the checks below');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not verify'),
  });

  const remove = useMutation({
    mutationFn: trackingDomainApi.remove,
    onSuccess: () => {
      setChecks(null);
      qc.invalidateQueries({ queryKey: ['tracking-domain'] });
      toast.success('Removed — links go back to the shared domain');
    },
  });

  const record = data?.domain;

  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
          <Link2 className="h-4 w-4 text-[var(--indigo)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-strong font-semibold text-[var(--text-primary)]">Tracking domain</h3>
          <p className="text-caption text-[var(--text-secondary)] leading-snug mt-0.5">
            Spam filters look at the links inside your emails, not just who sent them. On the shared
            domain your deliverability moves with everyone else&rsquo;s; on your own it moves with yours.
          </p>
        </div>
        {record?.verified && (
          <span className="inline-flex items-center gap-1 flex-shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-semibold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> Active
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-16 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
      ) : !record ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="track.yourcompany.com"
            className="flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) save.mutate(); }}
          />
          <Button onClick={() => save.mutate()} disabled={!draft.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add domain'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-body font-medium text-[var(--text-primary)]">
              {record.domain}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
            >
              <RefreshCw className={cn('h-3 w-3', verify.isPending && 'animate-spin')} />
              {record.verified ? 'Re-check' : 'Verify'}
            </Button>
            <button
              onClick={() => confirm(
                {
                  title: `Stop using ${record.domain}?`,
                  body: 'New emails go back to the shared tracking domain. Links in emails already sent keep pointing at this one, so leave the CNAME in place.',
                  tone: 'danger',
                  confirmLabel: 'Remove',
                },
                () => remove.mutate(),
              )}
              className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Only shown while it isn't live — once active, the record is just noise. */}
          {!record.verified && data?.cname && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3 space-y-2.5">
              {/*
                * Two steps, and the second one is the one people miss.
                *
                * The DNS record alone gets you a name that resolves and a TLS
                * handshake that fails, because the certificate is issued by
                * the host, not the registrar - and it will not issue one for a
                * domain it has never been told about. This used to say "add it
                * to your hosting provider" without saying where, which is a
                * step nobody can follow. Numbering them also stops the second
                * looking like a footnote to the first.
                */}
              <p className="text-caption font-medium text-[var(--text-primary)]">
                Step 1 &mdash; add this record at your DNS provider
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <CopyField label="Type" value={data.cname.type} />
                <CopyField label="Name" value={data.cname.host} />
                <CopyField label="Value" value={data.cname.value} />
              </div>

              <p className="text-caption font-medium text-[var(--text-primary)] pt-1">
                Step 2 &mdash; add the domain where this app is hosted
              </p>
              <p className="text-caption text-[var(--text-tertiary)] leading-relaxed">
                Your host issues the HTTPS certificate, and it will not issue one for a
                domain it has never been told about &mdash; so the DNS record on its own
                gives you a name that resolves and a connection that fails. Add{' '}
                <code className="text-[var(--text-secondary)]">{record.domain}</code> as a
                custom domain on the service that serves{' '}
                <code className="text-[var(--text-secondary)]">{data.cname.value}</code>.
                On Render that is <span className="text-[var(--text-secondary)]">Dashboard &rarr;
                your service &rarr; Settings &rarr; Custom Domains &rarr; Add</span>; on
                Vercel, <span className="text-[var(--text-secondary)]">Project &rarr; Settings
                &rarr; Domains</span>. A certificate usually appears within a few minutes.
              </p>
              <p className="text-caption text-[var(--text-tertiary)] leading-relaxed">
                Then press Verify. Both halves are checked, and nothing switches over until
                the domain genuinely serves this app over HTTPS &mdash; a broken link in an
                email that has already been sent cannot be fixed afterwards.
              </p>
            </div>
          )}

          {checks && (
            <ul className="space-y-1.5">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2 text-caption">
                  <span className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full mt-px',
                    check.ok
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                  )}>
                    {check.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <X className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[var(--text-primary)]">{check.label}</span>
                    <span className="text-[var(--text-tertiary)]"> — {check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!checks && record.last_error && !record.verified && (
            <p className="text-caption text-amber-600 dark:text-amber-400">{record.last_error}</p>
          )}
        </div>
      )}
    </div>
  );
}
