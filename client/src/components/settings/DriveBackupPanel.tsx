import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle, CheckCircle, Clock3, ExternalLink, FileSpreadsheet, History, Loader2, RefreshCw, ShieldCheck, Unplug,
} from 'lucide-react';
import { formatDateTime, formatDayMonthTime } from '@lemlist/shared';
import { backupApi } from '../../api/backup.api';
import { Toggle } from '../ui/Toggle';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Settings > Backup: every lead, contact, company and list, in a
   spreadsheet in your own Google Drive, about a minute behind.

   The panel answers three questions: is it on, how far behind is it, and
   where is it. Everything else (how it works, what to do with the file)
   is in one short paragraph, because that is all anyone needs to trust it.
   ═══════════════════════════════════════════════════════════════════════ */

const TABS = [
  { name: 'People', what: 'Every lead and contact, with lists, tags, email status and company' },
  { name: 'Companies', what: 'Size, industry, location, phone, website' },
  { name: 'No email', what: 'People waiting for an address' },
  { name: 'Lists', what: 'Each list and how many are in it' },
  { name: 'Change log', what: 'Added, moved, became a contact, enriched, deleted - with the time' },
];

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return formatDayMonthTime(iso);
}

export function DriveBackupPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { data: s, isLoading } = useQuery({
    queryKey: ['drive-backup'],
    queryFn: backupApi.status,
    // Live while something is on its way, calm otherwise.
    refetchInterval: (q) => (q.state.data?.connected && (q.state.data.pending > 0 || q.state.data.needs_full) ? 5000 : 30_000),
  });

  // Back from Google's consent screen.
  useEffect(() => {
    const outcome = params.get('backup');
    if (!outcome) return;
    if (outcome === 'connected') toast.success(`Connected ${params.get('account') || 'Google Drive'} - the first backup is being written now`);
    else if (outcome === 'denied') toast(params.get('message') || 'Google did not allow that connection.', { icon: '⚠️', duration: 12000 });
    else toast.error(params.get('message') || 'Could not connect Google Drive');
    qc.invalidateQueries({ queryKey: ['drive-backup'] });
    const next = new URLSearchParams(params);
    ['backup', 'account', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, qc, setParams]);

  const connect = useMutation({
    mutationFn: backupApi.authorize,
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start connecting'),
  });
  const toggle = useMutation({
    mutationFn: backupApi.setEnabled,
    onSuccess: (next) => {
      qc.setQueryData(['drive-backup'], next);
      toast.success(next.enabled ? 'Backup is on - catching up now' : 'Backup paused');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });
  const now = useMutation({
    mutationFn: backupApi.backupNow,
    onSuccess: (r) => {
      toast.success(r.busy ? 'A backup is already being written' : 'Refreshing the whole backup now');
      qc.invalidateQueries({ queryKey: ['drive-backup'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start a backup'),
  });
  const disconnect = () => confirm({
    title: 'Disconnect Google Drive?',
    body: 'Backups stop and Sincerely forgets the connection. The spreadsheet stays in your Drive, as it is now.',
    confirmLabel: 'Disconnect',
    tone: 'danger',
  }, async () => {
    try {
      await backupApi.disconnect();
      qc.invalidateQueries({ queryKey: ['drive-backup'] });
      toast.success('Disconnected');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not disconnect');
    }
  });

  return (
    <div className="space-y-4" data-drive-backup>
      <div>
        <h2 className="text-heading font-semibold text-[var(--text-primary)]">Backup</h2>
        <p className="text-strong text-[var(--text-secondary)] mt-1">
          Your leads, contacts, companies and lists, kept in a spreadsheet in your own Google Drive, about a minute behind.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>
      ) : s?.unavailable ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-body text-[var(--text-secondary)]">
          Google Drive backup needs the latest database update (migration 112).
        </p>
      ) : !s?.configured ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-body text-[var(--text-secondary)]">
          Google sign-in is not set up on this deployment yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).
        </p>
      ) : !s.connected ? (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex flex-wrap items-start gap-4 p-5">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-[240px]">
              <p className="text-strong font-semibold text-[var(--text-primary)]">Back up to Google Drive</p>
              <p className="mt-1 text-body text-[var(--text-secondary)] leading-relaxed">
                Sincerely makes one spreadsheet in your Drive and keeps it up to date: when someone is added, moves list, becomes a contact, is enriched or is deleted, it is there within about a minute, with a line in the change log. Once a day the whole sheet is refreshed.
              </p>
              <p className="mt-2 flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
                <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                Sincerely can only see and edit the spreadsheet it makes - nothing else in your Drive.
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={() => connect.mutate()} disabled={connect.isPending} data-connect-drive>
              {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              Connect Google Drive
            </button>
          </div>
          <TabList />
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden" data-backup-status>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
              <span className={cn(
                'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl',
                s.broken_reason ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : s.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
              )}>
                {s.broken_reason ? <AlertCircle className="h-5 w-5" /> : s.enabled ? <CheckCircle className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
              </span>
              <div className="flex-1 min-w-[220px]">
                <p className="text-strong font-semibold text-[var(--text-primary)]">
                  {s.broken_reason ? 'Backup stopped' : !s.enabled ? 'Backup paused'
                    : s.needs_full || !s.last_full_at ? 'Writing your backup...' : s.pending > 0 ? `Up to date, ${s.pending.toLocaleString()} change${s.pending === 1 ? '' : 's'} on the way` : 'Up to date'}
                </p>
                <p className="text-caption text-[var(--text-tertiary)]">
                  {s.account_email ? `To ${s.account_email}'s Drive. ` : ''}
                  {s.last_flush_at ? <span title={formatDateTime(s.last_flush_at)}>Last updated {ago(s.last_flush_at)}.</span> : 'Not written yet.'}
                  {s.last_full_at ? <span title={formatDateTime(s.last_full_at)}> Full refresh {ago(s.last_full_at)}.</span> : null}
                </p>
              </div>
              <label className="flex items-center gap-2 text-body text-[var(--text-secondary)]">
                <Toggle checked={s.enabled} onChange={(v) => toggle.mutate(v)} disabled={toggle.isPending || !!s.broken_reason} aria-label="Keep the backup up to date" />
                {s.enabled ? 'On' : 'Off'}
              </label>
            </div>

            {(s.broken_reason || s.last_error) && (
              <div className={cn('mx-5 mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-caption',
                s.broken_reason ? 'bg-rose-500/[0.08] text-rose-800 dark:text-rose-300' : 'bg-amber-400/[0.10] text-amber-800 dark:text-amber-300')}>
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                <span className="flex-1">{s.broken_reason || s.last_error}</span>
                {s.broken_reason && (
                  <button type="button" className="btn-secondary h-7" onClick={() => connect.mutate()} disabled={connect.isPending}>Reconnect</button>
                )}
              </div>
            )}

            <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              {[
                ['People', s.rows.people], ['Companies', s.rows.companies], ['No email', s.rows.held], ['Lists', s.rows.lists],
              ].map(([label, n]) => (
                <div key={label as string} className="px-5 py-3">
                  <dt className="text-caption text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="text-title font-semibold tabular text-[var(--text-primary)]">{Number(n).toLocaleString()}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-5 py-3">
              {s.spreadsheet_url && (
                <a href={s.spreadsheet_url} target="_blank" rel="noreferrer" className="btn-primary" data-open-backup>
                  <ExternalLink className="h-3.5 w-3.5" /> Open the spreadsheet
                </a>
              )}
              <button type="button" className="btn-secondary" onClick={() => now.mutate()} disabled={now.isPending || !s.enabled || !!s.broken_reason} data-backup-now>
                {now.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh everything now
              </button>
              <button type="button" className="btn-ghost ml-auto" onClick={disconnect}>
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </button>
            </div>
          </section>
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <TabList />
          </section>
        </>
      )}

      <p className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)] leading-relaxed">
        <History className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
        The spreadsheet is a copy: edits made in it are not sent back to Sincerely, and the next refresh puts it right. Deleted people stay in it, marked Deleted. To restore, download the People tab as a CSV and import it.
      </p>
    </div>
  );
}

function TabList() {
  return (
    <div className="border-t border-[var(--border-subtle)] px-5 py-3">
      <p className="text-caption font-semibold text-[var(--text-tertiary)] mb-2">In the spreadsheet</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {TABS.map((t) => (
          <li key={t.name} className="text-caption text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{t.name}</span> - {t.what}
          </li>
        ))}
      </ul>
    </div>
  );
}
