import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileSpreadsheet, FileText, ChevronDown, Check } from 'lucide-react';
import { EXPORT_COLUMNS, EXPORT_PRESETS, type ExportColumnKey } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Checkbox } from '../ui/Checkbox';
import { contactsApi, type ExportRequest } from '../../api/contacts.api';
import { downloadXlsx } from '../../lib/spreadsheet';
import { csvDate } from '../../lib/csv';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Export, with the three questions answered up front.

   Which people: the ones ticked, the view on screen (its list and its
   filters, exactly), or everyone. Which columns: a preset for what the
   file is for, or a pick. Which format: CSV, or Excel for the people who
   will only ever double-click it. The last choice is remembered, so the
   weekly export is two clicks.
   ═══════════════════════════════════════════════════════════════════════ */

type Scope = 'selected' | 'view' | 'all';
type Format = 'csv' | 'xlsx';
type PresetId = (typeof EXPORT_PRESETS)[number]['id'] | 'custom';

const PREFS_KEY = 'sincerely.export.prefs.v1';

interface Prefs { preset: PresetId; columns: ExportColumnKey[]; format: Format }

function loadPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const known = new Set(EXPORT_COLUMNS.map((c) => c.key));
    const columns = Array.isArray(p.columns) ? p.columns.filter((k: string) => known.has(k as ExportColumnKey)) : [];
    if (!columns.length) return null;
    return { preset: p.preset || 'custom', columns, format: p.format === 'xlsx' ? 'xlsx' : 'csv' };
  } catch {
    return null;
  }
}

function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: fine */ }
}

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'lead' or 'contact', for the words and the filename. */
  noun: 'lead' | 'contact';
  selectedIds: string[];
  /** The view on screen: its list, lifecycle and filters. */
  view: ExportRequest;
  /** How many people the view holds, when known. */
  viewCount?: number;
  /** "Q3 logistics leads" when a list is open; describes the view. */
  viewLabel?: string;
  /** Filters on top of the list, in words ("search \"acme\""), when any. */
  filterSummary?: string;
}

export function ExportDialog({ isOpen, onClose, noun, selectedIds, view, viewCount, viewLabel, filterSummary }: ExportDialogProps) {
  const initial = useMemo(loadPrefs, []);
  const [scope, setScope] = useState<Scope>('view');
  const [preset, setPreset] = useState<PresetId>(initial?.preset ?? 'everything');
  const [columns, setColumns] = useState<ExportColumnKey[]>(initial?.columns ?? EXPORT_PRESETS[0].columns);
  const [format, setFormat] = useState<Format>(initial?.format ?? 'csv');
  const [showColumns, setShowColumns] = useState(false);
  const [busy, setBusy] = useState(false);

  // Opening with people ticked means "export these".
  useEffect(() => {
    if (isOpen) setScope(selectedIds.length > 0 ? 'selected' : 'view');
  }, [isOpen, selectedIds.length]);

  const plural = `${noun}s`;
  const fixedCount = columns.filter((k) => k !== 'custom_fields').length;
  const hasView = !!(view.listId || filterSummary);

  const pickPreset = (id: PresetId) => {
    setPreset(id);
    const p = EXPORT_PRESETS.find((x) => x.id === id);
    if (p) setColumns(p.columns);
    if (id === 'custom') setShowColumns(true);
  };

  const toggleColumn = (key: ExportColumnKey) => {
    setPreset('custom');
    setColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const groups = useMemo(() => {
    const out: Array<{ group: string; cols: typeof EXPORT_COLUMNS }> = [];
    for (const c of EXPORT_COLUMNS) {
      let g = out.find((x) => x.group === c.group);
      if (!g) { g = { group: c.group, cols: [] }; out.push(g); }
      g.cols.push(c);
    }
    return out;
  }, []);

  const run = async () => {
    if (columns.length === 0 || busy) return;
    setBusy(true);
    try {
      const req: ExportRequest = scope === 'selected'
        ? { contactIds: selectedIds, columns }
        : scope === 'view'
          ? { ...view, columns }
          : { lifecycle: view.lifecycle, columns };
      const stem = [plural, scope === 'view' && viewLabel ? viewLabel : null, csvDate()]
        .filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');
      let count = 0;
      if (format === 'xlsx') {
        const table = await contactsApi.exportTable(req);
        count = table.rows.length;
        if (count === 0) { toast.error(`No ${plural} to export`); return; }
        await downloadXlsx(`${stem}.xlsx`, table.header, table.rows);
      } else {
        const blob = await contactsApi.exportCsv(req);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${stem}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      savePrefs({ preset, columns, format });
      toast.success(count ? `Exported ${count.toLocaleString()} ${count === 1 ? noun : plural}` : 'Export downloaded');
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Export failed - nothing was downloaded');
    } finally {
      setBusy(false);
    }
  };

  const scopes: Array<{ id: Scope; label: string; hint: string; hidden?: boolean }> = [
    { id: 'selected', label: `Selected (${selectedIds.length.toLocaleString()})`, hint: `Only the ${plural} you ticked`, hidden: selectedIds.length === 0 },
    {
      id: 'view',
      label: hasView ? `This view${typeof viewCount === 'number' ? ` (${viewCount.toLocaleString()})` : ''}` : `All ${plural}${typeof viewCount === 'number' ? ` (${viewCount.toLocaleString()})` : ''}`,
      hint: [viewLabel ? `"${viewLabel}"` : null, filterSummary].filter(Boolean).join(' · ') || `Everyone on the ${noun === 'lead' ? 'Leads' : 'Contacts'} page`,
    },
    { id: 'all', label: `All ${plural}`, hint: 'Ignoring the list and filters on screen', hidden: !hasView },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Export ${plural}`}
      description="Pick who, what and how - your choice is remembered for next time."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <p className="text-caption text-[var(--text-tertiary)]">{fixedCount} column{fixedCount === 1 ? '' : 's'}{columns.includes('custom_fields') ? ' + custom fields' : ''}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="button" onClick={run} disabled={busy || columns.length === 0} className="btn-primary" data-export-run>
              <Download className="h-3.5 w-3.5" />
              {busy ? 'Exporting...' : `Download ${format === 'xlsx' ? 'Excel' : 'CSV'}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <p className="text-caption font-semibold text-[var(--text-secondary)] mb-2">Who</p>
          <div role="radiogroup" aria-label="Who to export" className="grid gap-2 sm:grid-cols-3">
            {scopes.filter((s) => !s.hidden).map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={scope === s.id}
                onClick={() => setScope(s.id)}
                className={cn(
                  'text-left rounded-lg border px-3 py-2 transition-colors',
                  scope === s.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <span className="block text-body font-semibold text-[var(--text-primary)]">{s.label}</span>
                <span className="block text-caption text-[var(--text-tertiary)] truncate">{s.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="text-caption font-semibold text-[var(--text-secondary)] mb-2">What it's for</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...EXPORT_PRESETS, { id: 'custom' as const, label: 'Pick columns', hint: 'Choose exactly which columns go in the file', columns: [] }].map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                onClick={() => pickPreset(p.id)}
                className={cn(
                  'text-left rounded-lg border px-3 py-2 transition-colors flex items-start gap-2',
                  preset === p.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <span className={cn('mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border flex-shrink-0',
                  preset === p.id ? 'border-[var(--indigo)] bg-[var(--indigo)] text-white' : 'border-[var(--border-default)]')}>
                  {preset === p.id && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-[var(--text-primary)]">{p.label}</span>
                  <span className="block text-caption text-[var(--text-tertiary)]">{p.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowColumns((v) => !v)}
            aria-expanded={showColumns}
            className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showColumns && 'rotate-180')} />
            {showColumns ? 'Hide columns' : 'See or change the columns'}
          </button>
          {showColumns && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2 rounded-lg border border-[var(--border-subtle)] p-3">
              {groups.map((g) => (
                <div key={g.group}>
                  <p className="text-micro font-bold text-[var(--text-tertiary)] mb-1">{g.group}</p>
                  <div className="space-y-1">
                    {g.cols.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 text-body text-[var(--text-primary)] cursor-pointer">
                        <Checkbox checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} aria-label={c.label} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="text-caption font-semibold text-[var(--text-secondary)] mb-2">Format</p>
          <div role="radiogroup" aria-label="File format" className="flex gap-2">
            {([
              { id: 'csv', label: 'CSV', hint: 'Any tool', icon: FileText },
              { id: 'xlsx', label: 'Excel', hint: '.xlsx', icon: FileSpreadsheet },
            ] as const).map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                onClick={() => setFormat(f.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3 h-9 text-body font-medium transition-colors',
                  format === f.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <f.icon className="h-3.5 w-3.5" />
                {f.label}
                <span className="text-caption text-[var(--text-tertiary)]">{f.hint}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
