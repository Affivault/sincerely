import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle, Box, Check, ChevronDown, Cloud, Database, FileSpreadsheet, FolderOpen, KeyRound, Loader2,
  RefreshCw, ShieldCheck, Unplug,
} from 'lucide-react';
import {
  BACKUP_PROVIDERS, BACKUP_FILES, KEEP_DAYS_CHOICES, formatBackupBytes, formatDateTime, formatDayMonth, s3ConfigProblems,
  type BackupProvider, type BackupProviderMeta, type DriveBackupStatus, type FileBackupProvider, type FileBackupStatus,
} from '@lemlist/shared';
import { backupApi, fileBackupApi } from '../../api/backup.api';
import { DriveBackupPanel } from './DriveBackupPanel';
import { BrandLogo } from '../shared/BrandLogo';
import type { BrandId } from '../shared/brandLogos';
import { Toggle } from '../ui/Toggle';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Settings > Backup: every place this account's data is kept, outside
   Sincerely.

   The page opens on the answer to "is my data safe": a map from Sincerely
   to each place it is copied, with how fresh each copy is. Under it, one
   row per destination, opened to set it up or see its detail. A file
   backup shows its daily copies as a strip of days, because that is what
   they are: a run of dates, each one there or not.
   ═══════════════════════════════════════════════════════════════════════ */

export const BACKUP_ICON: Record<BackupProvider, ElementType> = {
  google_drive: FileSpreadsheet,
  onedrive: Cloud,
  dropbox: Box,
  s3: Database,
};

type Health = 'fresh' | 'stale' | 'writing' | 'paused' | 'stopped' | 'off';

interface DestSummary {
  meta: BackupProviderMeta;
  health: Health;
  last: string | null;
  label: string | null;
  configured: boolean;
}

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return formatDayMonth(iso);
}

function healthOf(connected: boolean, enabled: boolean, broken: string | null, last: string | null, writing: boolean): Health {
  if (!connected) return 'off';
  if (broken) return 'stopped';
  if (!enabled) return 'paused';
  if (writing || !last) return 'writing';
  return Date.now() - new Date(last).getTime() < 26 * 3600_000 ? 'fresh' : 'stale';
}

const HEALTH: Record<Health, { word: string; dot: string; text: string }> = {
  fresh: { word: 'Up to date', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  writing: { word: 'Writing', dot: 'bg-[var(--indigo)]', text: 'text-[var(--indigo-text)]' },
  stale: { word: 'Behind', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  paused: { word: 'Paused', dot: 'bg-[var(--text-tertiary)]', text: 'text-[var(--text-tertiary)]' },
  stopped: { word: 'Stopped', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  off: { word: 'Not set up', dot: 'bg-transparent border border-[var(--border-strong)]', text: 'text-[var(--text-tertiary)]' },
};

const BACKUP_BRAND: Record<BackupProvider, BrandId> = { google_drive: 'google_drive', onedrive: 'onedrive', dropbox: 'dropbox', s3: 's3' };

/** The destination's official mark (components/shared/brandLogos). */
export function ProviderTile({ id, size = 'md' }: { id: BackupProvider; size?: 'sm' | 'md' | 'lg' }) {
  return <BrandLogo id={BACKUP_BRAND[id]} size={size} />;
}

/** Both status calls, shared by Settings and the Integrations page. */
export function useBackupSummaries() {
  const drive = useQuery({
    queryKey: ['drive-backup'],
    queryFn: backupApi.status,
    refetchInterval: (q) => (q.state.data?.connected && (q.state.data.pending > 0 || q.state.data.needs_full) ? 5000 : 30_000),
  });
  const files = useQuery({
    queryKey: ['file-backups'],
    queryFn: fileBackupApi.status,
    refetchInterval: (q) => (q.state.data?.destinations.some((d) => d.writing || (d.connected && !d.last_write_at)) ? 5000 : 30_000),
  });
  const summaries: DestSummary[] = useMemo(() => BACKUP_PROVIDERS.map((meta) => {
    if (meta.id === 'google_drive') {
      const d: DriveBackupStatus | undefined = drive.data;
      const writing = !!d && (d.needs_full || !d.last_full_at);
      return {
        meta, configured: !!d?.configured && !d?.unavailable, label: d?.account_email || null, last: d?.last_flush_at || null,
        health: healthOf(!!d?.connected, !!d?.enabled, d?.broken_reason || null, d?.last_flush_at || null, writing),
      };
    }
    const f = files.data?.destinations.find((x) => x.provider === meta.id);
    return {
      meta, configured: !!f?.configured && !files.data?.unavailable, label: f?.account_label || null, last: f?.last_write_at || null,
      health: healthOf(!!f?.connected, !!f?.enabled, f?.broken_reason || null, f?.last_write_at || null, !!f?.writing),
    };
  }), [drive.data, files.data]);
  return { drive, files, summaries, loading: drive.isLoading || files.isLoading };
}

export function BackupHub() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { drive, files, summaries, loading } = useBackupSummaries();
  const returnedFrom = params.get('provider') as BackupProvider | null;
  const [open, setOpen] = useState<BackupProvider | null>(returnedFrom || null);

  // Back from a sign-in (Google, Microsoft or Dropbox).
  useEffect(() => {
    const outcome = params.get('backup');
    if (!outcome) return;
    const name = BACKUP_PROVIDERS.find((p) => p.id === (params.get('provider') || 'google_drive'))?.name || 'it';
    if (outcome === 'connected') toast.success(`Connected ${params.get('account') || name} - the first backup is being written now`);
    else if (outcome === 'denied') toast(params.get('message') || `${name} did not allow that connection.`, { icon: '⚠️', duration: 12000 });
    else toast.error(params.get('message') || `Could not connect ${name}`);
    setOpen((params.get('provider') as BackupProvider) || 'google_drive');
    qc.invalidateQueries({ queryKey: ['drive-backup'] });
    qc.invalidateQueries({ queryKey: ['file-backups'] });
    const next = new URLSearchParams(params);
    ['backup', 'account', 'message', 'provider'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, qc, setParams]);

  const live = summaries.filter((s) => s.health === 'fresh' || s.health === 'writing' || s.health === 'stale');
  const newest = live.map((s) => s.last).filter(Boolean).sort().pop() || null;
  const people = Math.max(drive.data?.rows.people || 0, ...(files.data?.destinations.map((d) => d.counts.people) || [0]));

  return (
    <div className="space-y-6" data-backup-hub>
      <div>
        <h2 className="text-heading font-semibold text-[var(--text-primary)]">Backup</h2>
        <p className="text-strong text-[var(--text-secondary)] mt-1 max-w-[62ch]">
          Copies of your leads, contacts, companies and lists, kept in places you own. Each one follows every change on its own.
        </p>
      </div>

      <CoverageMap summaries={summaries} liveCount={live.length} newest={newest} people={people} loading={loading} onPick={setOpen} />

      <section aria-label="Where to back up" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] overflow-hidden">
        {summaries.map((s) => (
          <DestinationRow
            key={s.meta.id}
            s={s}
            open={open === s.meta.id}
            onToggle={() => setOpen((o) => (o === s.meta.id ? null : s.meta.id))}
          >
            {s.meta.id === 'google_drive'
              ? <DriveBackupPanel embedded />
              : <FileDestination provider={s.meta.id as FileBackupProvider} status={files.data?.destinations.find((d) => d.provider === s.meta.id)} unavailable={!!files.data?.unavailable} />}
          </DestinationRow>
        ))}
      </section>

      <WhatIsInABackup />
    </div>
  );
}

/* ── The map ─────────────────────────────────────────────────────────── */

function CoverageMap({ summaries, liveCount, newest, people, loading, onPick }: {
  summaries: DestSummary[]; liveCount: number; newest: string | null; people: number; loading: boolean;
  onPick: (p: BackupProvider) => void;
}) {
  const headline = loading ? 'Checking your backups...'
    : liveCount === 0 ? 'Your data is only in Sincerely'
      : liveCount === 1 ? 'Your data is kept in one other place'
        : `Your data is kept in ${liveCount} other places`;
  return (
    <section
      aria-label="Where your data is kept"
      className={cn('relative overflow-hidden rounded-2xl border p-5 sm:p-6',
        liveCount > 0 ? 'border-emerald-500/25 bg-emerald-500/[0.035]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]')}
      data-coverage-map
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-title font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{headline}</p>
        <p className="text-caption text-[var(--text-tertiary)]">
          {liveCount > 0 && newest ? <>Newest copy {ago(newest)}</> : 'Connect one below; it takes a minute.'}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-[minmax(150px,200px)_1fr] items-center gap-x-0 gap-y-4">
        {/* Sincerely, where the data lives */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--indigo)] text-white shadow-[var(--glow-indigo)]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-strong font-semibold text-[var(--text-primary)]">Sincerely</span>
            <span className="block text-caption tabular text-[var(--text-tertiary)]">{people ? `${people.toLocaleString()} people` : 'Your account'}</span>
          </span>
          {/* Out to the spine the destinations hang from */}
          <span aria-hidden className={cn('hidden sm:block h-px flex-1 min-w-6 ml-1', liveCount ? 'bg-[var(--border-strong)]' : 'border-t border-dashed border-[var(--border-default)]')} />
        </div>

        {/* A line out to each place, solid where it is kept, dashed where it could be */}
        <ul className="relative">
          <span aria-hidden className="pointer-events-none absolute left-0 top-[19px] bottom-[19px] hidden sm:block w-px bg-[var(--border-strong)]" />
          {summaries.map((s) => {
            const h = HEALTH[s.health];
            const on = s.health !== 'off';
            return (
              <li key={s.meta.id} className="relative flex items-center">
                <span
                  aria-hidden
                  className={cn('hidden sm:block h-px w-8 flex-shrink-0', on ? 'bg-[var(--border-strong)]' : 'border-t border-dashed border-[var(--border-default)]')}
                />
                <button
                  type="button"
                  onClick={() => onPick(s.meta.id)}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  data-map-dest={s.meta.id}
                >
                  <span className={cn(!on && 'opacity-45 grayscale transition-[filter,opacity] group-hover:opacity-80 group-hover:grayscale-0')}>
                    <ProviderTile id={s.meta.id} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-body font-semibold', on ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>{s.meta.name}</span>
                  </span>
                  <span className={cn('flex flex-shrink-0 items-center gap-1.5 text-caption', h.text)}>
                    <span className={cn('h-2 w-2 rounded-full', h.dot)} />
                    {s.health === 'fresh' || s.health === 'stale' ? ago(s.last) : h.word}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ── One destination ─────────────────────────────────────────────────── */

function DestinationRow({ s, open, onToggle, children }: { s: DestSummary; open: boolean; onToggle: () => void; children: ReactNode }) {
  const h = HEALTH[s.health];
  return (
    <div data-destination={s.meta.id}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-3.5 px-4 sm:px-5 py-4 text-left transition-colors', open ? 'bg-[var(--bg-elevated)]/50' : 'hover:bg-[var(--bg-hover)]')}
      >
        <ProviderTile id={s.meta.id} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-strong font-semibold text-[var(--text-primary)]">{s.meta.name}</span>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 h-5 text-micro font-semibold',
              s.health === 'off' ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' : 'bg-[var(--bg-elevated)]', h.text)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', h.dot)} />
              {h.word}
            </span>
          </span>
          <span className="block truncate text-caption text-[var(--text-tertiary)]">
            {s.health === 'off' ? `${s.meta.format}. ${s.meta.cadence}.` : [s.label, s.last ? `last written ${ago(s.last)}` : null].filter(Boolean).join(', ')}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-canvas,var(--bg-surface))] px-4 sm:px-5 py-5">{children}</div>}
    </div>
  );
}

function FileDestination({ provider, status, unavailable }: { provider: FileBackupProvider; status?: FileBackupStatus; unavailable: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const meta = BACKUP_PROVIDERS.find((p) => p.id === provider)!;
  const [editingS3, setEditingS3] = useState(false);
  const refresh = (next?: unknown) => {
    if (next) qc.setQueryData(['file-backups'], next);
    else qc.invalidateQueries({ queryKey: ['file-backups'] });
  };
  const connect = useMutation({
    mutationFn: () => fileBackupApi.authorize(provider as 'onedrive' | 'dropbox'),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start connecting'),
  });
  const update = useMutation({
    mutationFn: (input: { enabled?: boolean; keep_days?: number }) => fileBackupApi.update(provider, input),
    onSuccess: (next, input) => {
      refresh(next);
      if (input.enabled !== undefined) toast.success(input.enabled ? `${meta.name} backup is on - writing now` : `${meta.name} backup paused`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });
  const now = useMutation({
    mutationFn: () => fileBackupApi.backupNow(provider),
    onSuccess: (r) => { toast.success(r.busy ? 'A backup is already being written' : 'Writing a fresh copy now'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start a backup'),
  });
  const disconnect = () => confirm({
    title: `Disconnect ${meta.name}?`,
    body: 'Backups there stop and Sincerely forgets the connection. The files already written stay where they are.',
    confirmLabel: 'Disconnect',
    tone: 'danger',
  }, async () => {
    try { await fileBackupApi.disconnect(provider); refresh(); toast.success('Disconnected'); } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not disconnect'); }
  });

  if (unavailable) return <Note>Backups to {meta.name} need the latest database update (migration 113).</Note>;
  if (!status?.configured) {
    return (
      <Note>
        {meta.name} backups are not switched on for this deployment yet. An administrator adds the {provider === 'onedrive' ? 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET' : 'DROPBOX_APP_KEY and DROPBOX_APP_SECRET'} settings to the server.
      </Note>
    );
  }

  if (!status.connected || editingS3) {
    return (
      <div className="space-y-4" data-file-dest-setup={provider}>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-[1fr_auto] items-start">
          <div className="space-y-2 max-w-[60ch]">
            <p className="text-body text-[var(--text-secondary)] leading-relaxed">
              {provider === 's3'
                ? 'Sincerely writes the files to a bucket you own. Make a bucket and a key that can only write to it, then add them here; Sincerely checks it can write before saving.'
                : `Sincerely writes the files into its own folder in your ${meta.name}. A fresh set a few minutes after anything changes, and a dated copy every day.`}
            </p>
            <p className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-px" /> Access: {meta.access.toLowerCase()}.
            </p>
          </div>
          {provider !== 's3' && (
            <button type="button" className="btn-primary" onClick={() => connect.mutate()} disabled={connect.isPending} data-connect-provider={provider}>
              {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ProviderGlyph id={provider} />}
              Connect {meta.name}
            </button>
          )}
        </div>
        {provider === 's3' && <S3Form current={status.s3 || null} onSaved={(next) => { refresh(next); setEditingS3(false); toast.success('Bucket saved - writing the first backup now'); }} onCancel={status.connected ? () => setEditingS3(false) : undefined} />}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-file-dest={provider}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 min-w-[220px] text-body text-[var(--text-secondary)]">
          {status.broken_reason ? 'Stopped. ' : !status.enabled ? 'Paused. ' : status.writing ? 'Writing a fresh copy now. ' : status.pending > 0 ? `${status.pending.toLocaleString()} change${status.pending === 1 ? '' : 's'} waiting for the next write. ` : 'Up to date. '}
          {status.last_write_at && <span title={formatDateTime(status.last_write_at)}>Last written {ago(status.last_write_at)}{status.last_bytes ? `, ${formatBackupBytes(status.last_bytes)}` : ''}.</span>}
        </p>
        <label className="flex items-center gap-2 text-body text-[var(--text-secondary)]">
          <Toggle checked={status.enabled} onChange={(v) => update.mutate({ enabled: v })} disabled={update.isPending || !!status.broken_reason} aria-label={`Keep the ${meta.name} backup up to date`} />
          {status.enabled ? 'On' : 'Off'}
        </label>
      </div>

      {(status.broken_reason || status.last_error) && (
        <div className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-caption',
          status.broken_reason ? 'bg-rose-500/[0.08] text-rose-800 dark:text-rose-300' : 'bg-amber-400/[0.10] text-amber-800 dark:text-amber-300')}>
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          <span className="flex-1">{status.broken_reason || status.last_error}</span>
          {status.broken_reason && (provider === 's3'
            ? <button type="button" className="btn-secondary h-7" onClick={() => setEditingS3(true)}>Update keys</button>
            : <button type="button" className="btn-secondary h-7" onClick={() => connect.mutate()}>Reconnect</button>)}
        </div>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
        {([['People', status.counts.people], ['Companies', status.counts.companies], ['No email', status.counts.held], ['Changes logged', status.counts.log]] as const).map(([label, n]) => (
          <div key={label} className="bg-[var(--bg-surface)] px-4 py-3">
            <dt className="text-caption text-[var(--text-tertiary)]">{label}</dt>
            <dd className="text-title font-semibold tabular text-[var(--text-primary)]">{n.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <DailyStrip snapshots={status.snapshots} keepDays={status.keep_days} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => now.mutate()} disabled={now.isPending || !status.enabled || !!status.broken_reason} data-file-backup-now={provider}>
          {now.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Write a fresh copy now
        </button>
        <label className="flex items-center gap-2 text-body text-[var(--text-secondary)]">
          Keep daily copies for
          <select
            value={status.keep_days}
            onChange={(e) => update.mutate({ keep_days: Number(e.target.value) })}
            className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)]"
            aria-label="Keep daily copies for"
          >
            {KEEP_DAYS_CHOICES.map((d) => <option key={d} value={d}>{d === 365 ? 'a year' : `${d} days`}</option>)}
          </select>
        </label>
        {provider === 's3' && (
          <button type="button" className="btn-ghost" onClick={() => setEditingS3(true)}><KeyRound className="h-3.5 w-3.5" /> Change bucket or keys</button>
        )}
        <button type="button" className="btn-ghost ml-auto" onClick={disconnect}><Unplug className="h-3.5 w-3.5" /> Disconnect</button>
      </div>

      {status.location && (
        <p className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
          <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{status.location}{status.account_label ? ` (${status.account_label})` : ''}</span>
        </p>
      )}
    </div>
  );
}

function ProviderGlyph({ id }: { id: BackupProvider }) {
  const Icon = BACKUP_ICON[id];
  return <Icon className="h-3.5 w-3.5" />;
}

/** The last days as a strip: a filled day has a copy, an empty one does not. */
function DailyStrip({ snapshots, keepDays }: { snapshots: FileBackupStatus['snapshots']; keepDays: number }) {
  const span = Math.min(30, keepDays);
  const byDay = new Map(snapshots.map((s) => [s.day, s]));
  const days = Array.from({ length: span }, (_, i) => {
    const d = new Date(Date.now() - (span - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, snap: byDay.get(d) };
  });
  const kept = snapshots.length;
  return (
    <div data-daily-strip>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-body font-semibold text-[var(--text-primary)]">Daily copies</p>
        <p className="text-caption text-[var(--text-tertiary)]">
          {kept === 0 ? 'The first is written today' : `${kept.toLocaleString()} kept, each removed after ${keepDays === 365 ? 'a year' : `${keepDays} days`}`}
        </p>
      </div>
      <ol className="flex gap-[3px]" aria-label={`Daily copies for the last ${span} days`}>
        {days.map(({ day, snap }) => (
          <li
            key={day}
            title={snap ? `${formatDayMonth(day)}: ${snap.people.toLocaleString()} people, ${formatBackupBytes(snap.bytes)}` : `${formatDayMonth(day)}: no copy`}
            className={cn('h-7 flex-1 rounded-sm transition-colors', snap ? 'bg-emerald-500/70 hover:bg-emerald-500' : 'bg-[var(--bg-elevated)]')}
          >
            <span className="sr-only">{formatDayMonth(day)}: {snap ? 'copy kept' : 'no copy'}</span>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-micro text-[var(--text-tertiary)] tabular">
        <span>{formatDayMonth(days[0].day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/* ── S3 settings ─────────────────────────────────────────────────────── */

const S3_PRESETS: Array<{ id: string; name: string; endpoint: string; region: string; hint: string }> = [
  { id: 'aws', name: 'Amazon S3', endpoint: '', region: 'eu-west-2', hint: 'Leave the endpoint empty; set the bucket\'s region.' },
  { id: 'r2', name: 'Cloudflare R2', endpoint: 'https://ACCOUNT_ID.r2.cloudflarestorage.com', region: 'auto', hint: 'Replace ACCOUNT_ID with your Cloudflare account ID. Region is "auto".' },
  { id: 'b2', name: 'Backblaze B2', endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', hint: 'Use the S3 endpoint shown on the bucket; the region is the middle part of it.' },
  { id: 'wasabi', name: 'Wasabi', endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', hint: 'Use your bucket\'s region in both the endpoint and the region.' },
];

function S3Form({ current, onSaved, onCancel }: {
  current: FileBackupStatus['s3'] | null; onSaved: (next: unknown) => void; onCancel?: () => void;
}) {
  const [preset, setPreset] = useState(() => (current?.endpoint ? S3_PRESETS.find((p) => p.endpoint && current.endpoint?.includes(p.endpoint.split('.').slice(-2).join('.')))?.id || 'aws' : 'aws'));
  const [f, setF] = useState({
    endpoint: current?.endpoint || '', region: current?.region || 'eu-west-2', bucket: current?.bucket || '',
    prefix: current?.prefix || '', access_key_id: current?.access_key_id || '', secret_access_key: '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => fileBackupApi.saveS3(f),
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not save that'),
  });
  const problems = s3ConfigProblems(f, { needSecret: !current?.access_key_id });
  const hint = S3_PRESETS.find((p) => p.id === preset)?.hint;
  const field = (key: keyof typeof f, label: string, opts: { placeholder?: string; type?: string; help?: string } = {}) => (
    <label className="block">
      <span className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">{label}</span>
      <input
        type={opts.type || 'text'}
        value={f[key]}
        onChange={(e) => { setF((x) => ({ ...x, [key]: e.target.value })); setError(null); }}
        placeholder={opts.placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
      />
      {opts.help && <span className="block mt-1 text-micro text-[var(--text-tertiary)]">{opts.help}</span>}
    </label>
  );
  return (
    <form className="space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" onSubmit={(e) => { e.preventDefault(); if (!problems.length) save.mutate(); }} data-s3-form>
      <div role="radiogroup" aria-label="Storage service" className="flex flex-wrap gap-1.5">
        {S3_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            onClick={() => { setPreset(p.id); setF((x) => ({ ...x, endpoint: p.endpoint, region: p.region })); }}
            className={cn('inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-body transition-colors',
              preset === p.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] font-semibold text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]')}
          >
            {preset === p.id && <Check className="h-3 w-3" />}{p.name}
          </button>
        ))}
      </div>
      {hint && <p className="text-caption text-[var(--text-tertiary)]">{hint}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('endpoint', 'Endpoint', { placeholder: preset === 'aws' ? 'Leave empty for Amazon S3' : 'https://...' })}
        {field('region', 'Region', { placeholder: 'eu-west-2' })}
        {field('bucket', 'Bucket', { placeholder: 'acme-sincerely-backup' })}
        {field('prefix', 'Folder in the bucket (optional)', { placeholder: 'backups', help: `Files go in ${[f.prefix.replace(/^\/+|\/+$/g, ''), 'Sincerely backup'].filter(Boolean).join('/')}/` })}
        {field('access_key_id', 'Access key ID')}
        {field('secret_access_key', 'Secret access key', { type: 'password', placeholder: current?.access_key_id ? 'Saved - type to replace' : '', help: 'Stored encrypted. It is never shown again.' })}
      </div>
      <p className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
        <KeyRound className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
        Give the key permission to write, list and delete in this bucket only (PutObject, ListBucket, DeleteObject). Sincerely never needs more.
      </p>
      {(error || (problems.length > 0 && f.bucket)) && (
        <p className="flex items-start gap-2 rounded-md bg-rose-500/[0.08] px-2.5 py-2 text-caption text-rose-800 dark:text-rose-300">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />{error || problems[0]}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary" disabled={problems.length > 0 || save.isPending} data-save-s3>
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          {save.isPending ? 'Checking the bucket...' : 'Check and save'}
        </button>
      </div>
    </form>
  );
}

/* ── What a backup holds ─────────────────────────────────────────────── */

function WhatIsInABackup() {
  return (
    <section aria-label="What is in a backup" className="grid gap-x-10 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2 max-w-[48ch]">
        <p className="text-strong font-semibold text-[var(--text-primary)]">What every backup holds</p>
        <p className="text-body text-[var(--text-secondary)] leading-relaxed">
          The same records everywhere: Google Drive as tabs in one spreadsheet, the others as CSV files that open in Excel, Numbers or Sheets. Deleted people stay in, marked Deleted, so a mistake can be undone from the backup.
        </p>
        <p className="text-body text-[var(--text-secondary)] leading-relaxed">
          To restore, import the people file in Sincerely. The main columns are matched for you.
        </p>
      </div>
      <dl className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {BACKUP_FILES.map((f) => (
          <div key={f.file} className="flex items-baseline gap-4 px-4 py-2.5">
            <dt className="w-32 flex-shrink-0 font-mono text-caption text-[var(--text-primary)]">{f.file}</dt>
            <dd className="text-caption text-[var(--text-secondary)]">{f.what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-body text-[var(--text-secondary)] leading-relaxed">{children}</p>;
}
