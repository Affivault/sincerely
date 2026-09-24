/* ═══════════════════════════════════════════════════════════════════════
   One mailbox, everything about it, one click from the list.

   Coming back to a mailbox used to mean opening the setup form again - the
   same dialog that connects one - to find out whether it was working, how
   much it had sent, or which server it used. Checking something should not
   look like changing it.

   So the list row opens this: a side panel that answers "is it OK?" first,
   in one sentence with the fix beside it, then shows how it signs in, how
   it sends, how it warms up and how much mail it has read. Anything that
   changes the connection still goes through the settings form, where it is
   tested before it is saved. Deep-linkable as ?mailbox=<id>.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  X, CheckCircle2, XCircle, Loader2, Plug, Settings2, Trash2, Send, Inbox,
  KeyRound, Flame, Gauge, History, Signature, Reply, ShieldCheck, ShieldAlert, ArrowRight,
} from 'lucide-react';
import type { SmtpAccount, InboxSyncProgress, SyncWindowMonths, SendingDomain } from '@lemlist/shared';
import {
  resolveMailboxState, mailboxScore, warmupAllowance, formatDailyLimit,
  SYNC_WINDOW_MONTHS, syncWindowLabel, detectPresetFromEmail, SMTP_PRESETS,
} from '@lemlist/shared';
import { smtpApi } from '../../api/smtp.api';
import { inboxApi } from '../../api/inbox.api';
import { openModals } from '../ui/Modal';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ProviderLogo } from './ProviderLogo';
import { cn, formatRelativeTime } from '../../lib/utils';

const TONE = {
  broken: { pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', dot: 'bg-rose-500', box: 'border-rose-500/25 bg-rose-500/[0.05]' },
  warning: { pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', box: 'border-amber-500/25 bg-amber-500/[0.05]' },
  ready: { pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', box: 'border-emerald-500/20 bg-emerald-500/[0.04]' },
  idle: { pill: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]', dot: 'bg-[var(--border-strong)]', box: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50' },
} as const;

/** Which preset a saved mailbox most likely is, from its address and server. */
function providerOf(a: SmtpAccount): string | null {
  const byAddress = detectPresetFromEmail(a.email_address);
  if (byAddress) return byAddress.name;
  const byHost = SMTP_PRESETS.find((p) => p.smtp_host && p.smtp_host === a.smtp_host);
  return byHost?.name ?? null;
}

function Section({ icon: Icon, title, action, children }: { icon: typeof Send; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4 border-b border-[var(--border-subtle)] last:border-0">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <h3 className="flex-1 text-caption font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-28 flex-shrink-0 text-caption text-[var(--text-tertiary)]">{label}</dt>
      <dd className={cn('min-w-0 flex-1 truncate text-body text-[var(--text-primary)]', mono && 'font-data')}>{children}</dd>
    </div>
  );
}

export function MailboxDrawer({
  account, progress, domain, onClose, onEdit, onRemove, onRepair, onAuthenticateDomain, repairing,
}: {
  account: SmtpAccount | null;
  progress?: InboxSyncProgress;
  domain: SendingDomain | null;
  onClose: () => void;
  onEdit: (a: SmtpAccount) => void;
  onRemove: (a: SmtpAccount) => void;
  onRepair: () => void;
  onAuthenticateDomain: (a: SmtpAccount) => void;
  repairing: boolean;
}) {
  const qc = useQueryClient();
  const identity = useRef({});
  const panelRef = useRef<HTMLElement>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const isTopmost = useCallback(() => openModals[openModals.length - 1] === identity.current, []);
  useFocusTrap(panelRef, !!account, { topmost: isTopmost });

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const key = account?.id ?? null;
  useEffect(() => { setTest(null); }, [key]);
  useEffect(() => {
    if (!key) return;
    // Same overlay stack as Modal: the settings form opened from here takes
    // Escape first, rather than this panel closing underneath it.
    const self = identity.current;
    openModals.push(self);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === self) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, [key]);

  const testMutation = useMutation({
    mutationFn: (id: string) => smtpApi.test(id),
    onMutate: () => setTest(null),
    onSuccess: (r) => {
      setTest({ ok: r.success, message: r.message });
      if (r.success) qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
    },
    onError: (err: any) => setTest({
      ok: false,
      message: err.response?.data?.error
        || (err?.code === 'ECONNABORTED' ? 'The mail server took too long to answer. It may be slow - try again in a moment.' : err.message || 'The test could not run'),
    }),
  });

  const warmupMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => smtpApi.setWarmup(id, { enabled }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
      qc.invalidateQueries({ queryKey: ['warmup'] });
      toast.success(v.enabled ? 'Warm-up started' : 'Warm-up paused');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not change warm-up'),
  });

  const windowMutation = useMutation({
    mutationFn: ({ id, months }: { id: string; months: SyncWindowMonths }) => smtpApi.update(id, { inbox_sync_months: months } as any),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      toast.success(`Keeping ${v.months} month${v.months === 1 ? '' : 's'}. Older mail arrives in the background.`);
      inboxApi.syncInbox().catch(() => { /* background */ });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not change the history window'),
  });

  if (!account) return null;

  const state = resolveMailboxState({
    is_active: account.is_active,
    is_verified: account.is_verified,
    imap_host: account.imap_host,
    sync_error: progress?.last_error ?? null,
    domain_verified: !!domain?.is_verified,
    domain_known: !!domain,
    warmup_mode: account.warmup_mode,
  });
  const tone = TONE[state.tone];
  const score = mailboxScore(account);
  const allowance = warmupAllowance(account);
  const provider = providerOf(account);
  const signature = (account.signature_html || '').replace(/<[^>]*>/g, '').trim();

  const remedy = state.action === 'fix-connection'
    ? { label: repairing ? 'Fixing…' : 'Fix this for me', run: onRepair, busy: repairing }
    : state.action === 'set-imap'
      ? { label: 'Add incoming server', run: () => onEdit(account), busy: false }
      : state.action === 'authenticate-domain'
        ? { label: domain ? 'Finish DNS setup' : 'Authenticate domain', run: () => onAuthenticateDomain(account), busy: false }
        : state.action === 'verify'
          ? { label: testMutation.isPending ? 'Testing…' : 'Test it now', run: () => testMutation.mutate(account.id), busy: testMutation.isPending }
          : null;

  return createPortal(
    <div className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${account.email_address} details`}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)]"
        style={{ animation: 'slideInRight 220ms var(--ease-out) both' }}
      >
        {/* Identity */}
        <header className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <ProviderLogo name={provider} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-heading font-semibold text-[var(--text-primary)]">{account.email_address}</h2>
            <p className="truncate text-caption text-[var(--text-tertiary)]">
              {[account.from_name, provider].filter(Boolean).join(' · ') || 'Custom mail server'}
            </p>
          </div>
          <button onClick={onClose} className="icon-btn h-8 w-8 flex-shrink-0" title="Close (esc)"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* The verdict, first. */}
          <div className="px-5 pt-4">
            <div className={cn('rounded-xl border px-4 py-3', tone.box)}>
              <div className="flex items-start gap-2.5">
                <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', tone.dot)} />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-[var(--text-primary)]">{state.label}</p>
                  {state.detail && <p className="mt-0.5 text-caption leading-snug text-[var(--text-secondary)]">{state.detail}</p>}
                </div>
              </div>
              {remedy && (
                <button
                  onClick={remedy.run}
                  disabled={remedy.busy}
                  className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--indigo)] px-3 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {remedy.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{remedy.label}
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
                <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">Today</p>
                <p className="mt-0.5 text-strong font-semibold tabular text-[var(--text-primary)]">{account.sends_today}<span className="text-body font-normal text-[var(--text-tertiary)]">/{formatDailyLimit(allowance)}</span></p>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
                <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">Health</p>
                <p className={cn('mt-0.5 text-strong font-semibold tabular', score === null ? 'text-[var(--text-muted)]' : score >= 80 ? 'text-[var(--text-primary)]' : 'text-amber-600 dark:text-amber-400')}>{score === null ? '—' : `${score}%`}</p>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
                <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">Sent all-time</p>
                <p className="mt-0.5 text-strong font-semibold tabular text-[var(--text-primary)]">{account.total_sent.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="mt-2">
            {/* Connection */}
            <Section
              icon={KeyRound}
              title="Connection"
              action={
                <button
                  onClick={() => testMutation.mutate(account.id)}
                  disabled={testMutation.isPending}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                  {testMutation.isPending ? 'Testing…' : 'Test now'}
                </button>
              }
            >
              {test && (
                <p className={cn('mb-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-caption', test.ok ? 'bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/[0.07] text-rose-700 dark:text-rose-400')}>
                  {test.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" />}
                  {test.message}
                </p>
              )}
              <dl>
                <Fact label="Sending" mono>
                  <Send className="mr-1.5 inline h-3 w-3 text-[var(--text-tertiary)]" />
                  {account.smtp_host}:{account.smtp_port} <span className="font-sans text-caption text-[var(--text-tertiary)]">{account.smtp_secure ? 'SSL' : 'STARTTLS'}</span>
                </Fact>
                <Fact label="Replies" mono>
                  <Inbox className="mr-1.5 inline h-3 w-3 text-[var(--text-tertiary)]" />
                  {account.imap_host
                    ? `${account.imap_host}:${account.imap_port || 993}`
                    : <span className="font-sans text-amber-600 dark:text-amber-400">not set - replies stay with your provider</span>}
                </Fact>
                <Fact label="Signs in as" mono>{account.smtp_user}</Fact>
                <Fact label="Password">Saved, encrypted</Fact>
              </dl>
            </Section>

            {/* Sending */}
            <Section icon={Gauge} title="Sending">
              <dl>
                <Fact label="From name">{account.from_name || <span className="text-[var(--text-tertiary)]">Not set - the address shows instead</span>}</Fact>
                <Fact label="Reply-to"><Reply className="mr-1 inline h-3 w-3 text-[var(--text-tertiary)]" />{account.reply_to || <span className="text-[var(--text-tertiary)]">This address</span>}</Fact>
                <Fact label="Daily limit">{account.daily_send_limit === 0 ? 'No cap' : `${account.daily_send_limit.toLocaleString()} a day`}{account.warmup_mode && allowance !== account.daily_send_limit && <span className="text-caption text-[var(--text-tertiary)]"> · {formatDailyLimit(allowance)} while warming up</span>}</Fact>
                <Fact label="Signature"><Signature className="mr-1 inline h-3 w-3 text-[var(--text-tertiary)]" />{signature ? (account.signature_auto ? 'Added to every new email' : 'Available in the composer') : <span className="text-[var(--text-tertiary)]">None</span>}</Fact>
              </dl>
            </Section>

            {/* Warm-up */}
            <Section icon={Flame} title="Warm-up">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-[var(--text-primary)]">
                    {account.warmup_mode
                      ? <>Warming up - {account.warmup_sent_today} warm-up email{account.warmup_sent_today === 1 ? '' : 's'} today, campaigns capped at {formatDailyLimit(allowance)} a day for now.</>
                      : 'Off. Turn it on for a new address or one that has not sent in a while.'}
                  </p>
                  {account.warmup_started_at && account.warmup_mode && (
                    <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">Started {formatRelativeTime(account.warmup_started_at)}</p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={account.warmup_mode}
                  disabled={warmupMutation.isPending}
                  onClick={() => warmupMutation.mutate({ id: account.id, enabled: !account.warmup_mode })}
                  className={cn('relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50', account.warmup_mode ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}
                  title={account.warmup_mode ? 'Pause warm-up' : 'Start warm-up'}
                >
                  <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', account.warmup_mode ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
                </button>
              </div>
              <Link to="/email-accounts?tab=warmup" onClick={onClose} className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo)] hover:underline">
                Warm-up settings for all mailboxes <ArrowRight className="h-3 w-3" />
              </Link>
            </Section>

            {/* Domain */}
            <Section icon={domain?.is_verified ? ShieldCheck : ShieldAlert} title="Domain">
              <p className="text-body text-[var(--text-primary)]">
                {domain?.is_verified
                  ? <>{domain.domain} is authenticated - SPF, DKIM and DMARC pass.</>
                  : domain
                    ? <>{domain.domain} is added but its DNS records are not all in place.</>
                    : <>{account.email_address.split('@')[1]} is not authenticated in Sincerely yet.</>}
              </p>
              {!domain?.is_verified && (
                <button onClick={() => onAuthenticateDomain(account)} className="mt-1.5 inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo)] hover:underline">
                  {domain ? 'Finish DNS setup' : 'Authenticate this domain'} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </Section>

            {/* Mail history */}
            <Section icon={History} title="Replies & history">
              <div className="flex items-center gap-1">
                {SYNC_WINDOW_MONTHS.map((months) => {
                  const active = (progress?.window_months ?? 1) === months;
                  return (
                    <button
                      key={months}
                      type="button"
                      onClick={() => !active && windowMutation.mutate({ id: account.id, months })}
                      className={cn(
                        'h-7 rounded-md px-2.5 text-caption font-semibold transition-colors',
                        active ? 'bg-[var(--indigo)] text-white' : 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                      )}
                      title={`Keep ${syncWindowLabel(months).toLowerCase()}`}
                    >
                      {months} month{months === 1 ? '' : 's'}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-caption text-[var(--text-tertiary)]">
                {progress ? (
                  <>
                    {progress.stored.toLocaleString()} message{progress.stored === 1 ? '' : 's'} in Sincerely
                    {progress.blocked
                      ? <span className="text-amber-600 dark:text-amber-400"> · not syncing</span>
                      : progress.history_complete
                        ? <span className="text-emerald-600 dark:text-emerald-400"> · history loaded</span>
                        : <span className="text-[var(--indigo)]"> · still fetching</span>}
                    {progress.last_synced_at && !progress.last_error && <> · synced {formatRelativeTime(progress.last_synced_at)}</>}
                  </>
                ) : account.imap_host ? 'Starting its first sync.' : 'No incoming server, so nothing to sync.'}
              </p>
              {progress?.last_error && (
                <p className="mt-1.5 rounded-lg bg-rose-500/[0.06] px-3 py-2 text-caption text-rose-700 dark:text-rose-400">{progress.last_error}</p>
              )}
            </Section>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <button
            onClick={() => onEdit(account)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--indigo)] px-3.5 text-body font-semibold text-white hover:opacity-90"
          >
            <Settings2 className="h-4 w-4" /> Edit settings
          </button>
          <span className="flex-1" />
          <button
            onClick={() => onRemove(account)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-[var(--text-tertiary)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]"
          >
            <Trash2 className="h-4 w-4" /> Disconnect
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
