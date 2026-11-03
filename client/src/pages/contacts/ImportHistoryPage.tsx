import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle, ArrowRight, Check, ClipboardPaste, FileSpreadsheet, FileText, History,
  Loader2, Pause, Play, RefreshCw, Sheet, Trash2, Undo2, Upload,
} from 'lucide-react';
import {
  IMPORT_TARGET_GROUPS, IMPORT_TARGET_LABELS, formatDateTime, formatDayMonthTime,
  type ImportTarget,
} from '@lemlist/shared';
import { PageHeader } from '../../components/shared/PageHeader';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { listsApi } from '../../api/contacts.api';
import { importsApi, type ImportRunRow, type SheetPreview, type SheetSync } from '../../api/imports.api';
import { cn } from '../../lib/utils';
import { keepPrevious } from '../../lib/listQuery';
import { Refreshing } from '../../components/ui/Refreshing';

/* ═══════════════════════════════════════════════════════════════════════
   Import history, and the Google Sheets kept in sync.

   Every import - file, paste or sheet run - is listed with what it did,
   and can be undone here days later: Undo removes the people it ADDED
   (never someone who was already here) and keeps anyone since put in a
   campaign. "Still here" is how many of those it added remain.

   A synced sheet is imported on a schedule with its mapping saved once.
   ═══════════════════════════════════════════════════════════════════════ */

const PAGE = 25;
const EVERY: Array<{ hours: number; label: string }> = [
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 24, label: 'Once a day' },
  { hours: 168, label: 'Once a week' },
];
const everyLabel = (h: number) => EVERY.find((e) => e.hours === h)?.label || `Every ${h} hours`;

function invalidatePeople(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['imports', 'sheet-syncs', 'contacts', 'contact-stats', 'lists', 'verification-breakdown', 'held-people', 'contact-companies']) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}

export function ImportHistoryPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [undoing, setUndoing] = useState<string | null>(null);
  const connectOpen = params.get('sheet') === 'new';
  const connectAs: 'lead' | 'contact' = params.get('as') === 'contact' ? 'contact' : 'lead';

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['imports', page],
    queryFn: () => importsApi.list({ page, limit: PAGE }),
    // Paging keeps the page on screen until the next one arrives.
    ...keepPrevious,
    // A run in progress fills in as its batches land.
    refetchInterval: (q) => (q.state.data?.data.some((r) => r.status === 'running') ? 4000 : false),
  });
  const rows = data?.data || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const undo = (r: ImportRunRow) => confirm({
    title: `Undo "${r.source || 'this import'}"?`,
    body: `The ${r.still_here.toLocaleString()} ${r.still_here === 1 ? 'person' : 'people'} it added and who are still here are deleted, with their list memberships and tags. ${r.updated ? `The ${r.updated.toLocaleString()} who were already here stay as they are now. ` : ''}Anyone since put in a campaign is kept.`,
    confirmLabel: 'Undo import',
    tone: 'danger',
  }, async () => {
    setUndoing(r.id);
    try {
      const res = await importsApi.undo(r.id);
      toast.success(`Removed ${res.deleted.toLocaleString()} ${res.deleted === 1 ? 'person' : 'people'}`);
      if (res.kept_in_campaigns) toast(`${res.kept_in_campaigns.toLocaleString()} already in a campaign were kept`, { duration: 6000 });
      invalidatePeople(qc);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not undo that import');
    } finally {
      setUndoing(null);
    }
  });

  return (
    <div className="space-y-5 max-w-5xl" data-import-history>
      <PageHeader
        icon={History}
        breadcrumbs={[{ label: 'Leads', href: '/leads' }, { label: 'Import history' }]}
        title="Import history"
        description="Every import, what it added, and a way to take it back. Plus the Google Sheets you keep in sync."
        contentClassName="max-w-5xl"
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn-secondary" onClick={() => setParams({ sheet: 'new' })}>
              <Sheet className="h-3.5 w-3.5" /> Sync a Google Sheet
            </button>
            <Link to="/contacts/import" className="btn-primary">
              <Upload className="h-3.5 w-3.5" /> Import a file
            </Link>
          </div>
        }
      />

      <SheetSyncsSection onConnect={() => setParams({ sheet: 'new' })} />

      <section className="card overflow-hidden" aria-label="Past imports">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
          <h2 className="text-strong font-semibold text-[var(--text-primary)]">Past imports</h2>
          {total > 0 && <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-[var(--bg-elevated)] text-micro font-semibold tabular text-[var(--text-secondary)]">{total.toLocaleString()}</span>}
        </header>
        {data?.unavailable ? (
          <p className="p-4 text-body text-[var(--text-secondary)]">Import history needs the latest database update (migration 111). Imports still work in the meantime.</p>
        ) : isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-body font-medium text-[var(--text-primary)]">No imports yet</p>
            <p className="text-caption text-[var(--text-tertiary)] mt-0.5">Imports from now on are listed here, with a way to undo each one.</p>
          </div>
        ) : (
          <Refreshing active={isPlaceholderData}>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {rows.map((r) => <ImportRow key={r.id} r={r} busy={undoing === r.id} onUndo={() => undo(r)} />)}
            </ul>
          </Refreshing>
        )}
        {pages > 1 && (
          <footer className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] text-caption text-[var(--text-tertiary)]">
            <span className="tabular">Page {page} of {pages}</span>
            <button type="button" className="btn-secondary h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="btn-secondary h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </footer>
        )}
      </section>

      <ConnectSheetModal
        isOpen={connectOpen}
        defaultKind={connectAs}
        onClose={() => { params.delete('sheet'); params.delete('as'); setParams(params, { replace: true }); }}
      />
    </div>
  );
}

const STATUS: Record<ImportRunRow['status'], { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' },
  done: { label: 'Done', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  cancelled: { label: 'Stopped', cls: 'bg-amber-400/15 text-amber-800 dark:text-amber-300' },
  failed: { label: 'Failed', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  undone: { label: 'Undone', cls: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' },
};

function ImportRow({ r, busy, onUndo }: { r: ImportRunRow; busy: boolean; onUndo: () => void }) {
  const Icon = r.origin === 'sheet' ? FileSpreadsheet : r.origin === 'paste' ? ClipboardPaste : FileText;
  const st = STATUS[r.status] || STATUS.done;
  const peoplePage = r.kind === 'contact' ? '/contacts' : '/leads';
  const canUndo = r.status !== 'running' && r.status !== 'undone' && r.still_here > 0;
  return (
    <li className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto] items-center gap-x-6 gap-y-2 px-4 py-3" data-import-row={r.id}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-body font-semibold text-[var(--text-primary)]">
            <span className="truncate">{r.source || 'Import'}</span>
            <span className={cn('inline-flex items-center h-5 px-1.5 rounded-md text-micro font-semibold flex-shrink-0', st.cls)}>{st.label}</span>
          </p>
          <p className="text-caption text-[var(--text-tertiary)] truncate">
            <span title={formatDateTime(r.started_at)}>{formatDayMonthTime(r.started_at)}</span>
            {' - '}
            {r.list_id ? <Link className="hover:text-[var(--text-primary)] hover:underline" to={`${peoplePage}?list=${r.list_id}`}>{r.list_name || 'a list'}</Link> : <span>no list</span>}
            {' - as '}{r.kind === 'contact' ? 'contacts' : 'leads'}
          </p>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-caption">
        <Fig label="Added" value={r.created} strong />
        <Fig label="Updated" value={r.updated} />
        {r.held > 0 && <Fig label="No email" value={r.held} />}
        {r.errors > 0 && <Fig label="Errors" value={r.errors} tone="bad" />}
        {r.status === 'undone'
          ? <Fig label="Removed" value={r.undone_count} />
          : r.created > 0 && <Fig label="Still here" value={r.still_here} />}
      </dl>
      <div className="flex items-center justify-end gap-1.5">
        {canUndo ? (
          <button type="button" className="btn-ghost" onClick={onUndo} disabled={busy} data-undo-run>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            Undo
          </button>
        ) : r.status === 'undone' && r.undone_at ? (
          <span className="text-caption text-[var(--text-tertiary)]" title={formatDateTime(r.undone_at)}>Undone {formatDayMonthTime(r.undone_at)}</span>
        ) : null}
      </div>
    </li>
  );
}

function Fig({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'bad' }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-[var(--text-tertiary)]">{label}</dt>
      <dd className={cn('tabular', strong ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]', tone === 'bad' && 'text-rose-700 dark:text-rose-400')}>{value.toLocaleString()}</dd>
    </div>
  );
}

/* ── Google Sheets kept in sync ─────────────────────────────────────── */

function SheetSyncsSection({ onConnect }: { onConnect: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['sheet-syncs'], queryFn: importsApi.sheets });
  const syncs = data?.data || [];

  if (data?.unavailable) return null;
  if (!isLoading && syncs.length === 0) {
    return (
      <section className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4" data-sheet-syncs-empty>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex-shrink-0">
          <FileSpreadsheet className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-body font-semibold text-[var(--text-primary)]">Keep a Google Sheet in sync</p>
          <p className="text-caption text-[var(--text-tertiary)]">For a sheet your team keeps adding leads to: new rows come into a list by themselves, on a schedule.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onConnect}>Connect a sheet <ArrowRight className="h-3.5 w-3.5" /></button>
      </section>
    );
  }

  const runNow = async (s: SheetSync) => {
    setBusy(s.id);
    try {
      const r = await importsApi.sheetRun(s.id);
      toast.success(`${s.name}: ${r.created.toLocaleString()} added, ${r.updated.toLocaleString()} updated${r.held ? `, ${r.held.toLocaleString()} without an email` : ''}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'The sync failed');
    } finally {
      setBusy(null);
      invalidatePeople(qc);
    }
  };
  const patch = async (s: SheetSync, input: Parameters<typeof importsApi.sheetUpdate>[1]) => {
    try {
      await importsApi.sheetUpdate(s.id, input);
      qc.invalidateQueries({ queryKey: ['sheet-syncs'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save that');
    }
  };
  const remove = (s: SheetSync) => confirm({
    title: `Stop syncing "${s.name}"?`,
    body: 'The sheet is no longer imported. Everyone it already brought in stays; undo its runs below if you want them gone too.',
    confirmLabel: 'Stop syncing',
    tone: 'danger',
  }, async () => {
    try {
      await importsApi.sheetDelete(s.id);
      qc.invalidateQueries({ queryKey: ['sheet-syncs'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not remove it');
    }
  });

  return (
    <section className="card overflow-hidden" aria-label="Synced Google Sheets" data-sheet-syncs>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">Synced sheets</h2>
        <button type="button" className="btn-ghost ml-auto" onClick={onConnect}><Sheet className="h-3.5 w-3.5" /> Add another</button>
      </header>
      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {syncs.map((s) => (
            <li key={s.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_auto] items-center gap-x-6 gap-y-2 px-4 py-3" data-sheet-sync={s.id}>
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', s.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <a href={s.sheet_url} target="_blank" rel="noreferrer" className="block truncate text-body font-semibold text-[var(--text-primary)] hover:underline">{s.name}</a>
                  <p className="text-caption text-[var(--text-tertiary)] truncate">
                    Into {s.list_name || 'no list'} as {s.kind === 'contact' ? 'contacts' : 'leads'}
                  </p>
                </div>
              </div>
              <div className="min-w-0 text-caption">
                {s.last_error ? (
                  <p className="flex items-start gap-1.5 text-rose-700 dark:text-rose-400"><AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" /><span className="line-clamp-2">{s.last_error}</span></p>
                ) : s.last_run_at ? (
                  <p className="text-[var(--text-secondary)] truncate"><Check className="inline h-3 w-3 mr-1 text-emerald-600" />{formatDayMonthTime(s.last_run_at)}: {s.last_status}</p>
                ) : (
                  <p className="text-[var(--text-tertiary)]">Not run yet</p>
                )}
                <p className="text-[var(--text-tertiary)]">
                  {s.enabled
                    ? <>{everyLabel(s.every_hours)}{s.next_run_at ? <>, next {formatDayMonthTime(s.next_run_at)}</> : null}</>
                    : 'Paused'}
                </p>
              </div>
              <div className="flex items-center justify-end gap-1">
                <select
                  aria-label={`How often to sync ${s.name}`}
                  value={s.every_hours}
                  onChange={(e) => patch(s, { every_hours: Number(e.target.value) })}
                  className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-caption text-[var(--text-primary)]"
                >
                  {EVERY.map((e) => <option key={e.hours} value={e.hours}>{e.label}</option>)}
                  {!EVERY.some((e) => e.hours === s.every_hours) && <option value={s.every_hours}>{everyLabel(s.every_hours)}</option>}
                </select>
                <button type="button" className="icon-btn" onClick={() => patch(s, { enabled: !s.enabled })} aria-label={s.enabled ? `Pause ${s.name}` : `Resume ${s.name}`} title={s.enabled ? 'Pause' : 'Resume'}>
                  {s.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className="btn-secondary h-8" onClick={() => runNow(s)} disabled={busy === s.id} data-sheet-run>
                  {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync now
                </button>
                <button type="button" className="icon-btn" onClick={() => remove(s)} aria-label={`Stop syncing ${s.name}`} title="Stop syncing">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectSheetModal({ isOpen, onClose, defaultKind }: { isOpen: boolean; onClose: () => void; defaultKind: 'lead' | 'contact' }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'lead' | 'contact'>(defaultKind);
  const [listId, setListId] = useState('');
  const [every, setEvery] = useState(24);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(''); setPreview(null); setMapping({}); setName(''); setKind(defaultKind); setListId(''); setEvery(24); setError(null);
  }, [isOpen, defaultKind]);

  const { data: lists } = useQuery({ queryKey: ['lists', 'all'], queryFn: () => listsApi.list(), enabled: isOpen });
  const kindLists = useMemo(() => (lists || []).filter((l: any) => (l.kind || 'lead') === kind), [lists, kind]);

  const read = async () => {
    setLoading(true); setError(null);
    try {
      const p = await importsApi.sheetPreview(url.trim());
      setPreview(p);
      setMapping(p.mapping);
      if (!name) setName('Google Sheet');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not read that sheet');
    } finally {
      setLoading(false);
    }
  };

  const hasEmail = Object.values(mapping).includes('email');
  const save = async () => {
    if (!preview || !hasEmail) return;
    setSaving(true); setError(null);
    try {
      const r = await importsApi.sheetCreate({ name: name.trim() || 'Google Sheet', sheet_url: url.trim(), list_id: listId || null, kind, mapping, every_hours: every });
      if (r.first) toast.success(`Synced: ${r.first.created.toLocaleString()} added, ${r.first.updated.toLocaleString()} updated${r.first.held ? `, ${r.first.held.toLocaleString()} without an email` : ''}`);
      else if (r.first_error) toast.error(`Saved, but the first sync failed: ${r.first_error}`);
      invalidatePeople(qc);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save the sync');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sync a Google Sheet" description="New rows are imported on a schedule. Nobody is ever deleted or blanked by a sync." size="lg">
      <div className="space-y-4" data-connect-sheet>
        <div>
          <label htmlFor="sheet-url" className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">Sheet link</label>
          <div className="flex gap-2">
            <input
              id="sheet-url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) read(); }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 min-w-0 h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
            />
            <button type="button" className="btn-primary" disabled={!url.trim() || loading} onClick={read}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Read sheet
            </button>
          </div>
          <p className="mt-1 text-caption text-[var(--text-tertiary)]">In Google Sheets: Share, then General access "Anyone with the link" (Viewer). The tab open when you copy the link is the one synced.</p>
        </div>

        {error && <p className="flex items-start gap-2 rounded-md bg-rose-500/10 px-2.5 py-2 text-caption text-rose-700 dark:text-rose-400"><AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />{error}</p>}

        {preview && (
          <>
            <p className="text-caption text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)] tabular">{preview.total.toLocaleString()}</strong> rows, {preview.headers.length} columns. Columns are matched for you; change any that are wrong.</p>
            <div className="max-h-[260px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
              {preview.headers.map((h) => (
                <div key={h} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="text-body font-medium text-[var(--text-primary)] truncate">{h}</p>
                    <p className="text-caption text-[var(--text-tertiary)] truncate">{preview.sample.map((r) => r[h]).filter(Boolean).slice(0, 2).join(', ') || 'empty'}</p>
                  </div>
                  <select
                    aria-label={`Where ${h} goes`}
                    value={mapping[h] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                    className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-caption text-[var(--text-primary)]"
                  >
                    {IMPORT_TARGET_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.targets.map((t) => <option key={t || 'skip'} value={t}>{IMPORT_TARGET_LABELS[t as ImportTarget]}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!hasEmail && <p className="text-caption text-amber-800 dark:text-amber-300">Choose which column holds the email.</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]" />
              </label>
              <label className="block">
                <span className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">How often</span>
                <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="w-full h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)]">
                  {EVERY.map((e) => <option key={e.hours} value={e.hours}>{e.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">Import as</span>
                <select value={kind} onChange={(e) => { setKind(e.target.value as 'lead' | 'contact'); setListId(''); }} className="w-full h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)]">
                  <option value="lead">Leads (cold outreach)</option>
                  <option value="contact">Contacts (CRM)</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">Into list</span>
                <select value={listId} onChange={(e) => setListId(e.target.value)} className="w-full h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)]">
                  <option value="">No list</option>
                  {kindLists.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!preview || !hasEmail || saving} onClick={save} data-save-sheet>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {saving ? 'Syncing...' : 'Save and sync now'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
