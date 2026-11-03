import { useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { importRunner } from '../../lib/importRunner';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   An import running while you do something else.

   Bottom-right, clear of the sidebar and the selection bar: the
   file, a progress bar, and Cancel. When it finishes it says how it went
   and offers the way to the people; closing it dismisses the result.
   Hidden on the import page itself, which shows the full progress.
   ═══════════════════════════════════════════════════════════════════════ */

export function ImportProgressPill() {
  const run = useSyncExternalStore(importRunner.subscribe, importRunner.get, importRunner.get);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!run || pathname.startsWith('/contacts/import')) return null;
  if (run.status === 'done' && run.acknowledged) return null;

  const { progress, result } = run;
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 100;
  const running = run.status === 'running';
  const hadIssues = !!result && (result.errors > 0 || result.cancelled);
  const people = run.filedAs === 'contact' ? 'contacts' : 'leads';
  const where = run.filedAs === 'contact' ? '/contacts' : '/leads';

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[300px] max-w-[calc(100vw-40px)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] animate-fade-in" role="status" aria-live="polite" data-import-pill>
      <div className="flex items-start gap-2.5 p-3">
        <span className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
          running ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : hadIssues ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600',
        )}>
          {running ? <Upload className="h-4 w-4" /> : hadIssues ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[var(--text-primary)] truncate">
            {running
              ? `Importing ${people}`
              : result?.cancelled
                ? `Import stopped - ${result.imported.toLocaleString()} added`
                : `Imported ${result?.imported.toLocaleString() ?? 0} ${people}`}
          </p>
          <p className="text-caption text-[var(--text-tertiary)] truncate" title={run.label}>
            {run.label}
            {running && ` · ${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()}`}
            {!running && result && result.errors > 0 && ` · ${result.errors.toLocaleString()} skipped`}
            {!running && run.heldCount > 0 && ` · ${run.heldCount.toLocaleString()} without an email kept`}
          </p>
        </div>
        {running ? (
          <span className="text-caption font-semibold tabular text-[var(--text-secondary)] flex-shrink-0">{pct}%</span>
        ) : (
          <button type="button" onClick={() => importRunner.acknowledge()} className="icon-btn h-6 w-6 flex-shrink-0" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {running && (
        <div className="mx-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full rounded-full bg-[var(--indigo)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5 pt-2">
        {running ? (
          <>
            <button type="button" onClick={() => navigate('/contacts/import')} className="btn-ghost h-7">Details</button>
            <button
              type="button"
              onClick={() => importRunner.cancel()}
              disabled={importRunner.cancelRequested()}
              className="btn-secondary h-7"
            >
              {importRunner.cancelRequested() ? <><Loader2 className="h-3 w-3 animate-spin" /> Stopping</> : 'Cancel'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => navigate('/contacts/import')} className="btn-ghost h-7">Details</button>
            <button
              type="button"
              onClick={() => { importRunner.acknowledge(); navigate(run.listId ? `${where}?list=${run.listId}` : where); }}
              className="btn-primary h-7"
            >
              View {people}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
